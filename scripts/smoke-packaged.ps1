param(
  [int]$Port = 9337,
  [string]$ExePath = "dist/win-unpacked/michat.exe"
)

$ErrorActionPreference = 'Stop'

$resolvedExe = Resolve-Path $ExePath
$configDir = Join-Path $env:APPDATA 'michat'
$configPath = Join-Path $configDir 'michat-config.json'
$backupPath = $null
$proc = $null
$ws = $null

function Write-JsonNoBom($path, $value) {
  $json = $value | ConvertTo-Json -Depth 50
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($path, $json, $encoding)
}

function Set-OnboardingIncomplete {
  if (!(Test-Path $configDir)) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  }

  if (Test-Path $configPath) {
    $script:backupPath = Join-Path $env:TEMP ("michat-config-smoke-{0}.json" -f ([guid]::NewGuid()))
    Copy-Item $configPath $script:backupPath -Force
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
  } else {
    $config = [pscustomobject]@{ settings = [pscustomobject]@{} }
  }

  if ($null -eq $config.settings) {
    $config | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) -Force
  }

  $config.settings | Add-Member -NotePropertyName hasCompletedOnboarding -NotePropertyValue $false -Force
  if (-not $config.settings.PSObject.Properties['language']) {
    $config.settings | Add-Member -NotePropertyName language -NotePropertyValue 'vi-VN' -Force
  }

  Write-JsonNoBom $configPath $config
}

function Restore-Config {
  if ($script:backupPath -and (Test-Path $script:backupPath)) {
    Copy-Item $script:backupPath $configPath -Force
    Remove-Item $script:backupPath -Force
  }
}

function Send-Cdp($method, $params) {
  $script:cdpId += 1
  $payload = @{ id = $script:cdpId; method = $method }
  if ($null -ne $params) { $payload.params = $params }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 20 -Compress))
  $null = $script:ws.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

  $chunks = ''
  while ($true) {
    $buffer = New-Object byte[] 65536
    $result = $script:ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $chunks += [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    if (-not $result.EndOfMessage) { continue }

    try {
      $message = $chunks | ConvertFrom-Json
    } catch {
      $chunks = ''
      continue
    }
    $chunks = ''

    if ($message.id -eq $script:cdpId) { return $message }
  }
}

function Invoke-ParserSmoke($exePath) {
  # Plan Task 15: prove that the packaged app parses a document in a separate
  # utility process (asar entry, loaders, message channel), not in-process.
  $fixture = (Resolve-Path (Join-Path $PSScriptRoot '..\tests\fixtures\rag\local-first.md')).Path
  $output = & $exePath "--smoke-parser=$fixture" 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Packaged parser smoke failed (exit $exitCode): $output"
  }
  if ($output -notmatch 'MICHAT_PARSER_SMOKE_OK') {
    throw "Packaged parser smoke produced no success marker: $output"
  }
  Write-Host ('[parser] ' + ($output.Trim() -split "`n" | Where-Object { $_ -match 'MICHAT_PARSER_SMOKE_OK' } | Select-Object -First 1))
}

function Wait-ForRendererTarget($port, $process) {
  $deadline = (Get-Date).AddSeconds(45)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "Packaged app exited before DevTools was available. ExitCode=$($process.ExitCode)"
    }

    try {
      $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 3
      $page = @($targets | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl } | Select-Object -First 1)
      if ($page) { return $page[0] }
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for packaged renderer DevTools target on port $port. LastError=$lastError"
}

try {
  Invoke-ParserSmoke $resolvedExe
  Set-OnboardingIncomplete

  $proc = Start-Process -FilePath $resolvedExe -ArgumentList "--remote-debugging-port=$Port" -PassThru
  $target = Wait-ForRendererTarget $Port $proc
  if (-not $target.webSocketDebuggerUrl) { throw 'No debuggable renderer target found' }

  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $null = $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $script:ws = $ws
  $script:cdpId = 0

  Send-Cdp 'Runtime.enable' $null | Out-Null

  $waitExpression = @"
new Promise(resolve => {
  const started = Date.now();
  const tick = () => {
    const button = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Get Started'));
    if (window.api && window.electron && button) resolve({ ready: true, hasApi: true, hasElectron: true, url: location.href, text: document.body.innerText });
    else if (Date.now() - started > 15000) resolve({ ready: false, hasApi: !!window.api, hasElectron: !!window.electron, url: location.href, text: document.body.innerText });
    else setTimeout(tick, 250);
  };
  tick();
})
"@

  $ready = Send-Cdp 'Runtime.evaluate' @{ expression = $waitExpression; awaitPromise = $true; returnByValue = $true }
  if (-not $ready.result.result.value.ready) {
    throw ("Packaged app did not expose preload API/onboarding in time: " + ($ready.result.result.value | ConvertTo-Json -Compress))
  }

  Send-Cdp 'Runtime.evaluate' @{ expression = "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Get Started')).click(); 'clicked'"; returnByValue = $true } | Out-Null
  Start-Sleep -Seconds 3

  $after = Send-Cdp 'Runtime.evaluate' @{ expression = "({ url: location.href, text: document.body.innerText, hasApi: !!window.api })"; returnByValue = $true }
  $state = $after.result.result.value
  if (-not $state.hasApi -or $state.url -notmatch '#/$') {
    throw ("Onboarding did not complete successfully: " + ($state | ConvertTo-Json -Compress))
  }

  Write-Host 'Packaged smoke test passed'
} finally {
  if ($ws) { $ws.Dispose() }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Restore-Config
}
