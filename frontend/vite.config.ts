import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: {
    __BUILD_NUMBER__: Number(process.env.GUCOS2_BUILD_NUMBER || 0),
    __RUNTIME_GENERATION__: JSON.stringify(process.env.GUCOS2_RUNTIME_GENERATION || 'dev'),
  },
  build: { emptyOutDir: false },
  server: {
    port: 5340,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: { '/api': 'http://127.0.0.1:8016' },
  },
  preview: { headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  } },
});
