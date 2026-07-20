import { loadClientsMap } from './render-helpers.js';

export async function applyClientBadgeToContainer(container) {
  try {
    if (!container) return;
    const badges = container.querySelectorAll('.client-badge[data-client]');
    if (!badges || !badges.length) return;
    const map = await loadClientsMap();
    badges.forEach(b => {
      try {
        const name = b.dataset.client || '';
        const color = (map && map.get && map.get(name)) || '#9ca3af';
        b.style.color = color;
        b.style.borderColor = color;
        try {
          const kindBtn = container.querySelector('.btn-kind');
          if (kindBtn) {
            const rect = (kindBtn.getBoundingClientRect && kindBtn.getBoundingClientRect()) || {};
            const h = Math.round(rect.height) || kindBtn.offsetHeight || 20;
            b.style.height = h + 'px';
            b.style.lineHeight = (h - 2) + 'px';
            try { b.style.fontSize = window.getComputedStyle(kindBtn).fontSize || b.style.fontSize; } catch (e) { }
          }
        } catch (e) { }
        b.textContent = name;
      } catch (e) { }
    });
  } catch (e) { }
}
