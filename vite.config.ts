import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// WKWebKit + modulepreload: anonymous CORS breaks loading inside screen savers; scrub for prod HTML.
function stripCrossOriginForScreensaverBundle(): Plugin {
  return {
    name: 'strip-crossorigin-bundle',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : './',
  plugins: [react(), tailwindcss(), stripCrossOriginForScreensaverBundle()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
