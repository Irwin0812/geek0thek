import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config TRANSITOIRE (tests headless, jamais à committer) : mêmes plugins que
// vite.config.js mais proxy /api + /uploads vers la VM (http://172.16.2.75)
// au lieu du backend local localhost:8080.
export default defineConfig({
  root: 'C:/Users/irwin/geek0thek/frontend',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Via le proxy CORS local (uitest/corsproxy.mjs) : la VM refuse
      // l'Origin localhost:5173 (CORS_ORIGIN=http://172.16.2.75), le proxy
      // injecte les en-têtes manquants avant de pousser vers la VM.
      '/api': { target: 'http://127.0.0.1:8090', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8090', changeOrigin: true },
    },
  },
})
