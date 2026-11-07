/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Développeur : le serveur Vite redirige /api et /uploads vers le backend
// local (node src/server.js) sur le port 8080. Le dossier public/img/ est
// servi automatiquement comme statique par Vite (le build le copie vers
// dist/), donc /img/bg_dark.jpg fonctionne en dev comme en production,
// sans proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
