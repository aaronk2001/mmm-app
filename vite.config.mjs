import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'src',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: proxy API calls to the forked Express server on :5006.
      '/api': { target: 'http://localhost:5006', changeOrigin: true },
    },
  },
  build: {
    // Emit to src/dist — this is what server/index.js serves.
    outDir: path.resolve(__dirname, 'src/dist'),
    emptyOutDir: true,
  },
});
