import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

path = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\src\main\ipc\chatHandlers.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove unused isLegalNotebook import
content = content.replace(
    "import { isLegalNotebook } from '../../shared/utils/modelClassifier'\n",
    ""
)

# 2. Move ragContextResult to broader scope
old_block = "            if (searchResults.length > 0) {\n              const ragContextResult = buildRAGContext(searchResults)"
new_block = "            let ragContextResult: { context: string; includedChunkIds: Set<string> } = { context: '', includedChunkIds: new Set() }\n            if (searchResults.length > 0) {\n              ragContextResult = buildRAGContext(searchResults)"
content = content.replace(old_block, new_block)

# 3. Guard validator - wrap in if block
old_validator = """            // Validate RAG response before sending to user
    const validatedResponse = validateRagResponse(fullContent, ragContextResult.includedChunkIds)
    if (!validatedResponse.valid) {
      Logger.warn('ChatHandlers', RAG response validation failed: )
    }
    const displayContent = validatedResponse.valid ? validatedResponse.response : fullContent"""
new_validator = """            // Validate RAG response before sending to user (only when RAG context was injected)
    let displayContent = fullContent
    if (ragContextResult.includedChunkIds.size > 0) {
      const validatedResponse = validateRagResponse(fullContent, ragContextResult.includedChunkIds)
      if (!validatedResponse.valid) {
        Logger.warn('ChatHandlers', 'RAG response validation failed:', validatedResponse.reason)
      }
      displayContent = validatedResponse.valid ? validatedResponse.response : fullContent
    }"""
content = content.replace(old_validator, new_validator)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done: scope fix + import clean + guard validator")
