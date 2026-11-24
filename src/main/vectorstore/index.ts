/**
 * VectorStore module entry point
 */

export * from './types'
export { SQLiteVectorStore } from './SQLiteVectorStore'
export {
  SQLiteDocumentVectorStore,
  documentVectorStore,
  DOCUMENT_VECTOR_DIMENSIONS
} from './SQLiteDocumentVectorStore'
export {
  SQLiteSectionVectorStore,
  sectionVectorStore,
  SECTION_VECTOR_DIMENSIONS
} from './SQLiteSectionVectorStore'
export { VectorStoreManager, vectorStoreManager } from './VectorStoreManager'
