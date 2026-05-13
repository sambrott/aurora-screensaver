import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function screensaverHtmlPostProcess(): Plugin {
  return {
    name: 'screensaver-html-post',
    apply: 'build',
    transformIndexHtml(html) {
      let out = html
        .replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
        // Vite still tags script as module even for IIFE output; WKWebView often won't run it.
        .replace(/\s+type=["']module["']/gi, '')
      // Prefer CSS before the classic script so the first paint isn’t missing Tailwind/fonts.
      out = out.replace(
        /(<script[^>]*\ssrc=["'][^"']+["'][^>]*>\s*<\/script>)\s*(<link rel=["']stylesheet["'][^>]*>)/,
        '$2\n    $1',
      )
      return out
    },
  }
}

// WKWebView inside ScreenSaver does not reliably run `type="module"` bundles.
// We emit one classic-script IIFE (+ single CSS chunk) and strip `type="module"` from HTML.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), screensaverHtmlPostProcess()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
