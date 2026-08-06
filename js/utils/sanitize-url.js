/**
 * URL候補をサニタイズして正規化。
 * 許可スキームは http/https のみ。正規化済み絶対URL文字列または null を返す。
 * @param {string} u
 * @param {string} [baseHref] 相対URL解決用の基準（省略時は window.location.href）
 * @returns {string|null}
 */
export function sanitizeUrlCandidate(u, baseHref) {
  try {
    if (!u || typeof u !== 'string') return null;
    const trimmed = u.trim();
    if (!trimmed) return null;

    // 安全な data:image/ (Base64画像) の判定（XSSリスクのある data:text/html 等は排除。改行・空白入りの Base64 も許容）
    if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml|avif|icon|x-icon|bmp)(;[a-z0-9-]+=[a-z0-9-]+)*;base64,[\sA-Za-z0-9+/=]+$/i.test(trimmed)) {
      if (trimmed.length <= 2000000) {
        return trimmed;
      }
      return null;
    }

    if (trimmed.length > 2048) return null;
    let urlObj;
    try {
      urlObj = new URL(trimmed);
    } catch (e) {
      const base = baseHref || (typeof window !== 'undefined' ? window.location.href : undefined);
      if (!base) return null;
      try {
        urlObj = new URL(trimmed, base);
      } catch (ee) {
        return null;
      }
    }
    const proto = (urlObj.protocol || '').toLowerCase();
    if (proto === 'http:' || proto === 'https:') return urlObj.toString();
  } catch (e) { }
  return null;
}
