/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Config w zmiennej pośredniej, nie inline w defineConfig({...}): pole `test`
// pochodzi z augmentacji typów vitest@2 (celującej w vite@5), a projekt ma
// vite@4 — inline literal wyzwala TS2769 (excess-property check). Zmienna
// pośrednia jest sprawdzana strukturalnie i to obchodzi. NIE zwijaj do inline.
const config = {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}

export default defineConfig(config)
