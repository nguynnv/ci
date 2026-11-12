// Dashboard-specific presentation helpers. Data fetching remains in app.js.
window.UNZI = window.UNZI || {};
window.UNZI.serverState = (guild) => guild.blocked
  ? '<span class="chip blocked">Bị khóa</span>'
  : '<span class="chip on">Đang tham gia xếp hạng</span>';
