# ADR-001: Document-Native Assistant Architecture for Michat

## Status

Proposed

## Date

2026-06-29

## Context

Michat đã có Office Add-in thật, chạy task pane trong Word/Excel qua Office.js manifest. Add-in kết nối tới local HTTPS bridge trong Electron main process. Hiện trạng là:

- **Chat/Quick actions**: user bôi đen đoạn văn, chat với AI, AI trả lời, user copy/insert/replace thủ công.
- **Context**: selection text hoặc body text dạng plain string, cắt ở 32000 ký tự.
- **Write-back**: có confirm dialog, insertText hoặc replaceSelection.
- **Tool layer**: `ToolRegistry` tồn tại nhưng chỉ có knowledge/time tools. Office tools (`wordTools.ts`) là metadata/description thuần, chưa có executor nối vào runtime.
- **Bridge**: HTTP/HTTPS server, không có WebSocket hay bidirectional channel.
- **No Office agent loop**: model không thể gọi tool, bridge không route tool call về taskpane để execute Office.js, không có feedback loop.

Thế giới đang có các giải pháp tham khảo:
- **office-agents**: framework có host-specific tools, bridge/CLI inspect, VFS/sandbox, WebSocket.
- **Word GPT Plus**: Agent Mode với 25+ Word tools, streaming, quick actions.
- **Gemini Word Add-in**: Track Changes, comments, checkpoints, OOXML-level operation engine.

### Mục tiêu

Chuyển Michat từ "chat panel trong Word" thành **document-native assistant** có thể:
1. Hiểu cấu trúc tài liệu Word (headings, paragraphs, ranges, comments, sections)
2. Thao tác chính xác trên tài liệu (insert at range, replace selection, add comment, tracked changes)
3. Chạy agent loop có tool calling trên chính file Word đang mở
4. Preview/confirm/diff/rollback trước khi apply thay đổi
5. Làm việc với tài liệu dài (chunking, retrieval, outline-aware)

### Ràng buộc

- Dùng đúng active model trong Michat (không duplicate provider config trong add-in)
- Bridge chạy localhost, không public network
- Office.js sandbox không thể truy cập file system ngoài document đang mở
- Mỗi write action phải có user confirmation
- Không refactor/đụng vào RAG pipeline hiện tại

## Decision

Xây dựng **Document Operation Layer (DOL)**, gồm 4 lớp mới thêm vào architecture hiện tại:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Word/Excel (Office.js)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Task Pane (nâng cấp)                                      │  │
│  │  - Stream reader (hiện tại)                               │  │
│  │  + Office Tool Executor (mới) ← WebSocket client           │  │
│  │  + Document Context Provider (mới)                         │  │
│  │  + Diff/Preview UI (mới)                                   │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                              │ WebSocket + HTTP                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│         Electron Main Process (Electron)                        │
│  ┌───────────────────────────┴──────────────────────────────┐  │
│  │ OfficeBridgeService (nâng cấp)                           │  │
│  │  + WebSocket server (mới)                                 │  │
│  │  + OfficeToolRouter (mới)                                 │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────┴──────────────────────────────┐  │
│  │ ToolRegistry (hiện tại, mở rộng)                         │  │
│  │  + Office Tool Executors (mới)                           │  │
│  │  + Lưu officeSessionId trong context                     │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────┴──────────────────────────────┐  │
│  │ ProviderManager → LlamaService / AI SDK                  │  │
│  │  (không đổi)                                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Chi tiết từng lớp

#### 1. Document Context Provider (trong taskpane)

Thay thế `getDocumentContent()` trả về selection/body text đơn thuần.

```typescript
// Mới: structured document context
interface DocumentContext {
  mode: 'selection' | 'cursor' | 'full'
  content: string           // text content (chunked nếu > 8k tokens)
  outline: HeadingInfo[]    // heading tree
  cursorContext?: {         // context around cursor/selection
    before: string
    after: string
  }
  paragraphs: ParagraphInfo[]
  metadata: {
    name: string
    charCount: number
    wordCount: number
    language?: string
  }
}
```

Thêm vào `taskpane.js` (hoặc TypeScript mới):

- `getDocumentContext(scope)` trả về structured context
- `getDocumentOutline()` trả về heading tree
- `getCursorContext(range)` trả về text trước/sau con trỏ
- `getParagraphs(range)` trả về paragraph info có index

#### 2. Office Tool Executor (trong taskpane)

Thành phần mới nhận tool call từ WebSocket và thực thi Office.js rồi gửi kết quả về.

```
WebSocket nhận: { tool_use_id, name, args }
  → switch (name)
    → Office.run(...) thực thi
  → WebSocket gửi: { tool_use_id, result }
```

Các tool cần implement:

| Tool | Office.js method | Safety | Implementation priority |
|------|-----------------|--------|------------------------|
| `word_get_selection_text` | `selection.load("text")` | read | P0 (đã có trong taskpane) |
| `word_get_document_text` | `body.load("text")` | read | P0 (đã có) |
| `word_get_document_context` | selection/body + outline | read | P0 (mới) |
| `word_get_outline` | `paragraphs.load("style")` + filter headings | read | P0 (mới) |
| `word_get_paragraph_text` | `paragraphs.getItem(index).load("text")` | read | P1 (mới) |
| `word_insert_at_cursor` | `selection.insertText(text, "after")` | write | P0 (đã có) |
| `word_replace_selection` | `selection.insertText(text, "replace")` | write | P0 (đã có) |
| `word_append_to_document` | `body.insertText(text, "end")` | write | P0 (đã có) |
| `word_add_comment` | `selection.comments.add(text)` | write | P1 (mới) |
| `word_insert_paragraph` | `context.document.body.paragraphs.getFirst().insertParagraph(text, "After")` | write | P1 (mới) |
| `word_format_range` | `range.font.bold = true` etc | write | P2 (mới) |
| `word_insert_tracked_change` | dùng insertText (Office không có tracked change API trực tiếp) | write | P2 (mới) |

#### 3. Office Tool Router (trong Bridge)

Thành phần mới trong `OfficeBridgeService`, quản lý WebSocket connection đến từng session taskpane.

Khi `ToolRegistry.execute()` gọi tool Office:

```
ToolRegistry.execute("word_replace_selection", args)
  → OfficeToolRouter.route(sessionId, toolCall)
    → WebSocket gửi tới taskpane
    → taskpane thực thi Office.js
    → taskpane gửi kết quả qua WebSocket
  → OfficeToolRouter nhận result
  → ToolRegistry trả về model
```

#### 4. Office Tool Executors (trong main process)

Đăng ký vào `ToolRegistry`:

```typescript
// Trong officeHandlers.ts hoặc OfficeBridgeService.ts
toolRegistry.register({
  name: 'word_get_selection_text',
  description: 'Read the current Word selection',
  parameters: { type: 'object', properties: {}, required: [] }
}, async (args, context) => {
  // sessionId lấy từ context
  const sessionId = context.officeSessionId
  if (!sessionId) return JSON.stringify({ error: 'No Office session' })
  
  return JSON.stringify(
    await officeToolRouter.routeTool(sessionId, { name: 'word_get_selection_text', args: {} })
  )
})
```

### Bidirectional WebSocket channel

Thêm WebSocket server vào `OfficeBridgeService` bên cạnh HTTP:

```
HTTP → Chat streaming (giữ nguyên)
WebSocket → Tool execution channel (mới)

Taskpane khởi tạo WebSocket sau khi register session:
ws = new WebSocket('wss://localhost:18327/office/ws?sessionId=xxx')

ws.onmessage = (event) => {
  const { tool_use_id, name, args } = JSON.parse(event.data)
  const result = await executeOfficeTool(name, args)
  ws.send(JSON.stringify({ tool_use_id, result }))
}
```

### Tool-calling flow (đầy đủ)

```
1. User: "Viết lại đoạn đang chọn cho chuyên nghiệp"
2. taskpane POST /office/api/chat
   body: { messages, documentContext: {...structured...} }
3. Bridge nhận context, inject system prompt + tool definitions
4. Bridge gọi ProviderManager.sendMessageStream(tools=officeTools)
5. Model trả về tool_use: word_get_selection_text
6. Bridge route qua WebSocket tới taskpane
7. taskpane selection.load("text") → WebSocket gửi result
8. Bridge nhận result, tiếp tục stream
9. Model nhận selected text, trả về text-delta + tool_use: word_replace_selection
10. Bridge route tool call qua WebSocket
11. UI hiển thị preview + confirm dialog
12. User bấm Apply
13. taskpane selection.insertText(newText, "replace")
14. WebSocket gửi result
15. Bridge tiếp tục stream tới khi end_turn
```

### Document chunking cho tài liệu dài

Khi document > 32000 ký tự, không gửi full text. Thay vào đó:

1. taskpane gửi `outline` + `paragraphs` + `charCount`
2. Model request paragraphs cụ thể qua tool `word_get_paragraph_text`
3. Hoặc taskpane chunk document và gửi `{ outline, totalChunks, chunkIndex: 0, chunkContent }`
4. Model request chunk khác qua tool

Giới hạn khởi điểm: gửi outline + paragraphs đầu tiên + selection context. Phần còn lại lazy-loaded qua tool.

## Alternatives Considered

### Alternative 1: Giữ nguyên HTTP polling, không thêm WebSocket

- Pros: Không cần thêm dependency, không cần quản lý WebSocket lifecycle
- Cons: Tool call phải polling từ taskpane → bridge, tạo race condition, latency cao, không scale được với multiple tool calls
- Rejected: WebSocket là giải pháp chuẩn cho bidirectional real-time communication. HTTP polling cho tool calls là anti-pattern khi model có thể gọi 3-5 tool liên tiếp.

### Alternative 2: Dùng OOXML-level operation engine như Gemini add-in

- Pros: Có thể test ngoài Word, manipulation mạnh hơn (track changes, comments, list structure)
- Cons: Cần thêm thư viện OOXML (pizzip, docxtemplater đã có trong Michat). Rủi ro corrupt document. Office.js đã đủ cho MVP.
- Deferred: P2. Khi cần track changes thực sự và operation ở cấp XML, sẽ thêm OOXML engine.

### Alternative 3: Dùng `office-agents` framework làm nền

- Pros: Đã có bridge WebSocket, tool registry, skill system, CLI inspect
- Cons: Là framework provider-agnostic, rất nặng (Svelte 5 monorepo), phải migrate lại code Michat đang có. Không local-first.
- Rejected: Michat đã có bridge riêng. Chỉ học pattern tool routing, không fork nguyên repo.

### Alternative 4: Agent Mode = quick actions + system prompt, không cần tool calling

- Pros: Đơn giản nhất, không cần WebSocket, không cần tool executor
- Cons: Model không thể đọc selected text, không thể replace, không thể add comment = không thể làm việc trên document thực sự. Quick actions chỉ fixed pattern.
- Rejected: Không đáp ứng được mục tiêu "document-native assistant".

## Consequences

### Tích cực

- Model có thể tương tác hai chiều với Word document qua tool calling
- UX được cải thiện: AI đề xuất, preview, confirm, apply
- Document hiểu cấu trúc (outline, paragraphs, sections) thay vì plain text
- Tool calling flow rõ ràng, có thể mở rộng (thêm Excel tools sau)
- Codebase hiện tại không bị phá vỡ: thêm lớp mới thay vì refactor

### Tiêu cực / Rủi ro

- WebSocket thêm complexity: lifecycle, reconnect, timeout, security
- WebSocket + HTTP cert strategy phải đồng bộ
- Tool calling qua WebSocket thêm latency (network round-trip qua bridge)
- Nếu user không chọn Apply, tool call "replace_selection" vẫn thực thi nhưng undo thì cần handle
- Office.js WebSocket connection phải duy trì trong suốt conversation

### Rủi ro và giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|------------|
| WebSocket disconnect giữa tool call | Cao | Retry 3 lần, timeout 10s, báo model tool error |
| Model gọi write tool không đúng | Cao | Confirm dialog bắt buộc cho write tools; preview diff |
| Office.js không support WebSocket trong WebView2 | Thấp | WebSocket là Web API chuẩn, WebView2 hỗ trợ đầy đủ |
| Document context > 128k tokens | Trung bình | Chunking + outline + lazy-loaded paragraphs |
| Write tool conflict giữa model suggestions và user edits | Trung bình | check document state trước mỗi write tool |

## Phased Implementation Plan

### Phase 0: WebSocket Infrastructure (ước lượng: 3-5 ngày)

**Mục tiêu**: Chứng minh bridge ↔ taskpane giao tiếp hai chiều.

- [ ] Thêm WebSocket server trong `OfficeBridgeService` (dùng `ws` package hoặc Node.js built-in)
- [ ] Taskpane kết nối WebSocket sau khi register session
- [ ] Bridge gửi tool call → taskpane nhận và echo lại
- [ ] Test: bridge gửi ping → taskpane pong

**Check**: console log "WebSocket tool channel established"

### Phase 1: Office Tool Executor trong taskpane (ước lượng: 5-7 ngày)

**Mục tiêu**: Model có thể gọi các tool read/write trên Word document.

- [ ] Implement `officeToolExecutor.js` trong taskpane (switch-case cho từng tool)
- [ ] WebSocket message handler
- [ ] Test: tool `word_get_selection_text` + `word_get_document_text`
- [ ] Test: tool `word_replace_selection` + `word_insert_at_cursor`
- [ ] Confirm dialog cho write tools

**Check**: Model gọi tool → taskpane thực thi → result về model → model tiếp tục

### Phase 2: Structured Document Context (ước lượng: 3-5 ngày)

**Mục tiêu**: Model hiểu document có outline, sections, paragraphs, không chỉ plain text.

- [ ] `getDocumentContext()` → outline + paragraphs + selection
- [ ] `getDocumentOutline()` → heading tree
- [ ] `word_get_outline` tool + `word_get_paragraph_text` tool
- [ ] Chunking: tự động chunk khi document > 8k tokens

**Check**: Model có thể "đoạn thứ 3 của heading X nói gì?"

### Phase 3: Agent Mode UI (ước lượng: 3-5 ngày)

**Mục tiêu**: UX agent mode với tool trace và confirm/diff.

- [ ] Tool trace hiển thị trong taskpane (model đang gọi tool gì, kết quả ra sao)
- [ ] Diff preview: original vs suggested content
- [ ] Apply as comment option
- [ ] Multi-tool flow hiển thị rõ ràng
- [ ] Cancel mid-operation

**Check**: User thấy được model đang nghĩ gì, làm gì, đề xuất gì

### Phase 4: Word-native operations (ước lượng: 5-7 ngày)

**Mục tiêu**: Comment, tracked changes, formatting, paragraph operations.

- [ ] `word_add_comment` tool
- [ ] `word_insert_paragraph` tool
- [ ] `word_format_range` tool
- [ ] Checkpoint/snapshot trước khi apply (undo)

**Check**: "Đánh dấu các đoạn cần cải thiện bằng comment"

### Phase 5: Excel parity (ước lượng: 5-7 ngày)

**Mục tiêu**: Excel tools hoạt động tương tự Word tools qua WebSocket.

- [ ] Excel tool executor trong taskpane
- [ ] Excel tool definitions + executors trong bridge
- [ ] Excel structured context (range, used range, workbook summary, sheet names)

## Success Criteria

MVP chỉ được xem là hoàn thành khi:

1. Word WebSocket tool channel hoạt động 2 chiều
2. Model có thể đọc selected text + document outline + paragraphs
3. Model có thể replace selection + insert at cursor
4. Write tools có confirm dialog
5. Excel tương đương với Word ở mức basic (read range + write range)
6. Typecheck pass
7. Test pass
8. Không làm hỏng chat/notebook/RAG flow hiện có

## References

### Codebase hiện tại

- `src/main/services/office/OfficeBridgeService.ts` — bridge HTTP server
- `src/main/services/office/tools/wordTools.ts` — Word tool metadata
- `src/main/services/office/tools/excelTools.ts` — Excel tool metadata
- `src/office-addin/shared/taskpane.js` — taskpane hiện tại (plain JS)
- `src/office-addin/word/manifest.xml` — Word manifest
- `src/main/services/ToolRegistry.ts` — tool registry hiện tại
- `src/main/ipc/officeHandlers.ts` — IPC handlers cho Office
- `src/renderer/src/components/settings/OfficeIntegrationSettings.tsx` — Settings UI
- `tests/officeBridgeService.test.ts` — bridge tests
- `tests/officeTaskpaneUx.test.ts` — taskpane UI tests

### External references

- [Office Add-ins platform overview](https://learn.microsoft.com/en-us/office/dev/add-ins/overview/office-add-ins)
- [Privacy and security for Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/privacy-and-security)
- [Word JavaScript API reference](https://learn.microsoft.com/en-us/javascript/api/word?view=word-js-preview)
- [hewliyang/office-agents](https://github.com/hewliyang/office-agents)
- [Kuingsmile/word-GPT-Plus](https://github.com/Kuingsmile/word-GPT-Plus)
- [Gemini AI for Office Word Add-in](https://github.com/AnsonLai/Gemini-AI-for-Office-Microsoft-Word-Add-In-for-Vibe-Drafting)
