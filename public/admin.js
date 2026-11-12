/* Admin panel (nạp trước app.js; chỉ dùng helper của app.js khi được gọi) */
const ADM_TABS = [['overview', 'Tổng quan'], ['servers', 'Server'], ['ranking', 'Bảng xếp hạng'], ['appeals', 'Khiếu nại'], ['audit', 'Nhật ký'], ['settings', 'Công tắc tính năng']];
const SET_INFO = {
  leaderboard: { t: 'Bảng xếp hạng', d: 'Ai được xem toàn bộ bảng xếp hạng. "Tắt hẳn" ẩn cả tính năng: không có menu, API trả 404. Admin luôn xem được.', o: { off: 'Tắt hẳn', managers: 'Chủ server', public: 'Công khai' } },
  public_profiles: { t: 'Hồ sơ server của người khác', d: 'Xem hồ sơ của server mà mình không quản lý. Chủ server luôn xem được hồ sơ của chính mình.', o: { off: 'Tắt hẳn', managers: 'Chủ server', public: 'Công khai' } },
  show_percentile: { t: 'Hiện percentile (Top %)', d: 'Chỉ nên bật khi có từ 5 server trở lên để so sánh có ý nghĩa.', o: { off: 'Ẩn', on: 'Hiện' } },
};
let AG = [], ADRAW = null;

async function admin(tab = 'overview') {
  view(`<div class="ph in"><h1>Quản trị hệ thống</h1></div><div class="tabs">${ADM_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="at"></div>`);
  const f = { overview: admOverview, servers: admServers, ranking: admRanking, appeals: admAppeals, audit: admAudit, settings: admSettings }[tab] || admOverview;
  await f();
}

async function admOverview() {
  const d = await api('/admin/overview'), j = d.job, hb = d.hb ? Math.round((Date.now() - new Date(d.hb)) / 60000) : null;
  const tl = (n, l, c) => `<div class="g tl"><b class="num" data-n="${n}" data-d="0"${c ? ` style="color:var(--${c})"` : ''}>0</b><span>${l}</span></div>`;
  $('#at').innerHTML = `<div class="tls">${tl(d.total, 'Server có bot')}${tl(d.tracking, 'Đang thu thập', 'wel')}${tl(d.blocked, 'Bị khóa', 'bad')}${tl(d.hidden, 'Ẩn khỏi bảng xếp hạng')}${tl(d.review, 'Cần xem xét', 'bad')}${tl(d.events24h, 'Sự kiện 24 giờ')}${tl(d.appeals, 'Khiếu nại đang chờ', 'act')}</div>
  <h2>Hệ thống</h2><div class="g"><div class="mini" style="flex-wrap:wrap"><span>Bot báo cáo lần cuối <b>${hb == null ? '—' : hb + ' phút trước'}</b></span>
   <span>Job tính điểm <b>${j.running ? 'đang chạy' : j.lastEnd ? new Date(j.lastEnd).toLocaleString('vi-VN') : 'chưa chạy'}</b></span><span>Thời gian <b>${j.lastMs != null ? (j.lastMs / 1000).toFixed(1) + ' giây' : '—'}</b></span><span>Server đã tính <b>${j.guilds}</b></span><span>Lỗi <b>${j.errors}</b></span></div>
   ${j.lastError ? `<div class="warn">${esc(j.lastError)}</div>` : ''}<div class="acl"><button class="btn" id="rj">Chạy tính điểm ngay</button></div></div>
  <h2>Toàn hệ thống theo ngày</h2><div class="g cb" id="sc"></div>`;
  countUp();
  $('#rj').onclick = async () => { await post('/admin/jobs/run'); $('#rj').textContent = 'Đang chạy...'; setTimeout(admOverview, 2500); };
  const S = d.series;
  if (S.length) chart($('#sc'), 'Tổng hoạt động các server', S.map((x) => String(x.day).slice(0, 10)), [
    { k: 'm', n: 'Tin nhắn', c: 'var(--s3)', v: S.map((x) => +x.messages) }, { k: 'a', n: 'Lượt người hoạt động', c: 'var(--s2)', v: S.map((x) => +x.active) },
    { k: 'j', n: 'Vào server', c: 'var(--s6)', on: false, v: S.map((x) => +x.joins) }, { k: 'l', n: 'Rời server', c: 'var(--s1)', on: false, v: S.map((x) => +x.leaves) }], { norm: true });
  else $('#sc').innerHTML = '<p class="mu">Chưa có dữ liệu theo ngày.</p>';
}

const gst = (g) => (!g.bot_present ? '<span class="chip">Đã gỡ bot</span>' : g.blocked ? '<span class="chip blocked">Khóa</span>' : '<span class="chip on">Đang thu thập</span>')
  + (g.hidden ? '<span class="chip">Ẩn BXH</span>' : '') + (g.status === 'review' ? chip('review') : '');

async function admServers() {
  AG = await api('/admin/guilds');
  $('#at').innerHTML = `<div class="acl"><input type="search" id="q" placeholder="Tìm theo tên hoặc ID" style="min-width:240px"><select id="f"><option value="">Tất cả</option><option value="tracking">Đang thu thập</option><option value="blocked">Bị khóa</option><option value="hidden">Ẩn khỏi BXH</option><option value="review">Cần xem xét</option><option value="nobot">Đã gỡ bot</option></select></div><div class="g tw" id="tbl"></div>`;
  ADRAW = () => {
    const q = $('#q').value.trim().toLowerCase(), f = $('#f').value;
    const rows = AG.filter((g) => (!q || g.name.toLowerCase().includes(q) || g.id.includes(q)) && (!f || (f === 'tracking' ? g.bot_present && g.enabled && !g.blocked : f === 'blocked' ? g.blocked : f === 'hidden' ? g.hidden : f === 'review' ? g.status === 'review' : !g.bot_present)));
    $('#tbl').innerHTML = rows.length ? `<table class="tb"><thead><tr><th>Server</th><th>Trạng thái</th><th>Tổng hợp</th><th>Hoạt động</th><th>Đón mới</th><th>Tin cậy</th><th>Tính lúc</th></tr></thead><tbody>${rows.map((g) => `<tr class="cl" data-id="${esc(g.id)}">
      <td><div class="nm">${icon(g)}<b>${esc(g.name)}</b></div></td><td>${gst(g)}</td><td>${num(g.overall ?? g.activity)}</td><td>${num(g.activity)}</td><td>${num(g.welcoming)}</td><td>${num(g.confidence, 0)}</td><td class="mu">${g.computed_at ? new Date(g.computed_at).toLocaleString('vi-VN') : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="mu">Không có server phù hợp.</p>';
  };
  $('#q').oninput = $('#f').onchange = ADRAW; ADRAW();
  $('#tbl').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) admDlg(tr.dataset.id); };
}

function admDlg(id) {
  const g = AG.find((x) => x.id === id);
  let dl = $('#dlg'); if (!dl) { dl = document.createElement('dialog'); dl.id = 'dlg'; document.body.appendChild(dl); }
  dl.innerHTML = `<div class="nm">${icon(g, 1)}<div><h2 style="margin:0">${esc(g.name)}</h2><span class="mu">${esc(g.id)}</span></div></div>
   <div class="mini" style="margin:14px 0 6px;flex-wrap:wrap"><span>Tổng hợp <b>${num(g.overall ?? g.activity)}</b></span><span>Hoạt động <b>${num(g.activity)}</b></span><span>Đón <b>${num(g.welcoming)}</b></span><span>Tin cậy <b>${num(g.confidence, 0)}</b></span><span>Điều chỉnh <b>${num(g.adjustment, 1)}</b></span><span>Percentile <b>${num(g.percentile, 0)}</b></span></div><div>${gst(g)}</div>
   <div class="acl"><button class="btn sm" data-a="hide">${g.hidden ? 'Hiện lại ở bảng xếp hạng' : 'Ẩn khỏi bảng xếp hạng'}</button>
   <button class="btn sm d" data-a="block">${g.blocked ? 'Mở khóa' : 'Khóa server (bot rời đi)'}</button><button class="btn sm" data-a="recompute">Tính lại điểm</button></div>
   <div class="g score-adjust"><b>Điều chỉnh điểm thủ công</b><p class="mu">Cộng hoặc trừ tối đa 25 điểm, dùng cho xử lý minh bạch của admin.</p><input type="number" id="sd" min="-25" max="25" step="0.5" placeholder="+5 hoặc -5"><input type="text" id="sr" maxlength="500" placeholder="Lý do điều chỉnh"><button class="btn sm" data-a="adjust">Áp dụng điều chỉnh</button></div>
   <form id="df"><label>Ghi chú nội bộ (chỉ admin thấy)</label><textarea name="admin_note" rows="2" maxlength="500">${esc(g.admin_note)}</textarea><label>Mô tả công khai</label><textarea name="description" rows="2" maxlength="500">${esc(g.description)}</textarea>
   <label>Link mời</label><input type="text" name="invite_url" value="${esc(g.invite_url)}"><div class="acl"><button class="btn p" type="submit">Lưu</button><a class="btn" href="#/server/${esc(g.id)}" id="vw">Xem hồ sơ</a><button class="btn" type="button" id="cl">Đóng</button></div><p class="mu" id="dm" role="status"></p></form>`;
  if (!dl.open) dl.showModal();
  const reload = async () => { AG = await api('/admin/guilds'); ADRAW && ADRAW(); admDlg(id); };
  $('#cl').onclick = () => dl.close(); $('#vw').onclick = () => dl.close();
  $('#df').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target);
    try { await patch(`/admin/guilds/${id}`, { admin_note: f.get('admin_note'), description: f.get('description'), invite_url: f.get('invite_url') }); await reload(); $('#dm').textContent = 'Đã lưu.'; } catch { $('#dm').textContent = 'Không lưu được (kiểm tra link mời).'; } };
  dl.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    try {
      if (a === 'hide') await patch(`/admin/guilds/${id}`, { hidden: !g.hidden });
      else if (a === 'block') { if (!g.blocked && !confirm('Khóa server: dừng thu thập và bot sẽ tự rời server này. Tiếp tục?')) return; await patch(`/admin/guilds/${id}`, { blocked: !g.blocked }); }
      else if (a === 'recompute') await post(`/admin/guilds/${id}/recompute`);
      else if (a === 'adjust') await post(`/admin/guilds/${id}/adjust-score`, { delta: Number($('#sd').value), reason: $('#sr').value });
      await reload();
    } catch { $('#dm').textContent = 'Thao tác thất bại (server có thể chưa được theo dõi).'; }
  };
}

async function admRanking() {
  const [d, ov] = await Promise.all([api('/admin/guilds'), api('/admin/overview')]); AG = d;
  const mode = { off: 'Tắt hẳn (chỉ admin thấy)', managers: 'Chỉ chủ server', public: 'Công khai' }[ov.settings.leaderboard];
  const rows = AG.filter((g) => g.bot_present && g.enabled && !g.blocked && g.status && g.status !== 'collecting' && (g.overall != null || g.activity != null)).sort((a, b) => (b.status === 'ranked') - (a.status === 'ranked'));
  let n = 0;
  $('#at').innerHTML = `<p class="mu">Người dùng hiện thấy bảng xếp hạng ở chế độ: <b style="color:var(--tx)">${mode}</b> · <a href="#/admin/settings" style="text-decoration:underline">đổi</a>. Đây là bảng đầy đủ, admin luôn xem được. Server bị ẩn hoặc đang "kiểm tra" không có thứ hạng.</p>
  <div class="g tw">${rows.length ? `<table class="tb"><thead><tr><th>#</th><th>Server</th><th>Tổng hợp</th><th>Hoạt động</th><th>Đón mới</th><th>Tin cậy</th><th>Top %</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rows.map((g) => `<tr><td>${g.hidden || g.status === 'review' ? '—' : ++n}</td>
   <td><div class="nm">${icon(g)}<b>${esc(g.name)}</b></div></td><td>${num(g.overall ?? g.activity)}</td><td>${num(g.activity)}</td><td>${num(g.welcoming)}</td><td>${num(g.confidence, 0)}</td><td>${g.percentile != null ? Math.max(1, Math.round(100 - g.percentile)) + '%' : '—'}</td><td>${chip(g.status)}${g.hidden ? '<span class="chip">Ẩn</span>' : ''}</td>
   <td style="white-space:nowrap"><button class="btn sm" data-h="${esc(g.id)}">${g.hidden ? 'Hiện' : 'Ẩn'}</button> <button class="btn sm" data-m="${esc(g.id)}">Quản lý</button></td></tr>`).join('')}</tbody></table>` : '<p class="mu">Chưa có server nào có điểm.</p>'}</div>`;
  ADRAW = null;
  $('#at').onclick = async (e) => {
    const h = e.target.closest('[data-h]'), m = e.target.closest('[data-m]');
    if (h) { const g = AG.find((x) => x.id === h.dataset.h); await patch(`/admin/guilds/${g.id}`, { hidden: !g.hidden }); admRanking(); }
    if (m) { ADRAW = () => admRanking(); admDlg(m.dataset.m); }
  };
}

async function admAppeals() {
  const a = await api('/admin/appeals');
  $('#at').innerHTML = a.length ? a.map((x) => `<div class="g cb"><div class="nm" style="flex-wrap:wrap"><b>${esc(x.name || x.guild_id)}</b>${x.status === 'open' ? '<span class="chip provisional">Đang chờ</span>' : `<span class="chip">${x.status === 'resolved' ? 'Đã xử lý' : 'Từ chối'}</span>`}<span class="mu">${new Date(x.created_at).toLocaleString('vi-VN')}</span></div>
   <p>${esc(x.message)}</p>${x.status === 'open' ? `<textarea data-r="${x.id}" rows="2" placeholder="Phản hồi cho chủ server"></textarea><div class="acl"><button class="btn p sm" data-s="resolved" data-id="${x.id}">Đã xử lý</button><button class="btn sm d" data-s="rejected" data-id="${x.id}">Từ chối</button><a class="btn sm" href="#/server/${esc(x.guild_id)}">Xem hồ sơ</a></div>` : `<p class="mu">Phản hồi: ${esc(x.admin_reply || '—')}</p>`}</div>`).join('') : '<p class="mu">Không có khiếu nại.</p>';
  $('#at').onclick = async (e) => { const b = e.target.closest('[data-s]'); if (!b) return; await post(`/admin/appeals/${b.dataset.id}`, { status: b.dataset.s, reply: $(`[data-r="${b.dataset.id}"]`).value }); admAppeals(); };
}

async function admAudit() {
  const a = await api('/admin/audit');
  $('#at').innerHTML = `<div class="g tw"><table class="tb"><thead><tr><th>Thời gian</th><th>Hành động</th><th>Server</th><th>Người thực hiện</th><th>Chi tiết</th></tr></thead><tbody>${a.map((x) => `<tr><td class="mu">${new Date(x.created_at).toLocaleString('vi-VN')}</td><td><b>${esc(x.action)}</b></td><td>${esc(x.name || x.guild_id || '—')}</td><td class="mu">${esc(x.actor_id || '—')}</td><td class="mu">${esc(x.meta ? JSON.stringify(x.meta).slice(0, 90) : '')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function admSettings() {
  let S = (await api('/admin/overview')).settings;
  const draw = () => { $('#at').innerHTML = Object.entries(SET_INFO).map(([k, i]) => `<div class="row2"><div><b>${i.t}</b><p class="mu" style="margin:4px 0 0">${i.d}</p></div><div class="st">${Object.entries(i.o).map(([v, l]) => `<button data-k="${k}" data-v="${v}" class="${S[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')
    + '<p class="mu" style="margin-top:20px">Admin không có công cụ sửa điểm số trực tiếp: chỉ có thể tính lại từ dữ liệu gốc, ẩn khỏi bảng xếp hạng hoặc khóa server. Mọi thao tác đều ghi vào nhật ký.</p>'; };
  draw();
  $('#at').onclick = async (e) => { const b = e.target.closest('[data-k]'); if (!b) return; S = await put('/admin/settings', { k: b.dataset.k, v: b.dataset.v }); draw(); };
}
