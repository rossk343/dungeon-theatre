import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/hubs': { target: 'http://localhost:5092', ws: true },
      '/api': 'http://localhost:5092',
      '/uploads': 'http://localhost:5092',
    },
  },
})
