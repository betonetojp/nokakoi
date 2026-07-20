export function bringModalToFront(modal) {
  if (!modal) return;
  const modals = Array.from(document.querySelectorAll('.modal'));
  let maxZ = 200;
  modals.forEach(m => { if (!m.hidden) { const z = parseInt(window.getComputedStyle(m).zIndex, 10); if (!isNaN(z) && z > maxZ) maxZ = z; } });
  modal.style.zIndex = maxZ + 1;
  try { window.bringModalToFront = bringModalToFront; } catch (e) { }
}
