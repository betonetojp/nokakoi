export function bringModalToFront(modal) {
  if (!modal) return;
  const modals = Array.from(document.querySelectorAll('.modal'));
  let maxZ = 200;
  modals.forEach(m => { if (!m.hidden) { const z = parseInt(window.getComputedStyle(m).zIndex, 10); if (!isNaN(z) && z > maxZ) maxZ = z; } });
  modal.style.zIndex = maxZ + 1;
  try { window.bringModalToFront = bringModalToFront; } catch (e) { }

  // iOS WebKit 等での長押しによるモーダル出現時のテキスト誤選択をプログラム上でクリア
  try {
    const clearSel = () => {
      window.getSelection()?.removeAllRanges();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    };
    clearSel();
    setTimeout(clearSel, 10);
    setTimeout(clearSel, 50);
    setTimeout(clearSel, 150);
  } catch (e) { }
}
