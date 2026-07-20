import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext'
  },
  server: {
    port: 8000,
    strictPort: true
  }
});
