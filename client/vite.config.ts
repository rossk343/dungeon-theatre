import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Plain http://localhost/ in dev; strictPort fails loudly if something else holds port 80.
    host: true, // listen on all interfaces so other LAN machines can connect
    port: 80,
    strictPort: true,
    proxy: {
      '/hubs': { target: 'http://localhost:5092', ws: true },
      '/api': 'http://localhost:5092',
      '/uploads': 'http://localhost:5092',
    },
  },
})
