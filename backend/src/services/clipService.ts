import axios from 'axios'
import FormData from 'form-data'

const SIDECAR_URL = process.env.CLIP_SIDECAR_URL ?? 'http://localhost:8001'

export async function getEmbedding(imageBuffer: Buffer, mimetype: string): Promise<number[]> {
  const form = new FormData()
  form.append('file', imageBuffer, {
    filename: 'image',
    contentType: mimetype,
  })

  const response = await axios.post<{ embedding: number[] }>(
    `${SIDECAR_URL}/embed`,
    form,
    { headers: form.getHeaders() },
  )

  return response.data.embedding
}

export async function getTextEmbedding(text: string): Promise<number[]> {
  const response = await axios.post<{ embedding: number[] }>(
    `${SIDECAR_URL}/embed-text`,
    { text },
    { headers: { 'Content-Type': 'application/json' } },
  )
  return response.data.embedding
}

export async function isSidecarHealthy(): Promise<boolean> {
  try {
    const response = await axios.get<{ status: string }>(`${SIDECAR_URL}/health`, {
      timeout: 3000,
    })
    return response.data.status === 'ok'
  } catch {
    return false
  }
}
