import { defineConfig } from 'vite';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

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

function githubPages404Plugin() {
  let outDir = 'dist';
  return {
    name: 'nokakoi-github-pages-404',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await copyFile(path.join(outDir, 'index.html'), path.join(outDir, '404.html'));
    }
  };
}

export default defineConfig({
  plugins: [htmlPartialsPlugin(), githubPages404Plugin()],
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
