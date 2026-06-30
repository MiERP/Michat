# MiChat Office Add-in: Mục tiêu, đánh giá thực tế và kế hoạch triển khai

## 1. Kết luận ngắn gọn

MiChat Office Add-in là một hướng phát triển khả thi, nhưng **không phải tính năng nhỏ**. Nếu làm đúng, đây là một module mới gồm ít nhất 3 lớp:

1. **Office Add-in frontend** chạy trong Microsoft Word/Excel bằng Office.js.
2. **Local bridge service** chạy trong Electron main process của MiChat.
3. **Office agent/tool layer** chỉ dùng model/LLM và llama.cpp runtime hiện có của MiChat; không dùng, không sửa, không phụ thuộc cấu trúc RAG hiện tại.

Mục tiêu hợp lý không phải là "clone Claude for Office" ngay. Mục tiêu hợp lý là:

> Xây dựng một Office Add-in local-first cho Word và Excel. Có thể triển khai Word trước để giảm rủi ro, nhưng MVP chỉ được xem là đủ khi cả Word và Excel đều chạy được ở mức tối thiểu.

MVP cần production-minded, nhưng **không gọi là production đầy đủ** cho đến khi xử lý xong installer, trust center, HTTPS certificate, tool permission, rollback khi sửa tài liệu, test Office thật, và packaging.

Ràng buộc sản phẩm đã chốt:

- Đây phải là **Office Add-in thật**, chạy trong task pane/ribbon của Microsoft Word và Excel bằng Office.js manifest, không phải cửa sổ Electron nổi bên ngoài Office.
- Giai đoạn đầu chỉ nhắm **Word và Excel**. PowerPoint không thuộc MVP.
- Add-in chỉ sử dụng **LLM/local llama.cpp runtime của MiChat**. Không thêm Ollama/LM Studio/cloud riêng cho module Office.
- Module Office phải được tách biên rõ với RAG hiện tại; không làm hỏng hoặc thay đổi luồng notebook RAG đang có.

---

## 2. Những gì đã nghiên cứu từ repo mẫu

### 2.1 `hewliyang/office-agents`

Điểm đáng học:

- Monorepo tách package theo host: Word, Excel, PowerPoint.
- Có `@office-agents/bridge`: local HTTPS/WebSocket bridge cho add-in kết nối về máy local.
- Có tool registry theo từng Office host.
- Word tools gồm đọc document text, document structure, OOXML, screenshot, raw Office.js execution.
- Excel tools gồm đọc range, CSV export, search data, screenshot range, list objects, write range, modify workbook/sheet, chart/table/pivot operations.
- Có bridge CLI để inspect session và gọi tool trong Office runtime.

Điểm không nên bê nguyên xi:

- Họ thiết kế như framework BYOK/provider-agnostic. MiChat cần ngược lại: **khóa vào runtime local của MiChat**.
- Họ có VFS, shell sandbox, raw JS execution mạnh nhưng rủi ro cao. MiChat MVP không nên đưa `eval_officejs` hoặc shell vào bản đầu.
- Bridge của họ phục vụ development rất mạnh; bản production của MiChat chỉ cần bridge tối thiểu, có auth và allowlist tool.

### 2.2 `Kuingsmile/word-GPT-Plus`

Điểm đáng học:

- UX thực dụng cho Word: Chat Mode + Agent Mode.
- Quick actions rõ ràng: translate, polish, summarize, grammar, academic writing.
- Có tool đọc/ghi Word, insert/replace/append, formatting, table, bookmark, search/replace.
- Có streaming, abort, history, provider/model settings.

Điểm cần tránh:

- Quá nhiều provider/cloud. MiChat không cần duplicate provider settings trong add-in.
- Nếu để add-in tự quản API/model sẽ phá mục tiêu: dùng hoàn toàn model MiChat đang dùng.
- Agent Mode có thể quá rộng nếu chưa có permission model và preview/confirm trước khi ghi tài liệu.

### 2.3 `ilberpy/excel-ai-assistant`

Điểm đáng học:

- Kiến trúc rất đơn giản: `manifest.xml`, `index.html`, `app.js`, `ai_client.js`.
- Excel-focused actions: analyze data, create chart, format table, generate calculations/formulas.
- Nhấn mạnh local model, nhưng qua Ollama/LM Studio.

Điểm cần tránh:

- Thiết kế đơn file/simple app không đủ cho MiChat production.
- README có dấu hiệu lộ token trong text fetched từ GitHub; phải xem đây là cảnh báo về security hygiene.
- Manifest localhost HTTP đơn giản có thể chạy dev nhưng production Office thường cần HTTPS/trusted origin.

---

## 3. Cấu trúc MiChat hiện tại liên quan trực tiếp

### 3.1 Startup và service composition

File chính: `src/main/index.ts`

Hiện app khởi động theo thứ tự:

1. Check license.
2. Tạo `LlamaService` và `ensureStarted()`.
3. Init database/migrations/extensions.
4. Init `ProviderManager`.
5. Init `SessionAutoSwitchService`.
6. Init `KnowledgeService`.
7. Init `UpdateService`.
8. Init electron-store.
9. Init `ShortcutManager`.
10. Register IPC handlers.
11. Create main window.

Ý nghĩa cho Office Add-in:

- Office bridge phải được khởi động **sau** `ProviderManager`, `KnowledgeService`, `LlamaService` đã sẵn sàng.
- Bridge cũng phải shutdown cùng app, giống `llamaService.stop()` và DB close.
- Không nên đặt bridge trong renderer. Office add-in không thể gọi Electron IPC; nó chỉ có thể gọi HTTP/WebSocket.

### 3.2 AI runtime hiện tại

Các file chính:

- `src/main/services/LlamaService.ts`
- `src/main/providers/ProviderManager.ts`
- `src/main/providers/base/AISDKProvider.ts`
- `src/main/providers/registry/builtinProviders.ts`

Hiện MiChat đã có:

- llama.cpp local server chat ở `127.0.0.1:8000/v1`.
- embedding server ở `127.0.0.1:8001/v1`.
- Provider abstraction dùng AI SDK/OpenAI-compatible API.
- Local provider mặc định `llama` và `llama-embed`.

Ý nghĩa cho Office Add-in:

- Add-in **không gọi trực tiếp llama-server**. Nó gọi MiChat Office Bridge.
- MiChat bridge dùng `ProviderManager.getActiveChatProvider()` để bảo đảm model Office giống model trong app.
- Khi Office gọi AI, bridge gọi `LlamaService.ensureChatStarted()` trước.

### 3.3 Ranh giới bắt buộc với Knowledge/RAG hiện tại

Các file cần **không đụng tới nếu không có yêu cầu riêng**:

- `src/main/services/KnowledgeService.ts`
- `src/main/services/EmbeddingService.ts`
- `src/main/vectorstore/*`
- `src/main/db/*`

Nguyên tắc bắt buộc:

- Office Add-in **không phải module RAG**.
- Office Add-in **không sửa pipeline indexing/chunking/embedding/vector store**.
- Office Add-in **không ghi thêm document/chunk/embedding vào DB hiện tại**.
- Office Add-in chỉ dùng LLM thông qua `ProviderManager` và bảo đảm `LlamaService`/llama.cpp đang chạy.
- Context cho Office lấy trực tiếp từ Word/Excel đang mở qua Office.js, rồi gửi như prompt/context tạm thời sang bridge.

Nếu sau này muốn cho Office dùng knowledge base của MiChat, đó phải là phase riêng, có thiết kế riêng, và chỉ được gọi `KnowledgeService.search()` dạng read-only. Không được trộn Office document vào notebook RAG hiện tại trong MVP.

Không nên bắt MVP làm file indexer toàn ổ đĩa. Office.js không có quyền file system; nếu muốn file indexer thì là module riêng trong MiChat desktop, không phải trong add-in.

### 3.4 IPC hiện tại

File chính: `src/main/ipc/index.ts`

IPC hiện chỉ phục vụ renderer trong Electron. Office Add-in không nằm trong Electron renderer, nên không thể dùng IPC. Phải tạo một lớp mới:

```text
Office.js Task Pane -> HTTP/WebSocket localhost -> OfficeBridgeService -> MiChat services
```

### 3.5 Packaging hiện tại

File chính: `electron-builder.yml`

Hiện `resources` được đóng gói qua `extraResources`. Office Add-in nên được build vào:

```text
resources/office-addin/
  word/manifest.xml
  excel/manifest.xml
  taskpane/index.html
  assets/*
```

Nhưng cần lưu ý:

- Manifest trong Office thường trỏ đến URL web, không trỏ trực tiếp file nội bộ tùy tiện.
- Production nên dùng local HTTPS server do MiChat bridge phục vụ static taskpane.
- Windows install có thể copy manifest/catalog, nhưng không được giả định mọi Office sẽ tự động trust add-in nếu policy không cho phép.

---

## 4. Những điều ta cần làm vs phải làm

### 4.1 Cần làm để MVP có giá trị thật

1. Word task pane add-in.
2. Local bridge trong MiChat.
3. Streaming chat từ MiChat model ra task pane.
4. Tách biệt hoàn toàn với RAG/notebook pipeline hiện có; không import Office document vào DB/vector store.
5. Office.js tools tối thiểu:
   - get selected text
   - get full document text
   - replace selection
   - insert after selection
   - append to document
6. Quick actions:
   - summarize selection/document
   - rewrite selection
   - translate selection
   - grammar/polish
7. Settings trong MiChat:
   - bật/tắt Office Integration
   - bridge status
   - reinstall manifests
8. Security tối thiểu:
   - chỉ bind `127.0.0.1`
   - token local per install/session
   - CORS allowlist origin của add-in
   - confirm trước mọi action ghi tài liệu

### 4.2 Phải làm để không vỡ production sau này

1. Bridge lifecycle rõ ràng:
   - start sau app ready
   - stop on quit
   - retry port conflict
   - health endpoint
2. HTTPS/dev cert hoặc strategy tin cậy cho Office desktop:
   - Office add-ins thường yêu cầu trusted HTTPS cho taskpane.
   - localhost HTTP có thể dùng cho dev nhưng không nên coi là production.
3. Manifest strategy:
   - Word manifest riêng.
   - Excel manifest riêng.
   - PowerPoint để sau.
4. Permission model:
   - Read-only tools có thể chạy ngay.
   - Write tools phải preview + confirm.
5. Prompt/tool contract:
   - Không để model tự do sinh Office.js code trong MVP.
   - Chỉ cho gọi tool allowlist.
6. Test với Office thật:
   - Word desktop Windows.
   - Excel desktop Windows.
   - Office Web để sau.
7. Packaging/install reality:
   - Installer có thể copy manifests.
   - Tự động sideload/trust Office add-in có giới hạn theo Office policy.
   - Cần có fallback manual guide trong UI.

### 4.3 Không nên làm trong MVP

- PowerPoint.
- Shell/VFS kiểu office-agents.
- Raw Office.js eval.
- File indexer toàn ổ đĩa.
- Microsoft Store publishing.
- Multi-user/team deployment.
- Cloud provider settings trong add-in.
- Full autonomous edit không hỏi xác nhận.

---

## 5. Thiết kế module đề xuất

### 5.1 Cây thư mục mục tiêu

```text
src/main/services/office/
  OfficeBridgeService.ts
  OfficeAuthService.ts
  OfficeSessionRegistry.ts
  OfficeAgentService.ts
  OfficePromptBuilder.ts
  OfficeToolRegistry.ts
  tools/
    wordTools.ts
    excelTools.ts

src/main/ipc/officeHandlers.ts

src/office-addin/
  shared/
    bridgeClient.ts
    streamClient.ts
    types.ts
    prompts.ts
  word/
    manifest.xml
    taskpane.html
    taskpane.tsx
    wordApi.ts
    wordTools.ts
  excel/
    manifest.xml
    taskpane.html
    taskpane.tsx
    excelApi.ts
    excelTools.ts

resources/office-addin/
  word/manifest.xml
  excel/manifest.xml
  dist/*
```

### 5.2 OfficeBridgeService

Trách nhiệm:

- Serve static taskpane assets.
- Expose local API/WebSocket.
- Check auth token.
- Bridge request sang `ProviderManager` và `LlamaService`; không gọi `KnowledgeService` trong MVP.
- Stream response về add-in.

Endpoint MVP:

```text
GET  /office/health
GET  /office/config
POST /office/session/start
POST /office/chat/stream
POST /office/action/summarize
POST /office/action/rewrite
POST /office/action/translate
POST /office/action/polish
```

Không cần tool-calling loop ngay ngày đầu. Quick actions deterministic trước, agent tool-calling sau.

### 5.3 Office add-in frontend

Task pane layout:

```text
Header
  MiChat status: Connected / Not running
  Current model

Tabs
  Chat
  Quick Actions
  Settings

Chat
  message list
  context selector: Selection / Document / None
  input
  Send / Stop

Quick Actions
  Summarize
  Rewrite
  Translate
  Polish
  Grammar

Result Actions
  Copy
  Insert
  Replace selection
```

### 5.4 Word tools MVP

Read tools:

- `getSelectionText()`
- `getDocumentText({ maxChars })`
- `getDocumentMetadata()`

Write tools:

- `replaceSelection(text)`
- `insertAfterSelection(text)`
- `appendToDocument(text)`

Rules:

- Write action always requires user click.
- AI response never auto-writes in Chat Mode.
- Agent Mode later may propose write operations, but UI must show confirmation.

### 5.5 Excel tools MVP

Read tools:

- `getSelectedRange()`
- `getUsedRange({ maxRows, maxCols })`
- `getWorkbookSummary()`

Write tools:

- `writeSelectedRange(values)`
- `insertFormula(cell, formula)`

MVP Excel scope should be conservative. Chart creation and table formatting can be phase 2 because Office.js Excel APIs are more failure-prone across versions.

---

## 6. Thực tế về auto-install add-in

Câu "add-in sẽ được thêm vào ngay khi cài đặt ứng dụng" là mục tiêu tốt, nhưng cần hiểu đúng:

### Có thể làm

- Installer copy manifest vào thư mục MiChat.
- MiChat tạo local static/HTTPS server phục vụ taskpane.
- MiChat cung cấp nút Install/Reinstall trong Settings.
- Windows: hỗ trợ tạo shared folder catalog hoặc hướng dẫn sideload.
- macOS: copy manifest vào `wef` folder có thể hỗ trợ sau.

### Không nên hứa chắc 100%

- Office tự động trust add-in ở mọi máy.
- Không cần user thao tác gì trong Trust Center.
- Chạy tốt trên mọi Office version.
- Office Web dùng local bridge không cấu hình gì.

### Định nghĩa MVP install hợp lý

MVP install nên là:

> Sau khi cài MiChat, vào Settings > Office Integration > Install Add-in. App tự chuẩn bị manifest/catalog tối đa có thể, sau đó hướng dẫn user 1-2 bước còn lại nếu Office policy yêu cầu.

Production sau này mới nhắm tới enterprise deployment bằng policy/admin template.

---

## 7. Rủi ro chính

| Rủi ro | Mức | Cách giảm |
|---|---:|---|
| Office yêu cầu HTTPS/trusted origin | Cao | Dùng local HTTPS + cert strategy; dev HTTP chỉ để thử |
| Auto-install không ổn định do Office policy | Cao | Có fallback manual install UI |
| Office.js sandbox không đọc file system | Cao | Chỉ đọc tài liệu đang mở; file indexer để module desktop riêng |
| Local model chậm với document dài | Trung bình/Cao | Context trimming, chunking, selection-first workflow |
| Write tool làm hỏng tài liệu | Cao | Preview, confirm, undo-friendly write, backup text |
| Tool-calling quá phức tạp | Cao | MVP dùng quick actions trước, Agent Mode sau |
| Bridge security | Cao | Bind 127.0.0.1, token, CORS allowlist, no raw eval |
| Excel API khác biệt theo phiên bản | Trung bình | MVP Excel chỉ read/analyze/formula, chart phase 2 |
| Packaging thêm build target mới | Trung bình | Tách `src/office-addin` build riêng rồi copy vào resources |

---

## 8. Kế hoạch triển khai chi tiết

### Phase 0: Spike bắt buộc

Mục tiêu: chứng minh Office taskpane gọi được MiChat local bridge.

Deliverables:

- Minimal `OfficeBridgeService` với `/office/health`.
- Minimal Word manifest.
- Minimal Excel manifest.
- Taskpane hiển thị `Connected to MiChat`.
- Word add-in đọc selected text và gửi sang bridge.
- Excel add-in đọc selected range và gửi sang bridge.

Exit criteria:

- Word desktop mở được taskpane.
- Taskpane fetch được `127.0.0.1` hoặc local HTTPS endpoint.
- Nếu HTTP bị chặn, xác nhận cần HTTPS cert ngay.

### Phase 1: Word MVP

Deliverables:

- Word taskpane React UI.
- Bridge streaming chat.
- Quick actions:
  - summarize selection
  - rewrite selection
  - translate selection
  - polish selection
- Result actions:
  - copy
  - insert
  - replace selection
- MiChat settings:
  - enable/disable Office bridge
  - bridge status
  - open install folder / reinstall manifest

Exit criteria:

- Dùng đúng active MiChat model.
- Không cần API key/cloud.
- Typecheck pass.
- Có manual test checklist cho Word.

### Phase 2: Excel MVP

Deliverables:

- Excel manifest/taskpane.
- Read selected range.
- Analyze data.
- Generate formula.
- Explain formula.
- Optional write formula after confirm.

Exit criteria:

- Excel selected range gửi sang MiChat được.
- AI phân tích và trả kết quả stream.
- Formula write có confirmation.

### Phase 3: Agent Mode giới hạn

Deliverables:

- Tool registry Office-specific.
- Word tools allowlist.
- Excel tools allowlist.
- Tool trace UI.
- Confirm-before-write.

Agent Mode examples:

- "Đọc đoạn đang chọn và viết lại theo phong cách trang trọng."
- "Tóm tắt tài liệu và đề xuất 5 tiêu đề."
- "Phân tích range đang chọn và viết công thức tính tăng trưởng."

Không cho phép raw JS eval trong phase này.

### Phase 4: Packaging/install hardening

Deliverables:

- Build add-in assets into `resources/office-addin`.
- Update `electron-builder.yml` if needed.
- Installer helper scripts.
- Settings UI install/reinstall.
- Docs user guide.

Exit criteria:

- Fresh install MiChat có thể cài Word Add-in bằng flow trong app.
- Packaged build vẫn serve bridge/static assets.

---

## 9. Definition of Done cho MVP

MVP chỉ được xem là hoàn thành khi có đủ:

1. Word Add-in mở được trong Word desktop Windows.
2. Excel Add-in mở được trong Excel desktop Windows và đọc được selected range.
3. Add-in kết nối MiChat local bridge.
4. Add-in dùng model đang active trong MiChat.
5. Add-in không sửa schema, DB, vector store, chunking, embedding hoặc notebook RAG pipeline hiện có.
6. Có streaming response.
7. Summarize/rewrite/translate/polish selection chạy được.
8. Excel analyze selected range/generate formula chạy được ở mức tối thiểu.
9. Insert/replace/write-back chỉ chạy sau user action rõ ràng.
10. MiChat app vẫn chạy typecheck.
11. Không làm lộ local API ra network.
12. Packaged app vẫn chứa manifest/assets cần thiết.
13. Có tài liệu cài đặt/fallback nếu Office không auto-trust.

---

## 10. Kết luận thực tế

Ý tưởng này **khả thi nhưng không nhỏ**. Nếu kỳ vọng "cài app xong Office tự có Copilot local hoàn chỉnh" trong một bước thì quá lạc quan. Nếu đặt mục tiêu:

> Office Add-in MVP local-first cho Word và Excel, dùng MiChat model, có quick actions và write-back an toàn

thì đây là mục tiêu thực tế.

Có thể triển khai Word trước để xác thực bridge/manifest/Office.js, nhưng MVP cuối cùng phải gồm cả Word và Excel. Agent Mode nâng cao để sau. Không nên bắt đầu bằng full Office agent tự động sửa tài liệu, vì rủi ro kỹ thuật và UX cao.
