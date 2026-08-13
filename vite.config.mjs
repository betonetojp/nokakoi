import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';

const htmlPartials = {
  'partials/modals-main.html': new URL('./partials/modals-main.html', import.meta.url),
  'partials/modals-app.html': new URL('./partials/modals-app.html', import.meta.url),
  'partials/modals-support.html': new URL('./partials/modals-support.html', import.meta.url)
};

function htmlPartialsPlugin() {
  return {
    name: 'nokakoi-html-partials',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const entries = await Promise.all(
          Object.entries(htmlPartials).map(async ([name, path]) => [name, await readFile(path, 'utf8')])
        );
        return entries.reduce(
          (result, [name, partial]) => result.replace(`<!-- @include ${name} -->`, partial.trimEnd()),
          html
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [htmlPartialsPlugin()],
  base: './',
  root: '.',
  publicDir: 'public',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2020', 'safari13']
  },
  server: {
    port: 8000,
    strictPort: true
  }
});
