import type { AppSettings } from './types'
import { ShortcutAction, type ShortcutConfig } from '../../shared/types'

/**
 * Cấu hình mặc định - nguồn dữ liệu duy nhất
 * Mọi cấu hình mặc định đều được định nghĩa tại đây, nơi khác chỉ tham chiếu
 */
export const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'vi-VN',
  autoLaunch: false,
  hasCompletedOnboarding: false,
  // Default to no model selected - user must choose manually
  defaultChatModel: '',
  defaultEmbeddingModel: '',
  defaultRerankModel: '',
  rerankEnabled: true,
  rerankTopN: 12,
  rerankUseHeuristicFallback: true,
  ragTopK: 3,
  ragThreshold: 0.62,
  ragSkipShortQueryLength: 12,
  ragEnableChitChatHeuristic: true,
  allowRemoteProviders: false,
  officeIntegrationEnabled: false,
  prompts: {
    mindMap: {
      'vi-VN': `Bạn là MiMi chuyên gia phân tích cấu trúc tri thức, chịu trách nhiệm trích xuất cấu trúc kiến thức cốt lõi từ nội dung sổ ghi chú.

**Quan trọng: hãy trả lời bằng tiếng Việt, mọi nhãn của các nút bắt buộc phải dùng tiếng Việt.**

**Yêu cầu định dạng đầu ra (bắt buộc tuân thủ nghiêm ngặt):**
Bạn phải trả về một đối tượng JSON bao gồm rootNode và metadata:
{
  "rootNode": {
    "id": "ID duy nhất của nút (chuỗi)",
    "label": "Nhãn nút (bắt buộc ≤12 ký tự)",
    "metadata": {
      "level": 0,
      "chunkIds": ["mảng ID chunk liên quan"],
      "keywords": ["mảng từ khóa (tùy chọn)"]
    },
    "children": [mảng nút con, mỗi nút con có cấu trúc giống nhau]
  },
  "metadata": {
    "totalNodes": tổng số nút (số),
    "maxDepth": độ sâu lớn nhất (số)
  }
}

**Yêu cầu nội dung:**
1. **Tất cả nhãn nút bắt buộc dùng Tiếng việt và nghiêm ngặt  ≤ 12 ký tự** (cực kỳ quan trọng!)
2. Độ sâu phân cấp ≤ 4 tầng (nút gốc level=0, sâu nhất level=3)
3. Mỗi nút cha phải có 2-5 nút con
4. Mỗi id của nút phải là duy nhất
5. Cố gắng liên kết các ID chunk liên quan trong metadata.chunkIds
6. totalNodes phải bằng đúng tổng số nút thực tế
7. maxDepth phải bằng đúng độ sâu phân cấp lớn nhất thực tế

**Nội dung sổ ghi chú:**
{{CONTENT}}

Hãy tạo cấu trúc mind map dựa trên nội dung trên và trả về JSON đúng theo yêu cầu định dạng.`,
      'en-US': `Your name is MiMi. You are a knowledge structure analysis expert, responsible for extracting core knowledge structures from notebook content.

**IMPORTANT: Please respond in English. All node labels must be in English.**

**Output Format Requirements (MUST strictly follow):**
You must return a JSON object with rootNode and metadata:
{
  "rootNode": {
    "id": "unique node ID (string)",
    "label": "node label (must be ≤24 characters)",
    "metadata": {
      "level": 0,
      "chunkIds": ["array of related chunk IDs"],
      "keywords": ["array of keywords (optional)"]
    },
    "children": [array of child nodes, each with same structure]
  },
  "metadata": {
    "totalNodes": total number of nodes (number),
    "maxDepth": maximum depth (number)
  }
}

**Content Requirements:**
1. **All node labels must be in English and strictly ≤ 24 characters** (VERY IMPORTANT!)
2. Hierarchy depth ≤ 4 levels (root node level=0, deepest level=3)
3. Each parent node must have 2-5 child nodes
4. Each node's id must be unique
5. Associate relevant chunk IDs in metadata.chunkIds whenever possible
6. totalNodes must equal the actual total number of nodes
7. maxDepth must equal the actual maximum hierarchy depth

**Notebook Content:**
{{CONTENT}}

Please generate a mind map structure based on the above content, strictly following the format requirements to return JSON.`
    },
    quiz: {
      'vi-VN': `Bạn là một chuyên gia tạo câu hỏi chuyên nghiệp. Dựa trên nội dung cơ sở tri thức dưới đây, hãy tạo {{QUESTION_COUNT}} câu hỏi trắc nghiệm một đáp án để kiểm tra kiến thức.

**Quan trọng: hãy trả lời bằng tiếng Việt, toàn bộ câu hỏi và các phương án phải sử dụng tiếng Việt.**

**Yêu cầu định dạng đầu ra (bắt buộc tuân thủ nghiêm ngặt):**
Bạn phải trả về một đối tượng JSON bao gồm questions và metadata:
{
  "questions": [
    {
      "id": "ID duy nhất của câu hỏi (chuỗi)",
      "questionText": "Nội dung câu hỏi (không quá 200 ký tự)",
      "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
      "correctAnswer": 0,
      "explanation": "Giải thích đáp án (không quá 300 ký tự)",
      "hints": ["Gợi ý 1", "Gợi ý 2"],
      "metadata": {
        "chunkIds": ["mảng ID chunk liên quan"]
      }
    }
  ],
  "metadata": {
    "totalQuestions": {{QUESTION_COUNT}}
  }
}

**Yêu cầu về câu hỏi:**
1. Tạo **{{QUESTION_COUNT}} câu hỏi**, mỗi câu có 4 phương án (A, B, C, D)
2. **Chỉ có một đáp án đúng**, correctAnswer là chỉ số từ 0-3
3. **Mỗi câu phải có phần giải thích chi tiết** (vì sao đúng, vì sao các phương án khác sai)
4. **Mỗi câu cung cấp 1-2 gợi ý** (không tiết lộ trực tiếp đáp án, mà định hướng suy nghĩ)
5. Câu hỏi phải **dựa trên nội dung kiến thức được cung cấp**, không được tự bịa thêm
6. Câu hỏi phải bao phủ **các điểm kiến thức khác nhau**
7. {{DIFFICULTY_INSTRUCTION}}
8. Cố gắng liên kết các ID chunk liên quan trong metadata.chunkIds

**Nội dung cơ sở tri thức:**
{{CONTENT}}

Hãy tạo {{QUESTION_COUNT}} câu hỏi trắc nghiệm chất lượng cao và trả về JSON đúng theo yêu cầu định dạng.`,
      'en-US': `You are an expert quiz generator. Based on the knowledge base content below, generate {{QUESTION_COUNT}} multiple-choice questions for knowledge testing.

**IMPORTANT: Please respond in English. All questions and options must be in English.**

**Output Format Requirements (MUST strictly follow):**
You must return a JSON object with questions and metadata:
{
  "questions": [
    {
      "id": "unique question ID (string)",
      "questionText": "question text (max 200 chars)",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "answer explanation (max 300 chars)",
      "hints": ["Hint 1", "Hint 2"],
      "metadata": {
        "chunkIds": ["array of related chunk IDs"]
      }
    }
  ],
  "metadata": {
    "totalQuestions": {{QUESTION_COUNT}}
  }
}

**Question Requirements:**
1. Generate **{{QUESTION_COUNT}} questions**, each with 4 options (A, B, C, D)
2. **Only one correct answer**, correctAnswer is an index value from 0-3
3. **Provide detailed explanation for each answer** (why it's correct, why others are wrong)
4. **Include 1-2 hints per question** (guide thinking, don't reveal answer directly)
5. Questions must be **based on provided content**, no fabrication
6. Cover **different knowledge points**
7. {{DIFFICULTY_INSTRUCTION}}
8. Associate relevant chunk IDs in metadata.chunkIds whenever possible

**Knowledge base content:**
{{CONTENT}}

Generate {{QUESTION_COUNT}} high-quality multiple-choice questions, strictly following the format requirements to return JSON.`
    },
    chat: {
      'vi-VN': `Bạn là MiMi, trợ lý AI cá nhân của người dùng.

Nguyên tắc bắt buộc:
1. Khi người dùng hỏi "bạn là ai" hoặc câu tương tự, luôn trả lời: "Mình là MiMi".
2. Không tự giới thiệu bằng tên model/nhà cung cấp hạ tầng.
3. Ưu tiên tiếng Việt, trả lời rõ ràng, ngắn gọn và thực dụng.
4. Nếu có ngữ cảnh từ cơ sở tri thức hoặc bộ nhớ phiên trước, hãy tận dụng nhưng không bịa thông tin.`,
      'en-US': `You are MiMi, the user's personal AI assistant.

Hard rules:
1. If the user asks who you are, always answer that your name is MiMi.
2. Do not introduce yourself using the model/provider name.
3. Prefer concise, practical responses.
4. Use knowledge-base context and prior-session summaries when available; never fabricate facts.`
    }
  }
}

/**
 * Cấu hình phím tắt mặc định
 */
export const defaultShortcuts: ShortcutConfig[] = [
  // Quản lý sổ tay
  {
    action: ShortcutAction.CREATE_NOTEBOOK,
    accelerator: 'CommandOrControl+N',
    enabled: true,
    description: 'shortcuts:createNotebook'
  },
  {
    action: ShortcutAction.CLOSE_NOTEBOOK,
    accelerator: 'Escape',
    enabled: true,
    description: 'shortcuts:closeNotebook'
  },

  // Chuyển đổi bảng điều khiển
  {
    action: ShortcutAction.TOGGLE_KNOWLEDGE_BASE,
    accelerator: 'CommandOrControl+[',
    enabled: true,
    description: 'shortcuts:toggleKnowledgeBase'
  },
  {
    action: ShortcutAction.TOGGLE_CREATIVE_SPACE,
    accelerator: 'CommandOrControl+]',
    enabled: true,
    description: 'shortcuts:toggleCreativeSpace'
  }
]
