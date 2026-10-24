export function bringModalToFront(modal) {
  if (!modal) return;
  const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"]'));
  let maxZ = 200;
  modals.forEach(m => {
    if (!m.hidden && m !== modal) {
      const rawZ = (typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(m).zIndex : '') || m.style?.zIndex;
      const z = parseInt(rawZ, 10);
      if (!isNaN(z) && z > maxZ) maxZ = z;
    }
  });
  modal.style.zIndex = maxZ + 1;
}

try {
  if (typeof window !== 'undefined') {
    window.bringModalToFront = bringModalToFront;
  }
} catch (e) { }
