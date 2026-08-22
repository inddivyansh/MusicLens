import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      // Proxy /api/* to Vercel dev server (vercel dev runs on 3001 by default)
      // Run `vercel dev` for full local API support, or use the proxy below
      // to point at a locally running serverless function environment.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
