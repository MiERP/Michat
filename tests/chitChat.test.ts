import { describe, expect, it } from 'vitest'
import {
  isLikelyChitChat,
  isSmallTalkQuery,
  mentionsLegalReference
} from '../src/main/utils/chitChat'
import { shouldRefuseEmptyKnowledgeBase } from '../src/main/utils/grounding'

describe('chit-chat detection', () => {
  it('detects greetings and thanks in Vietnamese and English', () => {
    for (const query of [
      'xin chào',
      'xin chào 👋',
      'chào',
      'Chào!',
      'chào anh',
      'chao ban',
      'chào bạn nhé',
      'chào bạn ạ',
      'chào tất cả mọi người',
      'cảm ơn',
      'cảm ơn anh',
      'cảm ơn bạn nhé',
      'cảm ơn bạn nhiều',
      'cảm ơn bạn rất nhiều',
      'cảm ơn bạn nhiều nhé',
      'cảm ơn mọi người',
      'dạ vâng',
      'ok nhé',
      'hi',
      'hello',
      'hello friend',
      'hello my friend',
      'hello, how are you?',
      'hi everybody',
      'good morning everyone',
      'thank you',
      'thank you so much',
      'thanks for your help'
    ]) {
      expect(isSmallTalkQuery(query), query).toBe(true)
    }
  })

  it('detects identity and capability questions', () => {
    for (const query of [
      'bạn là ai',
      'bạn là ai vậy',
      'bạn tên gì',
      'bạn tên là gì',
      'bạn có thể làm gì',
      'bạn khỏe không',
      'chào bạn, bạn khỏe không?',
      'who are you'
    ]) {
      expect(isSmallTalkQuery(query), query).toBe(true)
    }
  })

  it('does not treat knowledge questions as small talk', () => {
    for (const query of ['hôn nhân', 'Điều 8', 'luật hôn nhân và gia đình', 'thuế là gì']) {
      expect(isSmallTalkQuery(query)).toBe(false)
    }
  })

  it('does not treat ambiguous nouns as acknowledgments', () => {
    for (const query of ['vàng', 'đá', 'cháo', 'dược', 'u', 'vang', 'da', 'duoc', 'chao']) {
      expect(isSmallTalkQuery(query)).toBe(false)
      expect(shouldRefuseEmptyKnowledgeBase(query, 0)).toBe(true)
    }
  })

  it('keeps the short-query shortcut for the RAG skip heuristic only', () => {
    // RAG may skip this for latency, but grounding decisions still refuse it in
    // an empty notebook instead of letting the model answer from memory.
    expect(isLikelyChitChat('hôn nhân', 12)).toBe(true)
    expect(isSmallTalkQuery('hôn nhân')).toBe(false)
  })

  it('detects explicit legal references in short queries', () => {
    for (const query of [
      'Điều 8',
      'dieu 8',
      'khoản 2',
      'Chương II',
      'Điều thứ 8',
      'Điều tám',
      'Khoản thứ 2',
      'Luật Hôn nhân',
      'Nghị định 99',
      'Article 8',
      'Section 2',
      'Clause 2',
      'Chapter II'
    ]) {
      expect(mentionsLegalReference(query), query).toBe(true)
      expect(isLikelyChitChat(query, 12), query).toBe(false)
    }
    for (const query of ['hôn nhân', 'xin chào', 'thuế là gì']) {
      expect(mentionsLegalReference(query)).toBe(false)
    }
  })

  it('treats question-marked short queries as knowledge intent', () => {
    for (const query of ['ly hôn?', 'hợp đồng?', 'thừa kế?', 'Hi thuế?']) {
      expect(isLikelyChitChat(query, 12), query).toBe(false)
    }
  })

  it('does not treat greeting-prefixed questions as small talk', () => {
    const queries = [
      'chào bạn, Điều 8 quy định gì?',
      'chào bạn nhé, Điều 8 là gì?',
      'chào anh, Điều 8 là gì?',
      'Bạn có thể giúp tôi tóm tắt luật hôn nhân?',
      'Cảm ơn, nhưng Điều 8 là gì?',
      'Hi, what does Article 8 say?',
      'Hello, summarize this document'
    ]
    for (const query of queries) {
      expect(isSmallTalkQuery(query), query).toBe(false)
      expect(isLikelyChitChat(query, 12), query).toBe(false)
      expect(shouldRefuseEmptyKnowledgeBase(query, 0), query).toBe(true)
    }
  })
})

describe('empty knowledge base guard', () => {
  it('refuses knowledge questions when the notebook has no chunks', () => {
    expect(shouldRefuseEmptyKnowledgeBase('tóm tắt luật hôn nhân và gia đình', 0)).toBe(true)
    expect(shouldRefuseEmptyKnowledgeBase('hôn nhân', 0)).toBe(true)
    expect(shouldRefuseEmptyKnowledgeBase('Điều 8', 0)).toBe(true)
  })

  it('still allows greetings in an empty notebook', () => {
    for (const query of [
      'xin chào',
      'chào',
      'chào anh',
      'chào bạn nhé',
      'cảm ơn bạn nhiều',
      'cảm ơn anh',
      'dạ vâng',
      'bạn là ai',
      'bạn là ai vậy',
      'thank you so much'
    ]) {
      expect(shouldRefuseEmptyKnowledgeBase(query, 0), query).toBe(false)
    }
  })

  it('does not refuse when indexed chunks exist', () => {
    expect(shouldRefuseEmptyKnowledgeBase('luật hôn nhân và gia đình', 12)).toBe(false)
  })
})
