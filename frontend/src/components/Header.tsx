import { ExternalLink } from 'lucide-react'

export function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-sm font-semibold tracking-tight text-gray-900">
            Wizualny Doradca Drzwi
          </span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          GitHub
        </a>
      </div>
    </header>
  )
}
