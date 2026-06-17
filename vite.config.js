import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Middleware plugin: any path starting with /admin that isn't /admin-ops
// must return index.html so React's client-side router handles it.
// Without this, macOS case-insensitive FS matches /admin → Admin.jsx
// and Vite serves the raw JS module instead of the HTML shell.
const adminSpaFallback = {
  name: 'admin-spa-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/admin') && !req.url.startsWith('/admin-ops')) {
        req.url = '/index.html';
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), adminSpaFallback],
  root: 'src/client',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/admin-ops': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true, changeOrigin: true },
    },
  },
});
