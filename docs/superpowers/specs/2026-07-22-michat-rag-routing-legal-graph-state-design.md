# MiChat RAG Routing, Legal Graph, and Live State Design

## Goal

Loáº¡i bá» legal RAG khá»i há»™i thoáº¡i xÃ£ giao, chá»‰ táº¡o citation vÃ  legal reasoning khi truy váº¥n thá»±c sá»± cáº§n nguá»“n phÃ¡p lÃ½, Ä‘á»“ng thá»i hiá»ƒn thá»‹ tráº¡ng thÃ¡i legal graph Ä‘ang cháº¡y theo dá»¯ liá»‡u sá»‘ng thay vÃ¬ snapshot cÅ© trong tin nháº¯n.

## Success Cases

1. `hÃ£y tá»± giá»›i thiá»‡u vá» báº£n thÃ¢n báº¡n` khÃ´ng cháº¡y knowledge search, khÃ´ng táº¡o citation vÃ  khÃ´ng render legal reasoning card.
2. CÃ¢u há»i phÃ¡p lÃ½ tháº­t cháº¡y retrieval, chá»‰ giá»¯ evidence Ä‘á»§ liÃªn quan, render citation há»£p lá»‡ vÃ  legal graph status sá»‘ng.
3. Legal graph card hiá»ƒn thá»‹ `processed/source`, pháº§n trÄƒm, lá»—i cá»¥ thá»ƒ vÃ  retry khi job tháº¥t báº¡i.
4. Worker ghi tá»•ng sá»‘ source unit trÆ°á»›c model request Ä‘áº§u tiÃªn vÃ  khÃ´ng máº¥t nguyÃªn nhÃ¢n lá»—i bÃªn trong.

## Routing

- Chuáº©n hÃ³a query vá» Unicode NFC, chá»¯ thÆ°á»ng vÃ  báº£n khÃ´ng dáº¥u phá»¥c vá»¥ heuristic tiáº¿ng Viá»‡t.
- Nháº­n diá»‡n assistant/social intent gá»“m lá»i chÃ o, cáº£m Æ¡n, yÃªu cáº§u tá»± giá»›i thiá»‡u, há»i danh tÃ­nh vÃ  há»i kháº£ nÄƒng cá»§a MiMi.
- Assistant/social intent bá» qua toÃ n bá»™ RAG.
- Legal reasoning chá»‰ cháº¡y khi query cÃ³ tÃ­n hiá»‡u miá»n phÃ¡p lÃ½; `LegalReasoningIntent.general` khÃ´ng Ä‘Æ°á»£c dÃ¹ng lÃ m domain gate vÃ¬ Ä‘Ã¢y lÃ  intent fallback.
- Query knowledge khÃ´ng phÃ¡p lÃ½ váº«n Ä‘Æ°á»£c phÃ©p dÃ¹ng RAG, nhÆ°ng khÃ´ng táº¡o legal reasoning metadata.

## Retrieval

- Giá»¯ ngÆ°á»¡ng vector hiá»‡n táº¡i á»Ÿ bÆ°á»›c vector search.
- KhÃ´ng coi FTS/RRF rank lÃ  semantic confidence.
- Sau rerank, loáº¡i evidence khÃ´ng Ä‘áº¡t ngÆ°á»¡ng relevance phÃ¹ há»£p vá»›i loáº¡i score Ä‘Æ°á»£c tráº£ vá».
- KhÃ´ng táº¡o citation hoáº·c reasoning seed khi danh sÃ¡ch evidence há»£p lá»‡ rá»—ng.
- KhÃ´ng thÃªm dependency má»›i.

## Legal Graph Worker

- Sau khi load document source, ghi `sourceUnitCount` vÃ  `processedUnitCount = 0` trÆ°á»›c extraction call Ä‘áº§u tiÃªn.
- Emit progress `processing` ngay Ä‘á»ƒ UI cÃ³ thá»ƒ hiá»ƒn thá»‹ `0/218` thay vÃ¬ `0 bÆ°á»›c` khÃ´ng rÃµ nghÄ©a.
- Giá»¯ cause message cá»§a provider/model trong `LegalGraphRetryableError`; loáº¡i control characters trÆ°á»›c khi lÆ°u DB.
- Thá»­ structured `Output.object` trÆ°á»›c.
- Khi provider/model khÃ´ng táº¡o Ä‘Æ°á»£c structured object, thá»­ má»™t láº§n JSON-text fallback, trÃ­ch object JSON vÃ  validate láº¡i báº±ng `legalGraphOutputSchema`.
- KhÃ´ng tÄƒng concurrency; worker váº«n xá»­ lÃ½ tuáº§n tá»± Ä‘á»ƒ báº£o vá»‡ model local.

## Live UI State

- `LegalReasoningPathCard` láº¥y danh sÃ¡ch document ID tá»« reasoning evidence.
- Card load legal graph status khi mount vÃ  subscribe `knowledgeStore.legalGraphStatuses`.
- Live status ghi Ä‘Ã¨ snapshot `graphStatus` trong message metadata.
- `processing` hiá»ƒn thá»‹ pháº§n trÄƒm vÃ  `processed/source`.
- `failed` hiá»ƒn thá»‹ `lastError` vÃ  hÃ nh Ä‘á»™ng retry.
- `ready` hiá»ƒn thá»‹ verified paths; náº¿u chÆ°a cÃ³ path, giáº£i thÃ­ch evidence chÆ°a map Ä‘Æ°á»£c node.
- Tin nháº¯n má»›i ngoÃ i miá»n phÃ¡p lÃ½ khÃ´ng cÃ³ `legalReasoning` metadata nÃªn khÃ´ng render card.

## Compatibility

- KhÃ´ng sá»­a schema DB.
- KhÃ´ng xÃ³a metadata tin nháº¯n cÅ©.
- Card cÅ© Ä‘Æ°á»£c lÃ m má»›i báº±ng live document status khi evidence cÃ²n tá»“n táº¡i.
- Citation panel chá»‰ cÃ³ dá»¯ liá»‡u khi cÃ¢u tráº£ lá»i chá»©a citation há»£p lá»‡ tá»« evidence Ä‘Æ°á»£c giá»¯ láº¡i.

## Verification

- Unit test: self-introduction bá» qua `KnowledgeService.search` vÃ  `LegalReasoningService.reason`.
- Unit test: legal query váº«n cháº¡y search vÃ  reasoning.
- Unit test: weak retrieval khÃ´ng táº¡o citation/reasoning metadata.
- Worker test: progress Ä‘áº§u tiÃªn lÃ  `0/sourceUnitCount`.
- Extraction test: structured-output failure dÃ¹ng JSON fallback vÃ  giá»¯ lá»—i gá»‘c náº¿u fallback cÅ©ng tháº¥t báº¡i.
- Renderer test: snapshot `pending` chuyá»ƒn thÃ nh live `failed`; retry Ä‘Æ°á»£c gá»i Ä‘Ãºng document.
- Cháº¡y targeted tests, typecheck/build, sau Ä‘Ã³ cháº¡y Electron vÃ  chá»¥p hai ca thÃ nh cÃ´ng tá»« á»©ng dá»¥ng tháº­t.

## Non-Goals

- KhÃ´ng thay toÃ n bá»™ retrieval báº±ng classifier LLM.
- KhÃ´ng xÃ¢y láº¡i legal graph schema hoáº·c ontology.
- KhÃ´ng cháº¡y hoÃ n táº¥t 218 model calls nhÆ° Ä‘iá»u kiá»‡n báº¯t buá»™c cho demo; demo pháº£i pháº£n Ã¡nh Ä‘Ãºng `processing`, `ready` hoáº·c `failed` thá»±c táº¿.
