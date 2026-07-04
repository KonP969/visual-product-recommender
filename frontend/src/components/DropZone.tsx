import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import { Upload, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileValidationError } from '@/types'

interface DropZoneProps {
  previewUrl: string | null
  validationError: FileValidationError | null
  onFile: (file: File) => void
}

export function DropZone({ previewUrl, validationError, onFile }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex h-64 w-full max-w-lg cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all',
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50',
        )}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Podgląd wgranego zdjęcia"
            className="h-full w-full rounded-2xl object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-white p-3 shadow-sm">
              {isDragging ? (
                <ImageIcon className="h-6 w-6 text-blue-500" />
              ) : (
                <Upload className="h-6 w-6 text-gray-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Przeciągnij zdjęcie wnętrza tutaj
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                lub kliknij, aby wybrać · JPG, PNG, WEBP · maks. 10 MB
              </p>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>
      {validationError && (
        <p className="text-sm text-red-500">{validationError.message}</p>
      )}
    </div>
  )
}
