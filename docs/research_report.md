# 🔬 Báo Cáo Nghiên Cứu: Ứng Dụng Trợ Lý AI cho Word & Excel

## Tổng Quan Dự Án

Dự án gồm **2 tính năng chính**:
1. **File Indexer & Search**: Quét ổ cứng, lập chỉ mục và tìm kiếm tài liệu Word/Excel
2. **Office Add-in AI Chat**: Tích hợp cửa sổ chat AI trực tiếp vào Word và Excel

---

## 🗂️ Tính Năng 1: File Indexer & Search

### Các Repo Tham Khảo Tốt Nhất

| Repo | GitHub | Mô tả | Phù hợp |
|------|--------|--------|---------|
| **SuperSearchLocalDocs** | [mrdatawolf/SuperSearchLocalDocs](https://github.com/mrdatawolf/SuperSearchLocalDocs) | Hỗ trợ .docx, .xlsx, PDF; SQLite FTS5; GUI + Web UI; xử lý song song | ⭐⭐⭐⭐⭐ |
| **DocFinder** | [filippostanghellini/DocFinder](https://github.com/filippostanghellini/DocFinder) | Tìm kiếm ngữ nghĩa bằng AI embeddings, 100% local, hỗ trợ Word | ⭐⭐⭐⭐ |
| **File Brain** | [Hamza5/file-brain](https://github.com/Hamza5/file-brain) | Semantic search + OCR, tìm file theo nội dung | ⭐⭐⭐ |
| **Generative Search Engine** | [imanoop7/Generative-Search-Engine-For-Local-Files](https://github.com/imanoop7/Generative-Search-Engine-For-Local-Files) | Chat với file local qua Ollama + Streamlit | ⭐⭐⭐⭐ |
| **PyGPT** | [szczyglis-dev/py-gpt](https://github.com/szczyglis-dev/py-gpt) | Desktop AI assistant đầy đủ tính năng, RAG local, Ollama | ⭐⭐⭐⭐ |

### Stack Kỹ Thuật Đề Xuất (Feature 1)

```
Backend (Python):
├── os.walk()              → Duyệt cây thư mục
├── python-docx            → Đọc file .docx
├── openpyxl               → Đọc file .xlsx
├── SQLite + FTS5          → Lập chỉ mục và tìm kiếm nhanh (full-text)
├── chromadb / FAISS       → Tùy chọn: tìm kiếm ngữ nghĩa (AI embeddings)
├── Ollama + Sentence Transformers → LLM local, tạo embeddings
└── watchdog               → Monitor thư mục thay đổi (auto re-index)

Frontend:
├── PyQt6 / PySide6        → Desktop GUI (cửa sổ chat + danh sách file)
└── FastAPI                → REST API nếu cần web interface
```

### Luồng Hoạt Động

```
User chọn phân vùng → Crawler quét toàn bộ .docx/.xlsx 
→ Trích xuất text + metadata → Lưu vào SQLite/ChromaDB
→ User nhập tên file/nội dung → FTS query hoặc Vector search
→ Hiển thị danh sách kết quả với đường dẫn đầy đủ
```

---

## 💬 Tính Năng 2: Office Add-in AI Chat

### Các Repo Tham Khảo Tốt Nhất

| Repo | GitHub | Mô tả | Phù hợp |
|------|--------|--------|---------|
| **office-agents** | [hewliyang/office-agents](https://github.com/hewliyang/office-agents) | Monorepo đầy đủ cho Word + Excel + PPT, BYOK, nhiều LLM provider, chat panel | ⭐⭐⭐⭐⭐ |
| **Word GPT Plus** | [Kuingsmile/word-GPT-Plus](https://github.com/Kuingsmile/word-GPT-Plus) | Add-in Word hoàn chỉnh, sinh/dịch/tóm tắt văn bản, hỗ trợ nhiều AI | ⭐⭐⭐⭐⭐ |
| **Excel AI Assistant** | [ilberpy/excel-ai-assistant](https://github.com/ilberpy/excel-ai-assistant) | Excel + Ollama/LM Studio, phân tích dữ liệu, tạo biểu đồ, 100% local | ⭐⭐⭐⭐⭐ |
| **MS Office AI Helper** | [lancedesk/ms-office-ai-helper](https://github.com/lancedesk/ms-office-ai-helper) | Word add-in với Groq + Gemini, phân tích tài liệu | ⭐⭐⭐⭐ |
| **Gemini AI for Office** | [AnsonLai/Gemini-AI-for-Office](https://github.com/AnsonLai/Gemini-AI-for-Office-Microsoft-Word-Add-In-for-Vibe-Drafting) | Word add-in tích hợp Gemini AI | ⭐⭐⭐ |

### Kiến Trúc Office Add-in

```
Office Application (Word / Excel)
├── manifest.xml              → Đăng ký add-in, khai báo permissions
└── Task Pane (Web App)
    ├── HTML/CSS/JS           → Giao diện chat
    ├── Office.js API         → Đọc/ghi nội dung tài liệu
    │   ├── Word.run()        → Thao tác với văn bản Word
    │   └── Excel.run()       → Thao tác với dữ liệu Excel
    └── AI Backend (API)
        ├── OpenAI / Anthropic / Gemini (Cloud)
        └── Ollama (Local LLM, không cần internet)
```

> [!IMPORTANT]
> **Giới hạn quan trọng của Office.js**: Add-in chạy trong môi trường sandbox (WebView2) và **KHÔNG thể trực tiếp truy cập file system** của người dùng. Add-in chỉ có thể đọc/ghi vào **file đang mở** thông qua Office.js API.

### Khả năng của Office.js API

**Trong Word:**
- Đọc toàn bộ nội dung văn bản (`body.text`)
- Đọc/ghi đoạn văn cụ thể
- Chèn, thay thế, xóa nội dung
- Thao tác với Table, Heading, Comments

**Trong Excel:**
- Đọc/ghi dữ liệu theo Range (`A1:B10`)
- Tạo/xóa Sheet
- Tạo Chart, PivotTable
- Đọc toàn bộ dữ liệu Workbook

### Stack Kỹ Thuật Đề Xuất (Feature 2)

```
Add-in Frontend (JavaScript/TypeScript):
├── React / Vue             → UI framework cho Task Pane
├── Office.js               → Microsoft Office JavaScript API
├── Fluent UI               → Microsoft design system (giao diện chuyên nghiệp)
└── WebSocket / fetch       → Gọi đến backend AI

Add-in Backend (Python / Node.js):
├── FastAPI / Express       → REST/WebSocket server
├── LangChain               → Orchestration AI, memory, tools
├── Ollama                  → Local LLM (nếu muốn chạy hoàn toàn offline)
└── OpenAI API              → Cloud LLM (nếu dùng internet)

Đóng gói & Triển khai:
├── manifest.xml            → Sideload vào Office
└── Electron / Tauri        → Desktop app wrapper (tùy chọn)
```

---

## 🏗️ Kiến Trúc Tổng Thể Đề Xuất

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop Application                      │
│  ┌──────────────────┐    ┌───────────────────────────────┐  │
│  │  File Search UI   │    │     Office Add-in Server      │  │
│  │  (PyQt6)         │    │     (FastAPI / Node.js)        │  │
│  │                  │    │                               │  │
│  │ • Chọn phân vùng │    │ • REST API endpoint            │  │
│  │ • Index files    │    │ • WebSocket for streaming      │  │
│  │ • Tìm kiếm       │    │ • LangChain orchestration      │  │
│  │ • Mở file        │    │ • Memory management            │  │
│  └──────────┬───────┘    └──────────────┬────────────────┘  │
│             │                           │                    │
│  ┌──────────▼───────────────────────────▼────────────────┐  │
│  │                    Core Engine (Python)                │  │
│  │                                                        │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ File Indexer │  │  SQLite/FTS5 │  │  LLM Engine  │  │  │
│  │  │ python-docx │  │  + ChromaDB  │  │  Ollama/API  │  │  │
│  │  │ openpyxl    │  │              │  │              │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↕ manifest.xml (sideload)
┌─────────────────────────────────────────────────────────────┐
│               Microsoft Word / Excel                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Task Pane (Add-in)                      │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │              Chat Interface                    │  │    │
│  │  │  User: "Tóm tắt nội dung file này"            │  │    │
│  │  │  AI: "Đây là bản tóm tắt: ..."               │  │    │
│  │  │  [Chèn vào tài liệu] [Sao chép]              │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
│  │  Office.js API ↔ Document Content                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛣️ Lộ Trình Triển Khai Đề Xuất

### Giai Đoạn 1: MVP - File Indexer (2-3 tuần)
- [ ] Xây dựng crawler duyệt thư mục (configurable partitions)
- [ ] Trích xuất metadata (tên file, đường dẫn, ngày sửa)
- [ ] Lập chỉ mục SQLite với FTS5
- [ ] UI tìm kiếm cơ bản (PyQt6 hoặc web)
- [ ] Mở file trực tiếp từ kết quả tìm kiếm

### Giai Đoạn 2: Office Add-in Core (3-4 tuần)
- [ ] Setup dự án Office Add-in (TypeScript + React)
- [ ] Tích hợp Office.js API cho Word
- [ ] Tích hợp Office.js API cho Excel
- [ ] UI chat cơ bản trong Task Pane
- [ ] Kết nối với AI backend (bắt đầu với OpenAI API)

### Giai Đoạn 3: AI Integration (2-3 tuần)
- [ ] Tích hợp LangChain cho memory và tool use
- [ ] Context-aware prompting (đọc nội dung file, đặt vào system prompt)
- [ ] Tools: Insert text, format, create table, analyze data
- [ ] Hỗ trợ Ollama (local LLM, không cần internet)

### Giai Đoạn 4: Kết hợp & Polishing (1-2 tuần)
- [ ] Kết nối File Search với Add-in (tìm file từ trong Word/Excel)
- [ ] Packaging (installer, auto-update)
- [ ] UI/UX polish

---

## ⚖️ So Sánh Lựa Chọn Công Nghệ

### Cho Office Add-in: Office.js (Web) vs VSTO (COM)

| Tiêu chí | Office.js (Web Add-in) | VSTO / COM (pywin32/xlwings) |
|----------|----------------------|------------------------------|
| Cross-platform | ✅ Win + Mac + Web | ❌ Windows only |
| Ngôn ngữ | JavaScript/TypeScript | C# / Python |
| Cài đặt | Sideload / Store | .msi installer |
| Khả năng đọc/ghi doc | ✅ Đầy đủ (API) | ✅ Đầy đủ (COM) |
| File system access | ❌ Không (sandbox) | ✅ Có |
| Tương lai | ✅ Microsoft ưu tiên | ⚠️ Legacy |
| **Khuyến nghị** | **✅ Nên dùng** | Dùng nếu cần file system |

### Cho LLM Backend: Cloud vs Local

| Tiêu chí | Cloud (OpenAI/Gemini) | Local (Ollama + Llama3) |
|----------|-----------------------|-------------------------|
| Chất lượng | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Chi phí | 💰 Trả phí | 🆓 Miễn phí |
| Bảo mật dữ liệu | ⚠️ Gửi lên cloud | ✅ 100% local |
| Tốc độ | ✅ Nhanh | ⚠️ Phụ thuộc GPU |
| Offline | ❌ Cần internet | ✅ Offline hoàn toàn |
| **Khuyến nghị** | **BYOK (mang key riêng)** | **Ollama cho enterprise** |

---

## 📚 Tài Nguyên & Links

### Repo Cần Fork/Tham Khảo Ngay
1. **[hewliyang/office-agents](https://github.com/hewliyang/office-agents)** - Repo đầy đủ nhất, monorepo Word+Excel+PPT
2. **[Kuingsmile/word-GPT-Plus](https://github.com/Kuingsmile/word-GPT-Plus)** - Word Add-in mạnh nhất
3. **[ilberpy/excel-ai-assistant](https://github.com/ilberpy/excel-ai-assistant)** - Excel + Ollama
4. **[mrdatawolf/SuperSearchLocalDocs](https://github.com/mrdatawolf/SuperSearchLocalDocs)** - File indexer tốt nhất
5. **[szczyglis-dev/py-gpt](https://github.com/szczyglis-dev/py-gpt)** - Desktop AI assistant hoàn chỉnh

### Tài Liệu Chính Thức
- [Office Add-ins Documentation](https://learn.microsoft.com/en-us/office/dev/add-ins/)
- [Office.js API Reference](https://learn.microsoft.com/en-us/javascript/api/office)
- [Word JavaScript API](https://learn.microsoft.com/en-us/javascript/api/word)
- [Excel JavaScript API](https://learn.microsoft.com/en-us/javascript/api/excel)
- [Yo Office (scaffolding tool)](https://github.com/OfficeDev/generator-office)

### Tools Hỗ Trợ Phát Triển
- **Yeoman Generator for Office**: `npx -y yo office` - Tạo project template
- **Office Addin Debugger**: Debug add-in trực tiếp trong VS Code
- **MarkItDown (Microsoft)**: Chuyển đổi Word/Excel → Markdown cho AI processing
