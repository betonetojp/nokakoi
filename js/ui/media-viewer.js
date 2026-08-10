// ============================================================================
// メディアビューア
// ============================================================================

import { $ } from '../utils/utils.js';
import { t } from '../utils/i18n.js';

/**
 * バイト数を人間が読みやすい形式にフォーマット (B, KB, MB, GB)
 */
function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${parseFloat(val.toFixed(2))} ${sizes[i] || 'B'}`;
}

/**
 * URLからファイルサイズ (バイト数) の取得を試みる
 */
async function fetchFileSize(url) {
  if (!url) return null;

  // Data URI の場合
  if (url.startsWith('data:')) {
    const commaIdx = url.indexOf(',');
    if (commaIdx !== -1) {
      const base64Data = url.slice(commaIdx + 1);
      const padding = (base64Data.endsWith('==') ? 2 : (base64Data.endsWith('=') ? 1 : 0));
      const bytes = Math.floor((base64Data.length * 3) / 4) - padding;
      return bytes > 0 ? bytes : null;
    }
    return null;
  }

  // Performance API からの取得試行 (すでに読み込み済みの場合)
  try {
    const entries = performance.getEntriesByName(url);
    if (entries && entries.length > 0) {
      const entry = entries[entries.length - 1];
      const bytes = entry.encodedBodySize || entry.decodedBodySize || entry.transferSize;
      if (bytes && bytes > 0) return bytes;
    }
  } catch (_e) { }

  // fetch (HEAD リクエスト) の試行
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        const sizeHeader = res.headers.get('content-length');
        if (sizeHeader) {
          const bytes = parseInt(sizeHeader, 10);
          if (bytes > 0) return bytes;
        }
      }
    } catch (_e) { }
  }

  return null;
}

/**
 * URLが画像か判定
 */
function isImageUrl(url) {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
  return imageExtensions.test(url);
}

/**
 * URLが動画か判定
 */
function isVideoUrl(url) {
  const videoExtensions = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
  return videoExtensions.test(url);
}

/**
 * メディアビューアモーダルを表示
 */
export function showMediaViewer(url, type = 'auto') {
  const modal = $('#mediaModal');
  const container = $('#mediaContainer');
  const title = $('#mediaTitle');
  const closeBtn = $('#mediaClose');
  const externalLink = $('#mediaOpenExternal');
  const metaInfo = $('#mediaMetaInfo');

  if (!modal || !container) return;

  const resetModal = () => {
    modal.hidden = true;
    container.innerHTML = '';
    if (metaInfo) metaInfo.textContent = '';
  };

  // 前回の内容をクリア
  container.innerHTML = '';
  if (metaInfo) metaInfo.textContent = '';

  // メディアタイプ判定
  let isImage = type === 'image' || (type === 'auto' && isImageUrl(url));
  let isVideo = type === 'video' || (type === 'auto' && isVideoUrl(url));

  if (isImage) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = t('media.image');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '70vh';
    img.style.objectFit = 'contain';

    let dimensionsText = '';
    let fileSizeText = '';

    const updateMetaText = () => {
      if (!metaInfo) return;
      const parts = [];
      if (dimensionsText) parts.push(dimensionsText);
      if (fileSizeText) parts.push(fileSizeText);
      metaInfo.textContent = parts.join(' | ');
    };

    const handleLoad = () => {
      if (img.naturalWidth && img.naturalHeight) {
        dimensionsText = `${img.naturalWidth} × ${img.naturalHeight} px`;
        updateMetaText();
      }
    };

    if (img.complete) {
      handleLoad();
    } else {
      img.onload = handleLoad;
    }

    img.onerror = function () {
      container.innerHTML = '<p class="muted">' + t('media.load_failed_image') + '</p>';
      if (metaInfo) metaInfo.textContent = '';
    };

    container.appendChild(img);
    if (title) title.textContent = t('media.image');

    // ファイルサイズの取得（非同期）
    fetchFileSize(url).then(bytes => {
      if (bytes && !modal.hidden) {
        fileSizeText = formatBytes(bytes);
        updateMetaText();
      }
    });
  } else if (isVideo) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.style.maxWidth = '100%';
    video.style.maxHeight = '70vh';
    video.onerror = function () {
      container.innerHTML = '<p class="muted">' + t('media.load_failed_video') + '</p>';
      if (metaInfo) metaInfo.textContent = '';
    };

    video.onloadedmetadata = function () {
      if (video.videoWidth && video.videoHeight) {
        if (metaInfo) metaInfo.textContent = `${video.videoWidth} × ${video.videoHeight} px`;
      }
    };

    container.appendChild(video);
    if (title) title.textContent = t('media.video');

    fetchFileSize(url).then(bytes => {
      if (bytes && !modal.hidden) {
        const sizeText = formatBytes(bytes);
        if (metaInfo) {
          const current = metaInfo.textContent;
          metaInfo.textContent = current ? `${current} | ${sizeText}` : sizeText;
        }
      }
    });
  } else {
    // その他はリンクのみ表示
    container.innerHTML = '<p class="muted">' + t('media.preview_unavailable') + '</p>';
    if (title) title.textContent = t('media.title');
    if (metaInfo) metaInfo.textContent = '';
  }

  // 外部リンク設定
  if (externalLink) {
    externalLink.href = url;
  }

  // モーダル表示
  modal.hidden = false;
  // 最前面に持ってくる
  try {
    if (window.bringModalToFront) window.bringModalToFront(modal);
    else modal.style.zIndex = 400;
  } catch (_e) { modal.style.zIndex = 400; }

  // 閉じるボタンセットアップ
  if (closeBtn) {
    closeBtn.onclick = resetModal;
  }

  // 背景クリックで閉じる
  modal.onclick = function (e) {
    if (e.target === modal) {
      resetModal();
    }
  };
}

/**
 * メディアビューアの閉じるボタンセットアップ
 */
export function setupMediaViewerClose() {
  const modal = $('#mediaModal');
  const closeBtn = $('#mediaClose');
  const container = $('#mediaContainer');
  const metaInfo = $('#mediaMetaInfo');

  if (closeBtn && modal && container) {
    closeBtn.onclick = function () {
      modal.hidden = true;
      container.innerHTML = '';
      if (metaInfo) metaInfo.textContent = '';
    };
  }
}

