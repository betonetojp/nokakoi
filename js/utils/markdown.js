import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * 実行や危険な動作・レイアウト破壊を防止したいHTMLタグを開始・終了ともにエスケープし、
 * タグを消去せずテキストとしてそのまま読めるようにする
 */
export function escapeDisallowedHtmlTags(mdText) {
  if (!mdText) return '';
  return mdText.replace(/<\/?(marquee|blink|script|style|iframe|object|embed|applet|font|base|form|input|button)\b([^>]*)>/gi, (match) => {
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

export async function parseMarkdownSafe(mdText) {
  const preprocessed = escapeDisallowedHtmlTags(mdText || '');
  const html = marked.parse(preprocessed);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['marquee', 'blink']
  });
}

