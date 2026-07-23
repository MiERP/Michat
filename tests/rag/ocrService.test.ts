import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { TesseractOcrService } from '../../src/main/services/ocr/TesseractOcrService'

describe('TesseractOcrService', () => {
  it(
    'recognizes Vietnamese legal text without network access',
    async () => {
      const canvas = createCanvas(1200, 300)
      const context = canvas.getContext('2d')
      context.fillStyle = 'white'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = 'black'
      context.font = 'bold 72px Arial'
      context.fillText('Điều 15. Xử phạt vi phạm', 40, 130)
      context.font = '44px Arial'
      context.fillText('Doanh nghiệp phải nộp hồ sơ.', 40, 220)

      const service = new TesseractOcrService()
      const result = await service.recognizeImage(await canvas.encode('png'))
      await service.dispose()

      expect(result.text.normalize('NFC')).toContain('Điều 15')
      expect(result.text.normalize('NFC')).toContain('Doanh nghiệp')
      expect(result.confidence).toBeGreaterThan(70)
    },
    30_000
  )
})
