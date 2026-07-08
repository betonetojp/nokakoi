// ============================================================================
// メディアビューア
// ============================================================================

import { $ } from './utils.js';
import { t } from './i18n.js';

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

  if (!modal || !container) return;

  // 前回の内容をクリア
  container.innerHTML = '';

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
    img.onerror = function () {
      container.innerHTML = '<p class="muted">' + t('media.load_failed_image') + '</p>';
    };
    container.appendChild(img);
    if (title) title.textContent = t('media.image');
  } else if (isVideo) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.style.maxWidth = '100%';
    video.style.maxHeight = '70vh';
    video.onerror = function () {
      container.innerHTML = '<p class="muted">' + t('media.load_failed_video') + '</p>';
    };
    container.appendChild(video);
    if (title) title.textContent = t('media.video');
  } else {
    // その他はリンクのみ表示
    container.innerHTML = '<p class="muted">' + t('media.preview_unavailable') + '</p>';
    if (title) title.textContent = t('media.title');
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
  } catch (e) { modal.style.zIndex = 400; }

  // 閉じるボタンセットアップ
  if (closeBtn) {
    closeBtn.onclick = function () {
      modal.hidden = true;
      container.innerHTML = '';
    };
  }

  // 背景クリックで閉じる
  modal.onclick = function (e) {
    if (e.target === modal) {
      modal.hidden = true;
      container.innerHTML = '';
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

  if (closeBtn && modal && container) {
    closeBtn.onclick = function () {
      modal.hidden = true;
      container.innerHTML = '';
    };
  }
}
