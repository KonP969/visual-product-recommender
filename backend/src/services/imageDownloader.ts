import axios from 'axios'

const TIMEOUT_MS = 10_000

export async function downloadImage(url: string): Promise<{ buffer: Buffer; mimetype: string }> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
  })

  const mimetype = (response.headers['content-type'] as string | undefined)
    ?.split(';')[0]
    ?.trim() ?? 'image/jpeg'

  return { buffer: Buffer.from(response.data), mimetype }
}
