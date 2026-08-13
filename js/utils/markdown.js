import DOMPurify from 'dompurify';
import { marked } from 'marked';

export async function parseMarkdownSafe(mdText) {
  const html = marked.parse(mdText || '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
