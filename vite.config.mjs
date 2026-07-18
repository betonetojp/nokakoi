import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
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
