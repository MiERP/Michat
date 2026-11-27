param(
  [int]$Port = 9337,
  [string]$ExePath = "dist/win-unpacked/michat.exe",
  [string]$UserDataDir = ""
)

$ErrorActionPreference = 'Stop'

$resolvedExe = Resolve-Path $ExePath
$autoUserDataDir = [string]::IsNullOrWhiteSpace($UserDataDir)
if ($autoUserDataDir) {
  $UserDataDir = Join-Path $env:TEMP ("michat-smoke-{0}" -f ([guid]::NewGuid()))
}
$UserDataDir = [System.IO.Path]::GetFullPath($UserDataDir)
if ($UserDataDir.Length -gt 3) {
  $UserDataDir = $UserDataDir.TrimEnd('\')
}
if ($UserDataDir -match '"') {
  throw 'UserDataDir cannot contain a double quote'
}
$configDir = $UserDataDir
$configPath = Join-Path $configDir 'michat-config.json'
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
  $stdoutPath = Join-Path $env:TEMP ("michat-parser-smoke-out-{0}.log" -f ([guid]::NewGuid()))
  $stderrPath = Join-Path $env:TEMP ("michat-parser-smoke-err-{0}.log" -f ([guid]::NewGuid()))
  try {
    $parser = Start-Process -FilePath $exePath `
      -ArgumentList "--smoke-parser=`"$fixture`"", "--user-data-dir=`"$UserDataDir`"" `
      -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $exitCode = $parser.ExitCode
    $output = @()
    if (Test-Path $stdoutPath) { $output += Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $stderrPath) { $output += Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue }
    $output = ($output -join "`n")
  } finally {
    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
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

  $proc = Start-Process -FilePath $resolvedExe -ArgumentList "--remote-debugging-port=$Port", "--user-data-dir=`"$UserDataDir`"" -PassThru
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
  const startButton = () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons[buttons.length - 1];
  };
  const tick = () => {
    const button = startButton();
    // The minimal preload exposes only window.api (no window.electron), and
    // the start button label is locale-dependent, so identify the button by
    // DOM position: the language selector is the only button before it.
    if (window.api && button && button.innerText.trim().length > 0) resolve({ ready: true, hasApi: true, buttonLabel: button.innerText, url: location.href, text: document.body.innerText });
    else if (Date.now() - started > 15000) resolve({ ready: false, hasApi: !!window.api, buttonCount: document.querySelectorAll('button').length, url: location.href, text: document.body.innerText });
    else setTimeout(tick, 250);
  };
  tick();
})
"@

  $ready = Send-Cdp 'Runtime.evaluate' @{ expression = $waitExpression; awaitPromise = $true; returnByValue = $true }
  if (-not $ready.result.result.value.ready) {
    throw ("Packaged app did not expose the preload API/onboarding in time: " + ($ready.result.result.value | ConvertTo-Json -Compress))
  }

  Send-Cdp 'Runtime.evaluate' @{ expression = "Array.from(document.querySelectorAll('button')).pop().click(); 'clicked'"; returnByValue = $true } | Out-Null
  Start-Sleep -Seconds 3

  $after = Send-Cdp 'Runtime.evaluate' @{ expression = "({ url: location.href, text: document.body.innerText, hasApi: !!window.api })"; returnByValue = $true }
  $state = $after.result.result.value
  if (-not $state.hasApi -or $state.url -notmatch '#/$') {
    throw ("Onboarding did not complete successfully: " + ($state | ConvertTo-Json -Compress))
  }

  $expectedVersion = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
  $versionResult = Send-Cdp 'Runtime.evaluate' @{ expression = 'window.api.getAppVersion()'; awaitPromise = $true; returnByValue = $true }
  $packagedVersion = $versionResult.result.result.value
  if ($packagedVersion -ne $expectedVersion) {
    throw "Packaged app reports version '$packagedVersion', expected '$expectedVersion'"
  }
  Write-Host "[version] packaged app reports $packagedVersion"

  Write-Host 'Packaged smoke test passed'
} finally {
  if ($ws) { $ws.Dispose() }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  if ($autoUserDataDir -and (Test-Path $UserDataDir)) {
    Remove-Item -Recurse -Force $UserDataDir -ErrorAction SilentlyContinue
  }
}
