import { useState, useCallback } from 'react'
import { FileValidationError } from '@/types'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

interface UseFileUploadReturn {
  file: File | null
  previewUrl: string | null
  validationError: FileValidationError | null
  handleFile: (file: File) => void
  reset: () => void
}

export function useFileUpload(): UseFileUploadReturn {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<FileValidationError | null>(null)

  const handleFile = useCallback((newFile: File) => {
    setValidationError(null)

    if (!ACCEPTED_TYPES.includes(newFile.type)) {
      setValidationError({
        type: 'invalid-type',
        message: 'Wgraj plik graficzny (JPG, PNG lub WEBP).',
      })
      return
    }

    if (newFile.size > MAX_SIZE_BYTES) {
      setValidationError({
        type: 'too-large',
        message: 'Zdjęcie musi być mniejsze niż 10 MB.',
      })
      return
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    setFile(newFile)
    setPreviewUrl(URL.createObjectURL(newFile))
  }, [previewUrl])

  const reset = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setFile(null)
    setPreviewUrl(null)
    setValidationError(null)
  }, [previewUrl])

  return { file, previewUrl, validationError, handleFile, reset }
}
