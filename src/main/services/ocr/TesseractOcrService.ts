import vieData from '@tesseract.js-data/vie'
import { createWorker, PSM, type Worker } from 'tesseract.js'

export interface OcrResult {
  text: string
  confidence: number
}

export class TesseractOcrService {
  private worker?: Worker

  private async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker

    this.worker = await createWorker('vie', 1, {
      langPath: vieData.langPath,
      gzip: vieData.gzip,
      cacheMethod: 'readOnly'
    })
    await this.worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '220'
    })
    return this.worker
  }

  async recognizeImage(image: Buffer | Uint8Array): Promise<OcrResult> {
    const worker = await this.getWorker()
    const result = await worker.recognize(Buffer.from(image))
    return {
      text: result.data.text.normalize('NFC').trim(),
      confidence: result.data.confidence
    }
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    await worker?.terminate()
  }
}
