// Small, dependency-free UI primitives shared by the public pages.
window.UNZI = {
  name: 'unzi',
  eyebrow: 'Public server intelligence',
  statusLabel: (present) => present ? 'Đã tham gia xếp hạng' : 'Chưa tham gia xếp hạng',
  sectionTitle: (kicker, title, copy = '') => `<div class="section-title"><span class="eyebrow">${kicker}</span><h2>${title}</h2>${copy ? `<p class="mu">${copy}</p>` : ''}</div>`,
};
