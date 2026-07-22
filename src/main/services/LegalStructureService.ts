import type { LegalModalityTag } from '../../shared/types/legalReasoning'

export interface LegalHeading {
  number: string
  title: string
  startOffset: number
}

export interface LegalArticle extends LegalHeading {}

export interface LegalDocumentStructure {
  chapterCount: number
  sectionCount: number
  articleCount: number
  chapters: LegalHeading[]
  sections: LegalHeading[]
  articles: LegalArticle[]
  clauses: LegalHeading[]
  points: LegalHeading[]
}

export interface LegalChunkContext {
  chapterNumber?: string
  chapterTitle?: string
  sectionNumber?: string
  sectionTitle?: string
  articleNumber?: string
  articleTitle?: string
  clauseNumber?: string
  clauseTitle?: string
  pointNumber?: string
  pointTitle?: string
  modalities?: LegalModalityTag[]
}

const CHAPTER_PATTERN = /^\s*chương\s+([ivxlcdm]+|\d+[a-z]?)\s*[.:\-]?\s*(.*)$/iu
const SECTION_PATTERN = /^\s*mục\s+(\d+[a-z]?)\s*[.:\-]?\s*(.*)$/iu
const ARTICLE_PATTERN = /^\s*điều\s+(\d+[a-z]?)\s*[.:\-]\s*(.*)$/iu
const CLAUSE_PATTERN = /^\s*(\d+[a-z]?)\s*[.)]\s*(.*)$/iu
const POINT_PATTERN = /^\s*([a-zđ])\)\s*(.*)$/iu

function headingFromMatch(
  match: RegExpMatchArray,
  lines: string[],
  nextLineIndex: number,
  startOffset: number
): LegalHeading {
  const inlineTitle = match[2].trim()
  const followingTitle = lines
    .slice(nextLineIndex)
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !CHAPTER_PATTERN.test(line) &&
        !SECTION_PATTERN.test(line) &&
        !ARTICLE_PATTERN.test(line)
    )

  return {
    number: match[1].toUpperCase(),
    title: inlineTitle || followingTitle || '',
    startOffset
  }
}

function lastHeadingAtOrBefore(headings: LegalHeading[], offset: number): LegalHeading | undefined {
  for (let headingIndex = headings.length - 1; headingIndex >= 0; headingIndex--) {
    const heading = headings[headingIndex]
    if (heading.startOffset <= offset) return heading
  }
  return undefined
}

function lastHeadingInArticle(
  headings: LegalHeading[],
  article: LegalHeading | undefined,
  offset: number
): LegalHeading | undefined {
  const heading = lastHeadingAtOrBefore(headings, offset)
  if (!heading || (article && heading.startOffset < article.startOffset)) return undefined
  return heading
}

export function parseLegalStructure(content: string): LegalDocumentStructure | undefined {
  const chapters: LegalHeading[] = []
  const sections: LegalHeading[] = []
  const articles: LegalArticle[] = []
  const clauses: LegalHeading[] = []
  const points: LegalHeading[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let startOffset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const chapterMatch = line.match(CHAPTER_PATTERN)
    const sectionMatch = line.match(SECTION_PATTERN)
    const articleMatch = line.match(ARTICLE_PATTERN)
    const clauseMatch = line.match(CLAUSE_PATTERN)
    const pointMatch = line.match(POINT_PATTERN)

    if (chapterMatch) {
      chapters.push(headingFromMatch(chapterMatch, lines, lineIndex + 1, startOffset))
    } else if (sectionMatch) {
      sections.push(headingFromMatch(sectionMatch, lines, lineIndex + 1, startOffset))
    } else if (articleMatch) {
      articles.push(headingFromMatch(articleMatch, lines, lineIndex + 1, startOffset))
    } else if (clauseMatch) {
      clauses.push(headingFromMatch(clauseMatch, lines, lineIndex + 1, startOffset))
    } else if (pointMatch) {
      points.push(headingFromMatch(pointMatch, lines, lineIndex + 1, startOffset))
    }

    startOffset += line.length + 1
  }

  if (articles.length === 0) return undefined

  return {
    chapterCount: chapters.length,
    sectionCount: sections.length,
    articleCount: articles.length,
    chapters,
    sections,
    articles,
    clauses,
    points
  }
}

export function getLegalContextAt(
  structure: LegalDocumentStructure,
  offset: number
): LegalChunkContext {
  const chapter = lastHeadingAtOrBefore(structure.chapters, offset)
  const section = lastHeadingAtOrBefore(structure.sections, offset)
  const article = lastHeadingAtOrBefore(structure.articles, offset)
  const clause = lastHeadingInArticle(structure.clauses, article, offset)
  const point = lastHeadingInArticle(structure.points, article, offset)

  return {
    chapterNumber: chapter?.number,
    chapterTitle: chapter?.title || undefined,
    sectionNumber: section?.number,
    sectionTitle: section?.title || undefined,
    articleNumber: article?.number,
    articleTitle: article?.title || undefined,
    clauseNumber: clause?.number,
    clauseTitle: clause?.title || undefined,
    pointNumber: point?.number?.toLowerCase(),
    pointTitle: point?.title || undefined
  }
}

export function buildLegalDocumentProfile(
  documentTitle: string,
  structure: LegalDocumentStructure
): string {
  const chapterLines = structure.chapters.map((chapter) => {
    const title = chapter.title ? `: ${chapter.title}` : ''
    return `- Chương ${chapter.number}${title}`
  })

  return [
    'CẤU TRÚC VĂN BẢN PHÁP LUẬT',
    `Tài liệu: ${documentTitle}`,
    `Số chương: ${structure.chapterCount}`,
    `Số mục: ${structure.sectionCount}`,
    `Số điều: ${structure.articleCount}`,
    'Danh mục chương:',
    ...(chapterLines.length > 0
      ? chapterLines
      : ['- Tài liệu không có tiêu đề Chương được nhận diện.']),
    'Các số liệu trên được trích từ tiêu đề văn bản gốc.'
  ].join('\n')
}

export function buildLegalChunkPrefix(context: LegalChunkContext): string {
  const labels = [
    context.chapterNumber &&
      `Chương ${context.chapterNumber}${context.chapterTitle ? `: ${context.chapterTitle}` : ''}`,
    context.sectionNumber &&
      `Mục ${context.sectionNumber}${context.sectionTitle ? `: ${context.sectionTitle}` : ''}`,
    context.articleNumber &&
      `Điều ${context.articleNumber}${context.articleTitle ? `: ${context.articleTitle}` : ''}`,
    context.clauseNumber &&
      `Khoản ${context.clauseNumber}${context.clauseTitle ? `: ${context.clauseTitle}` : ''}`,
    context.pointNumber &&
      `Điểm ${context.pointNumber}${context.pointTitle ? `: ${context.pointTitle}` : ''}`
  ].filter(Boolean)

  return labels.join('\n')
}
