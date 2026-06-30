import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const taskpaneHtml = () =>
  readFileSync(join(process.cwd(), 'src/office-addin/shared/taskpane.html'), 'utf8')
const taskpaneJs = () =>
  readFileSync(join(process.cwd(), 'src/office-addin/shared/taskpane.js'), 'utf8')

function extractFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`)
  if (start < 0) return ''
  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction < 0 ? source.length : nextFunction)
}

describe('Office taskpane UX', () => {
  it('shows one connection status and keeps chat visible by default', () => {
    const html = taskpaneHtml()

    expect(html).toContain('id="status-text"')
    expect(html).toContain('id="model-badge">Michat</div>')
    expect(html).toContain('id="chat-view" class="view active"')
    expect(html).toContain('data-tab="chat-messages"')
    expect(html).not.toContain('id="tab-connection"')
    expect(html).not.toContain('Status</button>')
  })

  it('keeps utility actions inside the composer and assistant messages', () => {
    const html = taskpaneHtml()
    const js = taskpaneJs()

    expect(html).toContain('class="composer"')
    expect(html).toContain('id="btn-read-inline"')
    expect(html).toContain('id="btn-send"')
    expect(html).not.toContain('id="result-bar"')
    expect(js).toContain('if (!panelEl || !tabEl) return')
    expect(js).toContain('if (!viewEl) return')
    expect(js).toContain('function attachMessageActions(messageEl, responseText)')
    expect(js).toContain('copyResult(responseText)')
    expect(js).toContain('insertResult(responseText)')
    expect(js).toContain('replaceSelection(responseText)')
    expect(js).toContain('pendingWriteText')
    expect(js).toContain('message-action-btn')
  })

  it('separates Word and Excel quick actions', () => {
    const html = taskpaneHtml()
    const js = taskpaneJs()

    expect(html).toContain('id="word-actions"')
    expect(html).toContain('id="excel-actions"')
    expect(html).toContain("runQuickAction('formula')")
    expect(html).toContain("runQuickAction('fill_data')")
    expect(html).toContain("runQuickAction('analyze_table')")
    expect(html).toContain("runQuickAction('clean_data')")
    expect(js).toContain('function configureHostExperience')
    expect(js).toContain('Office.HostType.Excel')
    expect(js).toContain('Office.HostType.Word')
  })

  it('does not contain mojibake in Office taskpane text', () => {
    const html = taskpaneHtml()
    const js = taskpaneJs()

    expect(html).not.toMatch(/Ã|á»|Ä|Æ/)
    expect(js).not.toMatch(/Ch\?n m\?t|B\?i \?en/)
  })

  it('localizes quick actions and explains each action', () => {
    const html = taskpaneHtml()
    const js = taskpaneJs()

    expect(html).toContain('T\u00f3m t\u1eaft')
    expect(html).toContain('R\u00fat g\u1ecdn n\u1ed9i dung ch\u00ednh')
    expect(html).toContain('Vi\u1ebft l\u1ea1i')
    expect(html).toContain('Di\u1ec5n \u0111\u1ea1t l\u1ea1i r\u00f5 r\u00e0ng')
    expect(html).toContain('Ch\u1ec9nh v\u0103n phong')
    expect(html).toContain('S\u1eeda l\u1ed7i, l\u00e0m c\u00e2u ch\u1eef m\u01b0\u1ee3t')
    expect(html).toContain('B\u00f4i \u0111en n\u1ed9i dung trong Office')
    expect(html).toContain('Ti\u1ebfng Vi\u1ec7t')
    expect(js).toContain('D\u1ecbch sang ti\u1ebfng Vi\u1ec7t')
    expect(js).toContain('Chọn một ô hoặc vùng dữ liệu trong Excel')
    expect(js).toContain('Bôi đen đoạn văn bản trong Word')
  })

  it('keeps the composer anchored at the bottom of the chat panel', () => {
    const styles = readFileSync(join(process.cwd(), 'src/office-addin/shared/styles.css'), 'utf8')

    expect(styles).toContain('.content { flex: 1; min-height: 0; overflow: hidden;')
    expect(styles).toContain(
      '.chat-panel { display: none; flex-direction: column; flex: 1; min-height: 0; }'
    )
    expect(styles).toContain('padding: 12px; flex: 1; min-height: 0; overflow-y: auto;')
    expect(styles).not.toContain('max-height: calc(100vh - 300px)')
  })

  it('uses host-specific prompt context', () => {
    const js = taskpaneJs()

    expect(js).toContain('function getHostSystemPrompt')
    expect(js).toContain('Word assistant')
    expect(js).toContain('Keep answers short')
    expect(js).toContain('Summaries: 2-4 Vietnamese bullets')
    expect(js).toContain('Excel assistant')
    expect(js).toContain('systemPrompt: getHostSystemPrompt()')
  })

  it('uses a WebView-compatible timeout signal for bridge health checks', () => {
    const js = taskpaneJs()

    expect(js).toContain('function createTimeoutSignal(ms)')
    expect(js).toContain(
      "fetch(BRIDGE_URL + '/office/health', { signal: createTimeoutSignal(3000) })"
    )
  })

  it('routes obvious typed intents locally before normal chat', () => {
    const js = taskpaneJs()
    const sendMessageSource = extractFunctionSource(js, 'sendMessage')

    expect(js).toContain('function routeLocalIntent(text, host)')
    expect(js).toContain('function normalizeIntentText(text)')
    expect(js).toContain("intents.push('summarize')")
    expect(js).toContain("intents.push('rewrite')")
    expect(js).toContain("intents.push('translate_en')")
    expect(js).toContain('do not')
    expect(sendMessageSource).toContain('var localIntent = routeLocalIntent')
    expect(sendMessageSource.indexOf("'/office/action/' + localIntent")).toBeLessThan(
      sendMessageSource.indexOf("'/office/api/chat'")
    )
  })

  it('answers greetings locally in Vietnamese without document context or skills', () => {
    const js = taskpaneJs()
    const sendMessageSource = extractFunctionSource(js, 'sendMessage')

    expect(js).toContain('function isGreetingOnly(text)')
    expect(sendMessageSource).toContain('if (isGreetingOnly(text))')
    expect(sendMessageSource).toContain('Chào bạn! Mình có thể hỗ trợ gì cho tài liệu này?')
    expect(sendMessageSource.indexOf('if (isGreetingOnly(text))')).toBeLessThan(
      sendMessageSource.indexOf('getDocumentContextForChat()')
    )
  })

  it('registers the live Office runtime session with the MiChat bridge', () => {
    const js = taskpaneJs()

    expect(js).toContain('function getOfficeToolNames')
    expect(js).toContain('function registerOfficeSession')
    expect(js).toContain('function connectOfficeToolSocket')
    expect(js).toContain("'/office/session/hello'")
    expect(js).toContain("'/office/ws'")
    expect(js).toContain('sessionStorage.getItem')
    expect(js).toContain('sessionId: officeSessionId')
    expect(js).toContain("type: 'hello'")
    expect(js).toContain("type: 'pong'")
    expect(js).toContain("type: 'echo_result'")
    expect(js).toContain('word_get_document_text')
    expect(js).toContain('excel_get_selected_range')
    expect(js).not.toContain('execute_office_js')
  })

  it('writes assistant output into Excel selected cells', () => {
    const js = taskpaneJs()

    expect(js).toContain("range.load('values,address,rowCount,columnCount')")
    expect(js).toContain("Range: ' + range.address")
    expect(js).toContain('function parseExcelResponse')
    expect(js).toContain('range.getResizedRange(cellValues.length - 1, cellValues[0].length - 1)')
    expect(js).toContain('target.values = cellValues')
    expect(js).toContain('Excel selection updated.')
  })

  it('sends on Enter, preserves Shift Enter, and toggles send to stop', () => {
    const js = taskpaneJs()

    expect(js).toContain("event.key === 'Enter' && !event.shiftKey")
    expect(js).toContain('sendMessage()')
    expect(js).toContain('function setStreamingState')
    expect(js).toContain("btn.classList.add('stop')")
    expect(js).toContain('&#9632;')
    expect(js).toContain('&#9658;')
  })

  it('contains the office tool executor handler and MVP tool names', () => {
    const js = taskpaneJs()

    expect(js).toContain('var officeToolExecutors = {}')
    expect(js).toContain('function handleOfficeToolCall(message)')
    expect(js).toContain('var executor = officeToolExecutors[toolName]')

    // Word MVP tools
    expect(js).toContain("officeToolExecutors['word_get_selection_text']")
    expect(js).toContain("officeToolExecutors['word_get_document_text']")
    expect(js).toContain("officeToolExecutors['word_get_document_context']")
    expect(js).toContain("officeToolExecutors['word_replace_selection']")
    expect(js).toContain("officeToolExecutors['word_insert_at_cursor']")
    expect(js).toContain("officeToolExecutors['word_insert_after_selection']")
    expect(js).toContain("officeToolExecutors['word_append_to_document']")

    // Excel MVP tools
    expect(js).toContain("officeToolExecutors['excel_get_selected_range']")
    expect(js).toContain("officeToolExecutors['excel_write_selected_range']")
  })

  it('routes write tools through confirm dialog and pending state', () => {
    const js = taskpaneJs()

    expect(js).toContain('function confirmAndExecuteWrite(action, text, executorFn)')
    expect(js).toContain('Another Office write is awaiting confirmation')
    expect(js).toContain('Write selected Excel range')
    expect(js).toContain('pendingWriteAction = action')
    expect(js).toContain('pendingWriteText = text')
    expect(js).toContain('pendingWriteExecutor = executorFn')
    expect(js).toContain('showConfirmDialog(actionLabel')
    expect(js).toContain('function showConfirmDialog(message)')
    expect(js).toContain("document.getElementById('confirm-text')")

    // Word write executors use confirmAndExecuteWrite
    expect(js).toContain("confirmAndExecuteWrite('replace', text,")
    expect(js).toContain("confirmAndExecuteWrite('insert', text,")
    expect(js).toContain('function executeWordInsertAtCursor')
    expect(js).toContain("confirmAndExecuteWrite('append', text,")

    // Excel write executor uses confirmAndExecuteWrite
    expect(js).toContain("confirmAndExecuteWrite('write', JSON.stringify(values),")

    // Confirm dialog UI handlers
    expect(js).toContain('function confirmWrite()')
    expect(js).toContain('confirm-dialog')
  })

  it('contains all required protocol message types', () => {
    const js = taskpaneJs()

    // Inbound from bridge
    expect(js).toContain("message.type === 'office_tool_call'")

    // Outbound to bridge
    expect(js).toContain("type: 'office_tool_result'")
    expect(js).toContain("type: 'office_tool_error'")
    expect(js).toContain("type: 'pong'")
    expect(js).toContain("type: 'echo_result'")
    expect(js).toContain("type: 'hello'")

    // Protocol send functions
    expect(js).toContain('function sendOfficeToolResult(requestId, payload)')
    expect(js).toContain('function sendOfficeToolError(requestId, error)')
  })

  it('has word_get_document_context returning structured context', () => {
    const js = taskpaneJs()

    expect(js).toContain('function executeWordGetDocumentContext()')
    expect(js).toContain('mode: selectionText')
    expect(js).toContain('source: selectionText')
    expect(js).toContain('selectedText: selectionText')
    expect(js).toContain('content: selectionText || fullText')
    expect(js).toContain('charCount: fullText.length')
    expect(js).toContain('wordCount: wordCount')
    expect(js).toContain('selectedCharCount: selectionText.length')
    expect(js).toContain('paragraphs: paragraphsArray')
    expect(js).toContain('outline: headings')
  })

  it('advertises only taskpane-executable MVP tools', () => {
    const toolsSource = extractFunctionSource(taskpaneJs(), 'getOfficeToolNames')

    expect(toolsSource).toContain('word_get_document_context')
    expect(toolsSource).toContain('excel_get_selected_range')
    expect(toolsSource).toContain('excel_write_selected_range')
    expect(toolsSource).not.toContain('word_get_document_metadata')
    expect(toolsSource).not.toContain('excel_get_used_range')
    expect(toolsSource).not.toContain('excel_get_workbook_summary')
    expect(toolsSource).not.toContain('excel_insert_formula')
  })

  it('sends structured Word context and the Office session id with chat requests', () => {
    const js = taskpaneJs()
    const sendMessageSource = extractFunctionSource(js, 'sendMessage')
    const contextSource = extractFunctionSource(js, 'getSelectedContextForChat')

    expect(js).toContain('function getDocumentContextForChat')
    expect(js).toContain('return executeWordGetDocumentContext()')
    expect(contextSource).toContain("selection.load('text')")
    expect(contextSource).toContain('selectedText: selectedText')
    expect(contextSource).not.toContain("body.load('text,paragraphs/items')")
    expect(sendMessageSource).toContain('updateContextBadge(result.source)')
    expect(sendMessageSource).toContain('Use the currently selected Word text as the input')
    expect(sendMessageSource).toContain('outputBudget')
    expect(sendMessageSource).toContain('sessionId: officeSessionId')
  })

  it('resolves or rejects bridge-initiated write promises from confirm and cancel handlers', () => {
    const js = taskpaneJs()
    const confirmSource = extractFunctionSource(js, 'confirmWrite')
    const cancelSource = extractFunctionSource(js, 'cancelWrite')

    expect(confirmSource).toContain('var executor = pendingWriteExecutor')
    expect(confirmSource).toContain('var resolvePending = pendingWriteResolve')
    expect(confirmSource).toContain('var rejectPending = pendingWriteReject')
    expect(confirmSource).toContain('executor(responseText).then')
    expect(confirmSource).toContain('if (resolvePending) resolvePending')
    expect(confirmSource).toContain('if (rejectPending) rejectPending')
    expect(cancelSource).toContain("new Error('User cancelled Office write')")
    expect(js).toContain('function clearPendingWrite()')
  })

  it('uses selection-only context and short budget for quick actions', () => {
    const runQuickActionSource = extractFunctionSource(taskpaneJs(), 'runQuickAction')

    expect(runQuickActionSource).toContain('getSelectedContextForChat()')
    expect(runQuickActionSource).toContain('var text = result.selectedText || result.text ||')
    expect(runQuickActionSource).toContain('outputBudget')
  })

  it('validates Excel write tool values before resizing the selected range', () => {
    const excelWriteSource = extractFunctionSource(taskpaneJs(), 'executeExcelWriteSelectedRange')

    expect(excelWriteSource).toContain('expected non-empty 2D array')
    expect(excelWriteSource).toContain('var columnCount = values[0].length')
    expect(excelWriteSource).toContain('rows must be rectangular')
    expect(excelWriteSource).toContain('columnCount - 1')
  })

  it('shows active Office skill state and sends host metadata', () => {
    const html = taskpaneHtml()
    const js = taskpaneJs()
    const sendMessageSource = extractFunctionSource(js, 'sendMessage')
    const runQuickActionSource = extractFunctionSource(js, 'runQuickAction')

    expect(html).toContain('id="skill-badge"')
    expect(js).toContain('function updateSkillBadge(skillNames)')
    expect(js).toContain("eventType === 'skills'")
    expect(js).toContain('updateSkillBadge(data.skills || [])')
    expect(sendMessageSource).toContain('host: getOfficeHostName')
    expect(runQuickActionSource).toContain('host: getOfficeHostName')
    expect(js).not.toContain("'/office/config'")
  })
})
