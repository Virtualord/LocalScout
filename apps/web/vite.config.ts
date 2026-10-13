import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const API_TARGET = process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@localscout/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // Strict: bind to loopback only, matching the API. This app must never be
    // reachable from the network.
    host: '127.0.0.1',
    proxy: {
      // Proxied rather than fetched cross-origin so the browser sees one origin
      // and the API's CORS rules stay meaningful rather than being disabled.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // SSE needs buffering off, or progress arrives in one lump at the end.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
