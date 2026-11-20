import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base works under any repo name on GitHub Pages, and on Netlify.
  base: './',
})