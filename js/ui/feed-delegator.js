// js/ui/feed-delegator.js

import { reactToEvent, repostEvent } from '../features/post/actions.js';
import { setReplyTarget } from '../features/post/composer.js';
import { setSelectedEventEl } from './keyboard-shortcuts.js';
import { getReactionContent } from '../utils/utils.js';
import { applyReactionToButton } from './renderer.js';
import { findEventById } from '../core/state.js';
import { getNip19 } from '../core/nostr-compat.js';
import { t } from '../utils/i18n.js';

/**
 * タイムライン要素（いいね・返信・リポストなど）のイベント委譲処理をセットアップする
 */
export function setupDelegatedFeedHandlers(state, settingsManager, feedsContainer) {
  const settings = settingsManager.settings;
  const nip19 = getNip19();
  const touchTimers = new Map();
  
  const eventListContainers = [
    feedsContainer, 
    document.getElementById('profileEvents')
  ].filter(Boolean);

  if (!eventListContainers.length) return;

  eventListContainers.forEach((container) => {
    // クリックイベントの委譲
    container.addEventListener('click', async (e) => {
      try {
        const reactBtn = e.target.closest && e.target.closest('.btn-react');
        if (reactBtn) {
          // ボタン固有のリスナーがある場合は二重送信防止のためスキップ
          try { if (reactBtn.dataset && reactBtn.dataset.listenerInstalled === '1') return; } catch (ee) { }
          e.preventDefault();
          const evEl = reactBtn.closest && reactBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const ev = findEventById(state, eventId);
          if (!ev) return;

          // 修飾キー付きクリック時はカスタムリアクションモーダルを開く
          if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) {
            import('./modals/modals.js').then(m => {
              try {
                const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+';
                const runReactOnce = async (symbol) => {
                  await reactToEvent(state, ev, symbol);
                  settingsManager.saveUserReaction(ev.id, symbol);
                  const reactionDisplay = getReactionContent(symbol) || '+';
                  try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
                  try { 
                    reactBtn.dataset.reacted = 'true'; 
                    reactBtn.dataset.reactionDisplay = reactionDisplay; 
                    reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); 
                  } catch (ee) { }
                };
                m.showReactionModal(nowDefault, (symbol) => {
                  settingsManager.set('reactionDefault', symbol);
                  try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
                }, settingsManager, {
                  showReactActions: true,
                  onSaveAndReact: runReactOnce,
                  onReactOnly: runReactOnce
                });
              } catch (ee) { }
            }).catch(() => { });
          } else {
            // 通常の既定リアクション
            const reactionSym = settingsManager.get('reactionDefault') || settings.reactionDefault || '+';
            await reactToEvent(state, ev, reactionSym);
            settingsManager.saveUserReaction(ev.id, reactionSym);
            const reactionDisplay = getReactionContent(reactionSym) || '+';
            try { applyReactionToButton(reactBtn, reactionSym); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
            try { 
              reactBtn.dataset.reacted = 'true'; 
              reactBtn.dataset.reactionDisplay = reactionDisplay; 
              reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); 
            } catch (ee) { }
          }
          return;
        }

        // 返信ボタン
        const replyBtn = e.target.closest && e.target.closest('.btn-reply');
        if (replyBtn) {
          e.preventDefault();
          const evEl = replyBtn.closest && replyBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const ev = findEventById(state, eventId);
          if (!ev) return;
          setReplyTarget(state, ev, nip19);
          return;
        }

        // リポストボタン
        const repostBtn = e.target.closest && e.target.closest('.btn-repost');
        if (repostBtn) {
          e.preventDefault();
          const evEl = repostBtn.closest && repostBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const ev = findEventById(state, eventId);
          if (!ev) return;
          
          // リポストの確認と処理
          import('./modals/modals.js').then(m => {
            try {
              m.showConfirmModal(t('repost.confirm.title'), t('repost.confirm.message'), async () => {
                try {
                  repostBtn.disabled = true;
                  const success = await repostEvent(state, ev);
                  if (success) {
                    repostBtn.innerHTML = '✓';
                    setTimeout(() => { 
                      try { 
                        repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">'; 
                        repostBtn.disabled = false; 
                      } catch (e) { } 
                    }, 3000);
                  } else {
                    try { 
                      repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">'; 
                      repostBtn.disabled = false; 
                    } catch (e) { }
                  }
                } catch (e) { try { repostBtn.disabled = false; } catch (ee) { } }
              }, () => { });
            } catch (e) { }
          }).catch(() => { });
          return;
        }

        // 投稿クリックによる選択状態切り替え
        const clickedEvent = e.target.closest && e.target.closest('.event');
        if (clickedEvent) {
          setSelectedEventEl(clickedEvent);
        }
      } catch (e) { }
    }, false);

    // 右クリック（コンテキストメニュー）でのリアクション既定値変更モーダルの表示
    container.addEventListener('contextmenu', (e) => {
      try {
        const reactBtn = e.target.closest && e.target.closest('.btn-react');
        if (!reactBtn) return;
        e.preventDefault();
        const evEl = reactBtn.closest && reactBtn.closest('.event');
        const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
        if (!eventId) return;
        const ev = findEventById(state, eventId);
        if (!ev) return;
        
        import('./modals/modals.js').then(m => {
          try {
            const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+';
            const runReactOnce = async (symbol) => {
              const ok = await reactToEvent(state, ev, symbol);
              if (!ok) throw new Error('react_failed');
              settingsManager.saveUserReaction(ev.id, symbol);
              const reactionDisplay = getReactionContent(symbol) || '+';
              try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
              try { 
                reactBtn.dataset.reacted = 'true'; 
                reactBtn.dataset.reactionDisplay = reactionDisplay; 
                reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); 
              } catch (ee) { }
            };
            m.showReactionModal(nowDefault, (symbol) => {
              settingsManager.set('reactionDefault', symbol);
              try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
            }, settingsManager, {
              showReactActions: true,
              onSaveAndReact: runReactOnce,
              onReactOnly: runReactOnce
            });
          } catch (e) { }
        }).catch(() => { });
      } catch (e) { }
    }, false);

    // モバイル長押しでのリアクション既定値変更モーダルの表示
    container.addEventListener('touchstart', (e) => {
      try {
        const reactBtn = e.target.closest && e.target.closest('.btn-react');
        if (!reactBtn) return;
        const evEl = reactBtn.closest && reactBtn.closest('.event');
        const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
        if (!eventId) return;
        const ev = findEventById(state, eventId);
        if (!ev) return;
        
        const tId = eventId + '::longpress';
        if (touchTimers.has(tId)) try { clearTimeout(touchTimers.get(tId)); } catch (e) { }
        const to = setTimeout(() => {
          try {
            import('./modals/modals.js').then(m => {
              try {
                const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+';
                const runReactOnce = async (symbol) => {
                  const ok = await reactToEvent(state, ev, symbol);
                  if (!ok) throw new Error('react_failed');
                  settingsManager.saveUserReaction(ev.id, symbol);
                  const reactionDisplay = getReactionContent(symbol) || '+';
                  try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
                  try { 
                    reactBtn.dataset.reacted = 'true'; 
                    reactBtn.dataset.reactionDisplay = reactionDisplay; 
                    reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); 
                  } catch (ee) { }
                };
                m.showReactionModal(nowDefault, (symbol) => {
                  settingsManager.set('reactionDefault', symbol);
                  try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
                }, settingsManager, {
                  showReactActions: true,
                  onSaveAndReact: runReactOnce,
                  onReactOnly: runReactOnce
                });
              } catch (e) { }
            }).catch(() => { });
          } catch (e) { }
        }, 600);
        touchTimers.set(tId, to);
      } catch (e) { }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      try {
        const reactBtn = e.target.closest && e.target.closest('.btn-react');
        if (!reactBtn) return;
        const evEl = reactBtn.closest && reactBtn.closest('.event');
        const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
        if (!eventId) return;
        const tId = eventId + '::longpress';
        const to = touchTimers.get(tId);
        if (to) { clearTimeout(to); touchTimers.delete(tId); }
      } catch (e) { }
    }, { passive: true });
  });
}
