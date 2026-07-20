// イベントモーダル向けの最小 markdown パーサーローダー（必要時のみ読み込み）
// XSS 対策として CDN の marked.js と DOMPurify を利用

export async function parseMarkdownSafe(mdText) {
  // 未読込なら CDN から marked と DOMPurify を読み込む
  if (!window.marked) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  if (!window.DOMPurify) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  // markdown をパースしてサニタイズ
  const html = window.marked.parse(mdText || '');
  return window.DOMPurify.sanitize(html, {USE_PROFILES: {html: true}});
}
