/* global Office, document, console, fetch, AbortController, EventSource, sessionStorage, location, WebSocket, setTimeout, clearTimeout */

var BRIDGE_URL = 'https://localhost:18327'

var isConnected = false
var currentView = 'chat'
var currentChatTab = 'chat-messages'
var activeAbortController = null
var lastResponse = ''
var pendingWriteAction = null
var pendingWriteText = ''
var lastAssistantMessageEl = null
var officeSessionId = sessionStorage.getItem('michat-office-session-id') || ''
var officeToolSocket = null
var officeToolSocketHost = ''
var officeToolSocketReconnectTimer = null
var officeToolSocketReconnectDelay = 1000

// ---------- Initialize ----------
Office.onReady(function (info) {
  var hostEl = document.getElementById('doc-host')
  if (hostEl && info && info.host) {
    hostEl.textContent = info.host.charAt(0).toUpperCase() + info.host.slice(1)
  }
  configureHostExperience(info && info.host)
  registerOfficeSession(info)
  checkBridge()
  setInterval(checkBridge, 5000 + Math.random() * 1000)
})

function configureHostExperience(host) {
  var guide = document.getElementById('action-guide')
  var wordActions = document.getElementById('word-actions')
  var excelActions = document.getElementById('excel-actions')

  if (host === Office.HostType.Excel) {
    if (wordActions) wordActions.classList.add('hidden')
    if (excelActions) excelActions.classList.remove('hidden')
    if (guide)
      guide.textContent = 'Chọn một ô hoặc vùng dữ liệu trong Excel, rồi chọn tác vụ bảng tính.'
    return
  }

  if (wordActions) wordActions.classList.remove('hidden')
  if (excelActions) excelActions.classList.add('hidden')
  if (guide) guide.textContent = 'Bôi đen đoạn văn bản trong Word, rồi chọn tác vụ cần làm.'
}

function getHostSystemPrompt() {
  if (Office.context && Office.context.host === Office.HostType.Excel) {
    return 'Excel assistant: Use the selected range only unless the user explicitly asks for workbook-wide help. Keep answers short: max 5 bullets unless transforming data.'
  }

  if (Office.context && Office.context.host === Office.HostType.Word) {
    return 'Word assistant: Use selectedText when source is selection. Keep answers short. Summaries: 2-4 Vietnamese bullets. Rewrites/translations: return only transformed document-ready text.'
  }

  return 'Office assistant: Help with the current Office document using the provided context. Keep answers short.'
}

function getOfficeHostName(host) {
  if (host === Office.HostType.Excel) return 'excel'
  if (host === Office.HostType.Word) return 'word'
  return ''
}

function normalizeIntentText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function routeLocalIntent(text, host) {
  var normalized = normalizeIntentText(text)
  if (
    /\b(khong|khong can|dung|do not|don't)\s+(tom tat|summarize|viet lai|rewrite|dich|translate|polish|chinh)/.test(
      normalized
    )
  )
    return null
  var intents = []
  if (/\b(tom tat|rut gon|summary|summarize)\b/.test(normalized)) intents.push('summarize')
  if (/\b(viet lai|dien dat lai|rewrite|rephrase)\b/.test(normalized)) intents.push('rewrite')
  if (/\b(chinh van phong|sua loi|polish|proofread)\b/.test(normalized)) intents.push('polish')
  if (/\b(dich|translate)\b/.test(normalized)) {
    if (/\b(tieng anh|english|en)\b/.test(normalized)) intents.push('translate_en')
    else if (/\b(tieng nhat|japanese|ja)\b/.test(normalized)) intents.push('translate_ja')
    else intents.push('translate_vi')
  }
  if (host === Office.HostType.Excel) {
    if (/\b(cong thuc|formula)\b/.test(normalized)) intents.push('formula')
    if (/\b(phan tich|analyze|analysis)\b/.test(normalized)) intents.push('analyze_table')
    if (/\b(lam sach|clean)\b/.test(normalized)) intents.push('clean_data')
  }
  return intents.length === 1 ? intents[0] : null
}

function getOfficeToolNames(host) {
  if (host === Office.HostType.Excel) {
    return ['excel_get_selected_range', 'excel_write_selected_range']
  }

  if (host === Office.HostType.Word) {
    return [
      'word_get_selection_text',
      'word_get_document_text',
      'word_get_document_context',
      'word_replace_selection',
      'word_insert_at_cursor',
      'word_append_to_document'
    ]
  }

  return []
}

async function registerOfficeSession(info) {
  var host = getOfficeHostName(info && info.host)
  if (!host) return

  try {
    var res = await fetch(BRIDGE_URL + '/office/session/hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: officeSessionId,
        host: host,
        url: location.href,
        documentTitle: document.title || host,
        tools: getOfficeToolNames(info && info.host)
      })
    })

    if (!res.ok) return
    var body = await res.json()
    if (body.sessionId) {
      officeSessionId = body.sessionId
      sessionStorage.setItem('michat-office-session-id', officeSessionId)
      connectOfficeToolSocket(host)
    }
  } catch (_) {}
}

function getOfficeToolSocketUrl() {
  return BRIDGE_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/office/ws'
}

function scheduleOfficeToolSocketReconnect() {
  if (!officeSessionId || !officeToolSocketHost || officeToolSocketReconnectTimer) return
  officeToolSocketReconnectTimer = setTimeout(function () {
    officeToolSocketReconnectTimer = null
    connectOfficeToolSocket(officeToolSocketHost)
  }, officeToolSocketReconnectDelay)
  officeToolSocketReconnectDelay = Math.min(officeToolSocketReconnectDelay * 2, 10000)
}

function sendOfficeToolSocketMessage(message) {
  if (!officeToolSocket || officeToolSocket.readyState !== WebSocket.OPEN) return
  officeToolSocket.send(JSON.stringify(message))
}

function handleOfficeToolSocketMessage(event) {
  var message
  try {
    message = JSON.parse(event.data)
  } catch (_) {
    return
  }

  if (message.type === 'ping') {
    sendOfficeToolSocketMessage({
      type: 'pong',
      requestId: message.requestId,
      sessionId: officeSessionId,
      host: officeToolSocketHost
    })
    return
  }

  if (message.type === 'echo_request') {
    sendOfficeToolSocketMessage({
      type: 'echo_result',
      requestId: message.requestId,
      sessionId: officeSessionId,
      host: officeToolSocketHost,
      payload: message.payload
    })
    return
  }

  if (message.type === 'office_tool_call') {
    handleOfficeToolCall(message)
    return
  }
}

function handleOfficeToolCall(message) {
  var requestId = message.requestId
  var payload = message.payload || {}
  var toolName = payload.name
  var toolArgs = payload.args || {}

  if (!toolName) {
    sendOfficeToolError(requestId, 'Missing tool name')
    return
  }

  var executor = officeToolExecutors[toolName]
  if (!executor) {
    sendOfficeToolError(requestId, 'Unknown tool: ' + toolName)
    return
  }

  try {
    var resultPromise = executor(toolArgs)
    if (resultPromise && typeof resultPromise.then === 'function') {
      resultPromise
        .then(function (result) {
          sendOfficeToolResult(requestId, result)
        })
        .catch(function (err) {
          sendOfficeToolError(requestId, err.message || String(err))
        })
    } else {
      sendOfficeToolResult(requestId, resultPromise)
    }
  } catch (err) {
    sendOfficeToolError(requestId, err.message || String(err))
  }
}

function sendOfficeToolResult(requestId, payload) {
  sendOfficeToolSocketMessage({
    type: 'office_tool_result',
    requestId: requestId,
    sessionId: officeSessionId,
    host: officeToolSocketHost,
    payload: payload
  })
}

function sendOfficeToolError(requestId, error) {
  sendOfficeToolSocketMessage({
    type: 'office_tool_error',
    requestId: requestId,
    sessionId: officeSessionId,
    host: officeToolSocketHost,
    payload: { error: error }
  })
}

var officeToolExecutors = {}

// ---------- Office Tool Executors ----------

function executeWordGetSelectionText() {
  return new Promise(function (resolve, reject) {
    if (!(Office.context && Office.context.host === Office.HostType.Word)) {
      reject(new Error('Not in Word host'))
      return
    }
    Word.run(function (context) {
      var selection = context.document.getSelection()
      selection.load('text')
      return context.sync().then(function () {
        resolve({ text: selection.text || '', source: 'selection' })
      })
    }).catch(function (err) {
      reject(err)
    })
  })
}

function executeWordGetDocumentText() {
  return new Promise(function (resolve, reject) {
    if (!(Office.context && Office.context.host === Office.HostType.Word)) {
      reject(new Error('Not in Word host'))
      return
    }
    Word.run(function (context) {
      var body = context.document.body
      body.load('text')
      return context.sync().then(function () {
        resolve({ text: body.text || '', source: 'document' })
      })
    }).catch(function (err) {
      reject(err)
    })
  })
}

function executeWordGetDocumentContext() {
  return new Promise(function (resolve, reject) {
    if (!(Office.context && Office.context.host === Office.HostType.Word)) {
      reject(new Error('Not in Word host'))
      return
    }
    Word.run(function (context) {
      var selection = context.document.getSelection()
      selection.load('text')
      var body = context.document.body
      body.load('text,paragraphs/items')
      var paragraphs = body.paragraphs
      paragraphs.load('items/text,items/style')
      return context.sync().then(function () {
        var fullText = body.text || ''
        var selectionText = selection.text || ''
        var paraItems = paragraphs.items || []
        var paragraphsArray = paraItems.map(function (p, idx) {
          return { index: idx, text: p.text || '', style: p.style || '' }
        })
        var headings = paragraphsArray
          .filter(function (p) {
            return p.style && p.style.toLowerCase().indexOf('heading') >= 0
          })
          .map(function (p) {
            return {
              level: parseInt(p.style.replace(/\D/g, '')) || 1,
              text: p.text,
              index: p.index
            }
          })

        var wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0

        resolve({
          mode: selectionText ? 'selection' : 'full',
          source: selectionText ? 'selection' : 'document',
          selectedText: selectionText,
          content: selectionText || fullText,
          metadata: {
            charCount: fullText.length,
            wordCount: wordCount,
            selectedCharCount: selectionText.length
          },
          paragraphs: paragraphsArray,
          outline: headings
        })
      })
    }).catch(function (err) {
      reject(err)
    })
  })
}

function confirmAndExecuteWrite(action, text, executorFn) {
  return new Promise(function (resolve, reject) {
    if (pendingWriteExecutor) {
      reject(new Error('Another Office write is awaiting confirmation'))
      return
    }
    pendingWriteAction = action
    pendingWriteText = text
    pendingWriteExecutor = executorFn
    pendingWriteResolve = resolve
    pendingWriteReject = reject
    var actionLabel =
      action === 'replace'
        ? 'Replace selection'
        : action === 'insert'
          ? 'Insert at cursor'
          : action === 'write'
            ? 'Write selected Excel range'
            : 'Append to document'
    showConfirmDialog(actionLabel + ' with AI response?')
  })
}

function executeWordReplaceSelection(args) {
  var text = args && args.text ? args.text : ''
  if (!text) return Promise.reject(new Error('Missing text argument'))
  return confirmAndExecuteWrite('replace', text, function (t) {
    return new Promise(function (resolve, reject) {
      Word.run(function (context) {
        var selection = context.document.getSelection()
        selection.insertText(t, Word.InsertLocation.replace)
        return context.sync()
      })
        .then(resolve)
        .catch(reject)
    })
  })
}

function executeWordInsertAtCursor(args) {
  var text = args && args.text ? args.text : ''
  if (!text) return Promise.reject(new Error('Missing text argument'))
  return confirmAndExecuteWrite('insert', text, function (t) {
    return new Promise(function (resolve, reject) {
      Word.run(function (context) {
        var selection = context.document.getSelection()
        selection.insertText(t, Word.InsertLocation.after)
        return context.sync()
      })
        .then(resolve)
        .catch(reject)
    })
  })
}

function executeWordAppendToDocument(args) {
  var text = args && args.text ? args.text : ''
  if (!text) return Promise.reject(new Error('Missing text argument'))
  return confirmAndExecuteWrite('append', text, function (t) {
    return new Promise(function (resolve, reject) {
      Word.run(function (context) {
        var body = context.document.body
        body.insertText(t, Word.InsertLocation.end)
        return context.sync()
      })
        .then(resolve)
        .catch(reject)
    })
  })
}

function executeExcelGetSelectedRange() {
  return new Promise(function (resolve, reject) {
    if (!(Office.context && Office.context.host === Office.HostType.Excel)) {
      reject(new Error('Not in Excel host'))
      return
    }
    Excel.run(function (context) {
      var range = context.workbook.getSelectedRange()
      range.load('values,address,rowCount,columnCount')
      return context.sync().then(function () {
        var vals = range.values
        if (!vals || vals.length === 0) {
          resolve({ values: [], address: '', rowCount: 0, columnCount: 0 })
          return
        }
        resolve({
          values: vals,
          address: range.address || '',
          rowCount: range.rowCount,
          columnCount: range.columnCount
        })
      })
    }).catch(function (err) {
      reject(err)
    })
  })
}

function executeExcelWriteSelectedRange(args) {
  var values = args && args.values ? args.values : null
  if (
    !values ||
    !Array.isArray(values) ||
    values.length === 0 ||
    !Array.isArray(values[0]) ||
    values[0].length === 0
  ) {
    return Promise.reject(
      new Error('Missing or invalid values argument (expected non-empty 2D array)')
    )
  }
  var columnCount = values[0].length
  for (var i = 0; i < values.length; i++) {
    if (!Array.isArray(values[i]) || values[i].length !== columnCount) {
      return Promise.reject(new Error('Invalid values argument (rows must be rectangular)'))
    }
  }
  return confirmAndExecuteWrite('write', JSON.stringify(values), function (_) {
    return new Promise(function (resolve, reject) {
      Excel.run(function (context) {
        var range = context.workbook.getSelectedRange()
        var target = range.getResizedRange(values.length - 1, columnCount - 1)
        target.values = values
        return context.sync()
      })
        .then(function () {
          resolve({ success: true })
        })
        .catch(reject)
    })
  })
}

// Register executors
officeToolExecutors['word_get_selection_text'] = executeWordGetSelectionText
officeToolExecutors['word_get_document_text'] = executeWordGetDocumentText
officeToolExecutors['word_get_document_context'] = executeWordGetDocumentContext
officeToolExecutors['word_replace_selection'] = executeWordReplaceSelection
officeToolExecutors['word_insert_at_cursor'] = executeWordInsertAtCursor
officeToolExecutors['word_insert_after_selection'] = executeWordInsertAtCursor
officeToolExecutors['word_append_to_document'] = executeWordAppendToDocument
officeToolExecutors['excel_get_selected_range'] = executeExcelGetSelectedRange
officeToolExecutors['excel_write_selected_range'] = executeExcelWriteSelectedRange

var pendingWriteExecutor = null
var pendingWriteResolve = null
var pendingWriteReject = null

function connectOfficeToolSocket(host) {
  if (!officeSessionId || !host || typeof WebSocket === 'undefined') return
  officeToolSocketHost = host

  if (officeToolSocket && officeToolSocket.readyState <= WebSocket.OPEN) return
  if (officeToolSocketReconnectTimer) {
    clearTimeout(officeToolSocketReconnectTimer)
    officeToolSocketReconnectTimer = null
  }

  try {
    officeToolSocket = new WebSocket(getOfficeToolSocketUrl())
  } catch (_) {
    scheduleOfficeToolSocketReconnect()
    return
  }

  officeToolSocket.onopen = function () {
    officeToolSocketReconnectDelay = 1000
    sendOfficeToolSocketMessage({
      type: 'hello',
      requestId: 'taskpane-hello-' + Date.now(),
      sessionId: officeSessionId,
      host: officeToolSocketHost
    })
  }
  officeToolSocket.onmessage = handleOfficeToolSocketMessage
  officeToolSocket.onclose = scheduleOfficeToolSocketReconnect
  officeToolSocket.onerror = function () {}
}

// ---------- View Switching ----------
function switchView(view) {
  var viewEl = document.getElementById(view + '-view')
  if (!viewEl) return
  currentView = view
  document.querySelectorAll('.view').forEach(function (el) {
    el.classList.remove('active')
  })
  viewEl.classList.add('active')
}

function showChatTab(tab) {
  var panelEl = document.getElementById(tab)
  var tabEl = document.querySelector('.chat-tab[data-tab="' + tab + '"]')
  if (!panelEl || !tabEl) return
  currentChatTab = tab
  document.querySelectorAll('.chat-panel').forEach(function (el) {
    el.classList.remove('active')
  })
  document.querySelectorAll('.chat-tab').forEach(function (el) {
    el.classList.remove('active')
  })
  panelEl.classList.add('active')
  tabEl.classList.add('active')
}

// ---------- Status ----------
function updateStatus(connected) {
  isConnected = connected
  var dot = document.getElementById('status-indicator')
  var text = document.getElementById('status-text')
  var btn = document.getElementById('btn-read')

  if (connected) {
    dot.className = 'status-dot connected'
    text.textContent = 'Connected'
    if (btn) btn.classList.remove('hidden')
  } else {
    dot.className = 'status-dot disconnected'
    text.textContent = 'Disconnected'
    if (btn) btn.classList.add('hidden')
  }
}

function createTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms)
  var controller = new AbortController()
  setTimeout(function () {
    controller.abort()
  }, ms)
  return controller.signal
}

async function checkBridge() {
  try {
    var res = await fetch(BRIDGE_URL + '/office/health', { signal: createTimeoutSignal(3000) })
    if (res.ok) {
      var data = await res.json()
      document.getElementById('bridge-status').textContent = 'Bridge: Online (' + data.version + ')'
      updateStatus(true)
      return
    }
  } catch (_e) {}
  document.getElementById('bridge-status').textContent = 'Bridge: Offline'
  updateStatus(false)
}

// ---------- Document Reading ----------
function normalizeSelectedText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function getSelectedContextForChat() {
  return new Promise(function (resolve, reject) {
    if (Office.context && Office.context.host === Office.HostType.Word) {
      Word.run(function (context) {
        var selection = context.document.getSelection()
        selection.load('text')
        return context.sync().then(function () {
          var selectedText = normalizeSelectedText(selection.text)
          resolve({
            mode: selectedText ? 'selection' : 'none',
            source: selectedText ? 'selection' : 'none',
            selectedText: selectedText,
            content: selectedText,
            metadata: { selectedCharCount: selectedText.length }
          })
        })
      }).catch(function (err) {
        reject(err.message || err)
      })
      return
    }

    getDocumentContent().then(resolve).catch(reject)
  })
}

function getDocumentContextForChat() {
  if (Office.context && Office.context.host === Office.HostType.Word) {
    return executeWordGetDocumentContext()
  }

  return getDocumentContent()
}

function getDocumentContent() {
  return new Promise(function (resolve, reject) {
    if (Office.context && Office.context.host === Office.HostType.Word) {
      Word.run(function (context) {
        var selection = context.document.getSelection()
        selection.load('text')
        return context.sync().then(function () {
          if (selection.text && selection.text.trim()) {
            resolve({ text: selection.text, source: 'selection' })
          } else {
            var body = context.document.body
            body.load('text')
            return context.sync().then(function () {
              resolve({ text: body.text || '', source: 'document' })
            })
          }
        })
      }).catch(function (err) {
        reject(err.message)
      })
    } else if (Office.context && Office.context.host === Office.HostType.Excel) {
      Excel.run(function (context) {
        var range = context.workbook.getSelectedRange()
        range.load('values,address,rowCount,columnCount')
        return context.sync().then(function () {
          var vals = range.values
          if (!vals || vals.length === 0) {
            resolve({ text: '', source: 'selection' })
            return
          }
          var rows = []
          for (var i = 0; i < vals.length; i++) {
            rows.push(vals[i].join('\t'))
          }
          var address = range.address ? 'Range: ' + range.address + '\n' : ''
          resolve({ text: address + rows.join('\n'), source: 'selection' })
        })
      }).catch(function (err) {
        reject(err.message)
      })
    } else {
      reject('Unsupported host')
    }
  })
}

function readDocument() {
  var statusEl = document.getElementById('bridge-status')
  statusEl.textContent = 'Reading document...'

  getDocumentContent()
    .then(function (result) {
      var preview = result.text.substring(0, 200) + (result.text.length > 200 ? '...' : '')
      statusEl.textContent = 'Read: ' + result.text.length + ' chars (' + result.source + ')'
      addMessage(
        'system',
        result.source.charAt(0).toUpperCase() +
          result.source.slice(1) +
          ' content (' +
          result.text.length +
          ' chars):\n' +
          preview
      )
      updateContextBadge(result.source)
      switchView('chat')
      showChatTab('chat-messages')
    })
    .catch(function (err) {
      statusEl.textContent = 'Error: ' + err
    })
}

function updateContextBadge(source) {
  var badge = document.getElementById('context-badge')
  if (badge) {
    badge.textContent =
      'Context: ' +
      (source === 'selection' ? 'Selection' : source === 'document' ? 'Full Document' : 'None')
  }
}

function updateSkillBadge(skillNames) {
  var badge = document.getElementById('skill-badge')
  if (!badge) return
  var names = Array.isArray(skillNames) ? skillNames.filter(Boolean) : []
  badge.textContent = 'Skills: ' + (names.length ? names.join(', ') : 'None')
}

// ---------- Streaming Chat ----------
function sendMessage() {
  if (activeAbortController) {
    cancelStream()
    return
  }

  var input = document.getElementById('chat-input')
  var text = input.value.trim()
  if (!text) return

  addMessage('user', text)
  input.value = ''
  showChatTab('chat-messages')
  updateContextBadge('none')
  updateSkillBadge([])

  var msgEl = addMessage('assistant', 'Thinking...')
  msgEl.className = 'message assistant pending'
  clearMessageActions()
  setStreamingState(true)

  getDocumentContextForChat()
    .then(function (result) {
      updateContextBadge(result.source)
      var localIntent = routeLocalIntent(text, Office.context && Office.context.host)
      var selectedText = result.selectedText || result.text || ''
      if (localIntent && selectedText) {
        return doStreamChat(
          '/office/action/' + localIntent,
          {
            text: selectedText,
            systemPrompt: getHostSystemPrompt(),
            host: getOfficeHostName(Office.context && Office.context.host),
            outputBudget: 'short'
          },
          msgEl,
          result.source
        )
      }

      var userContent =
        result.source === 'selection'
          ? text +
            '\n\nUse the currently selected Word text as the input. Do not ask the user to paste it again.'
          : text
      var messages = [{ role: 'user', content: userContent }]
      var documentContext = result.content ? result : result.text || ''

      return doStreamChat(
        '/office/api/chat',
        {
          messages: messages,
          documentContext: documentContext,
          systemPrompt: getHostSystemPrompt(),
          sessionId: officeSessionId,
          host: getOfficeHostName(Office.context && Office.context.host),
          outputBudget: 'short'
        },
        msgEl,
        result.source
      )
    })
    .catch(function (err) {
      if (err === 'Unsupported host') {
        updateContextBadge('none')
        return doStreamChat(
          '/office/api/chat',
          {
            messages: [{ role: 'user', content: text }],
            documentContext: '',
            systemPrompt: getHostSystemPrompt(),
            sessionId: officeSessionId,
            host: getOfficeHostName(Office.context && Office.context.host)
          },
          msgEl,
          'none'
        )
      }

      msgEl.className = 'message assistant error'
      msgEl.textContent = 'Error: ' + err
      setStreamingState(false)
    })
}

function runQuickAction(action) {
  showChatTab('chat-messages')
  var msgEl = addMessage('assistant', 'Running ' + action + '...')
  msgEl.className = 'message assistant pending'
  clearMessageActions()
  setStreamingState(true)
  hideTranslateMenu()

  getSelectedContextForChat()
    .then(function (result) {
      var text = result.selectedText || result.text || ''
      if (!text) {
        msgEl.className = 'message assistant error'
        msgEl.textContent = 'No text selected. Please select text in your document first.'
        setStreamingState(false)
        return
      }

      var actionLabels = {
        summarize: 'Tóm tắt',
        rewrite: 'Viết lại',
        polish: 'Chỉnh văn phong',
        translate_vi: 'Dịch sang tiếng Việt',
        translate_en: 'Dịch sang tiếng Anh',
        translate_ja: 'Dịch sang tiếng Nhật'
      }
      addMessage('system', actionLabels[action] || action)

      return doStreamChat(
        '/office/action/' + action,
        {
          text: text,
          systemPrompt: getHostSystemPrompt(),
          host: getOfficeHostName(Office.context && Office.context.host),
          outputBudget: 'short'
        },
        msgEl,
        result.source
      )
    })
    .catch(function (err) {
      msgEl.className = 'message assistant error'
      msgEl.textContent = 'Error: ' + err
      setStreamingState(false)
    })
}

function doStreamChat(endpoint, body, msgEl, contextSource) {
  return new Promise(function (resolve, reject) {
    var controller = new AbortController()
    activeAbortController = controller
    setStreamingState(true)

    lastResponse = ''

    fetch(BRIDGE_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            throw new Error(data.error || 'Bridge error: ' + res.status)
          })
        }

        var reader = res.body.getReader()
        var decoder = new TextDecoder()
        var buffer = ''

        function readLoop() {
          reader
            .read()
            .then(function (result) {
              if (result.done) {
                msgEl.className = 'message assistant'
                if (lastResponse) {
                  attachMessageActions(msgEl, lastResponse)
                }
                setStreamingState(false)
                activeAbortController = null
                resolve()
                return
              }

              buffer += decoder.decode(result.value, { stream: true })
              var lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (var i = 0; i < lines.length; i++) {
                var line = lines[i]
                if (line.startsWith('event: ')) {
                  var eventType = line.slice(7).trim()
                  var dataLine = lines[i + 1]
                  if (dataLine && dataLine.startsWith('data: ')) {
                    var data = JSON.parse(dataLine.slice(6))
                    if (eventType === 'chunk' && data.content) {
                      lastResponse += data.content
                      msgEl.textContent = lastResponse
                    } else if (eventType === 'skills') {
                      updateSkillBadge(data.skills || [])
                    } else if (eventType === 'done') {
                      msgEl.className = 'message assistant'
                      if (lastResponse) {
                        attachMessageActions(msgEl, lastResponse)
                      }
                      setStreamingState(false)
                      activeAbortController = null
                      resolve()
                      return
                    } else if (eventType === 'error') {
                      throw new Error(data.message || 'Stream error')
                    }
                    i++ // skip the data line
                  }
                }
              }

              if (!result.done) {
                readLoop()
              }
            })
            .catch(function (err) {
              if (err.name === 'AbortError') {
                msgEl.textContent = (lastResponse || '') + '\n\n[Cancelled]'
                msgEl.className = 'message assistant'
              } else {
                msgEl.className = 'message assistant error'
                msgEl.textContent = 'Error: ' + err.message
              }
              setStreamingState(false)
              activeAbortController = null
              reject(err)
            })
        }

        readLoop()
      })
      .catch(function (err) {
        msgEl.className = 'message assistant error'
        msgEl.textContent = 'Error: ' + err.message
        setStreamingState(false)
        activeAbortController = null
        reject(err)
      })
  })
}

function cancelStream() {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
  setStreamingState(false)
}

// ---------- Messages ----------
function addMessage(type, text) {
  var list = document.getElementById('message-list')
  var msg = document.createElement('div')
  msg.className = 'message ' + type
  msg.textContent = text
  list.appendChild(msg)
  list.scrollTop = list.scrollHeight
  if (type === 'assistant') {
    lastAssistantMessageEl = msg
  }
  return msg
}

// ---------- Translate Menu ----------
function showTranslateMenu() {
  var menu = document.getElementById('translate-menu')
  menu.classList.toggle('hidden')
}

function hideTranslateMenu() {
  document.getElementById('translate-menu').classList.add('hidden')
}

// ---------- Message Actions (Write-back) ----------
function clearMessageActions() {
  document.querySelectorAll('.message-actions').forEach(function (el) {
    el.remove()
  })
}

function setStreamingState(streaming) {
  var btn = document.getElementById('btn-send')
  if (!btn) return

  if (streaming) {
    btn.classList.add('stop')
    btn.innerHTML = '&#9632;'
    btn.title = 'Stop'
  } else {
    btn.classList.remove('stop')
    btn.innerHTML = '&#9658;'
    btn.title = 'Send'
  }
}

function attachMessageActions(messageEl, responseText) {
  if (!messageEl || !responseText) return
  var existing = messageEl.querySelector('.message-actions')
  if (existing) existing.remove()

  var actions = document.createElement('div')
  actions.className = 'message-actions'
  actions.appendChild(
    createMessageActionButton('&#128203;', 'Copy', function () {
      copyResult(responseText)
    })
  )
  actions.appendChild(
    createMessageActionButton('&#10549;', 'Insert after selection', function () {
      insertResult(responseText)
    })
  )
  actions.appendChild(
    createMessageActionButton('&#8634;', 'Replace selection', function () {
      replaceSelection(responseText)
    })
  )
  messageEl.appendChild(actions)
}

function createMessageActionButton(iconHtml, title, onClick) {
  var button = document.createElement('button')
  button.className = 'message-action-btn'
  button.title = title
  button.innerHTML = iconHtml
  button.addEventListener('click', onClick)
  return button
}

function copyResult(responseText) {
  if (!responseText || !navigator.clipboard) return
  navigator.clipboard
    .writeText(responseText)
    .then(function () {
      addMessage('system', 'Copied to clipboard.')
    })
    .catch(function () {
      addMessage('system', 'Copy failed.')
    })
}

function insertResult(responseText) {
  if (!responseText) return
  pendingWriteAction = 'insert'
  pendingWriteText = responseText
  showConfirmDialog('Insert the AI response after the current selection?')
}

function replaceSelection(responseText) {
  if (!responseText) return
  pendingWriteAction = 'replace'
  pendingWriteText = responseText
  showConfirmDialog('Replace the current selection with the AI response?')
}

function parseExcelResponse(responseText) {
  var lines = responseText.split(/\r?\n/).filter(function (line) {
    return line.trim() !== ''
  })
  if (lines.length === 0) return [['']]

  return lines.map(function (line) {
    var cells = line.indexOf('\t') >= 0 ? line.split('\t') : [line]
    return cells.map(function (cell) {
      return cell.trim()
    })
  })
}

function clearPendingWrite() {
  pendingWriteAction = null
  pendingWriteText = ''
  pendingWriteExecutor = null
  pendingWriteResolve = null
  pendingWriteReject = null
}

function showConfirmDialog(message) {
  var dialog = document.getElementById('confirm-dialog')
  var text = document.getElementById('confirm-text')
  if (text) text.textContent = message || 'Apply this change to the document?'
  if (dialog) dialog.classList.remove('hidden')
}

function confirmWrite() {
  document.getElementById('confirm-dialog').classList.add('hidden')
  var action = pendingWriteAction
  var responseText = pendingWriteText
  var executor = pendingWriteExecutor
  var resolvePending = pendingWriteResolve
  var rejectPending = pendingWriteReject

  if (executor) {
    clearPendingWrite()
    executor(responseText).then(function (result) {
        if (resolvePending) resolvePending(result || { success: true })
        addMessage(
          'system',
          action === 'replace'
            ? 'Selection replaced.'
            : action === 'insert'
              ? 'Text inserted.'
              : action === 'append'
                ? 'Text appended.'
                : 'Excel selection updated.'
        )
      })
      .catch(function (err) {
        if (rejectPending) rejectPending(err)
        addMessage('system', 'Write failed: ' + err)
      })
    return
  }

  pendingWriteAction = null
  pendingWriteText = ''

  if (!responseText) return

  if (Office.context && Office.context.host === Office.HostType.Word) {
    Word.run(function (context) {
      var selection = context.document.getSelection()
      if (action === 'replace') {
        selection.insertText(responseText, Word.InsertLocation.replace)
      } else if (action === 'insert') {
        selection.insertText(responseText, Word.InsertLocation.after)
      }
      return context.sync()
    })
      .then(function () {
        addMessage('system', action === 'replace' ? 'Selection replaced.' : 'Text inserted.')
      })
      .catch(function (err) {
        addMessage('system', 'Write failed: ' + err)
      })
  } else if (Office.context && Office.context.host === Office.HostType.Excel) {
    Excel.run(function (context) {
      var range = context.workbook.getSelectedRange()
      var cellValues = parseExcelResponse(responseText)
      var target = range.getResizedRange(cellValues.length - 1, cellValues[0].length - 1)
      target.values = cellValues
      return context.sync()
    })
      .then(function () {
        addMessage(
          'system',
          action === 'replace' ? 'Excel selection updated.' : 'Text inserted into Excel.'
        )
      })
      .catch(function (err) {
        addMessage('system', 'Write failed: ' + err)
      })
  } else {
    addMessage('system', 'Write not supported on this host.')
  }
}

function cancelWrite() {
  document.getElementById('confirm-dialog').classList.add('hidden')
  var rejectPending = pendingWriteReject
  clearPendingWrite()
  if (rejectPending) rejectPending(new Error('User cancelled Office write'))
}

function initializeKeyboardShortcuts() {
  var input = document.getElementById('chat-input')
  if (!input) return

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  })
}

initializeKeyboardShortcuts()
