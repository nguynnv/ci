/* ===== helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
  .then((r) => { if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status }); return r.json(); });
const post = (p, b) => api(p, { method: 'POST', body: b || {} }), patch = (p, b) => api(p, { method: 'PATCH', body: b }), put = (p, b) => api(p, { method: 'PUT', body: b });
const num = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
let FT = {};
const view = (h) => { $('#v').innerHTML = h; scrollTo(0, 0); countUp(); };
const ST = { collecting: 'Đang thu thập', provisional: 'Tạm thời', ranked: 'Đã xếp hạng', limited: 'Dữ liệu hạn chế', review: 'Đang kiểm tra' };
const LA = { U: 'Người tham gia', F: 'Tần suất trò chuyện', Q: 'Chất lượng tương tác', C: 'Độ đều đặn', D: 'Đa dạng tương tác', T: 'Phân bố giờ và kênh' };
const LW = { R: 'Người mới được phản hồi', F: 'Tốc độ phản hồi đầu tiên', C: 'Trao đổi hai chiều', D7: 'Còn hoạt động sau 7 ngày', D: 'Số người đón tiếp khác nhau', V: 'Độ phủ dữ liệu' };
const chip = (st) => `<span class="chip ${esc(st)}">${ST[st] || esc(st)}</span>`;
const icon = (g, lg) => (g.icon ? `<img class="av${lg ? ' lg' : ''}" alt="" src="https://cdn.discordapp.com/icons/${esc(g.id)}/${esc(g.icon)}.png?size=128">` : `<span class="av${lg ? ' lg' : ''}"></span>`);
const fmt = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Number.isInteger(+v) ? v : (+v).toFixed(1));
const niceMax = (m) => { const p = 10 ** Math.floor(Math.log10(m)), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

function countUp() {
  document.querySelectorAll('[data-n]').forEach((el) => {
    const t = parseFloat(el.dataset.n), dec = +(el.dataset.d ?? 1);
    if (isNaN(t)) return;
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { el.textContent = t.toFixed(dec); return; }
    const t0 = performance.now();
    const f = (now) => { const p = Math.min(1, (now - t0) / 1000); el.textContent = (t * (1 - (1 - p) ** 3)).toFixed(dec); if (p < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
}

/* ===== biểu đồ ===== */
const ring = (v, c) => `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="42"/><circle class="fg" cx="50" cy="50" r="42" style="--c:var(--${c});--off:${264 * (1 - (v == null ? 0 : v) / 100)}"/></svg>`;
const pbar = (v, c, low) => `<div class="pb${low ? ' low' : ''}" style="--c:var(--${c})"><i style="width:${Math.min(100, v)}%"></i></div>`;

// Biểu đồ cột: số tin nhắn theo giờ trong ngày (quy đổi UTC → giờ máy bạn)
function hourBars(heat) {
  const off = Math.round(-new Date().getTimezoneOffset() / 60), h = Array(24).fill(0);
  heat.forEach((r) => r.forEach((v, i) => { h[(((i + off) % 24) + 24) % 24] += v; }));
  const mx = Math.max(...h, 1), tot = h.reduce((a, x) => a + x, 0), pk = h.indexOf(mx);
  if (!tot) return '<p class="mu">Chưa có dữ liệu.</p>';
  return `<div class="hb">${h.map((v, i) => `<div class="col${i === pk ? ' pk' : ''}" title="${i}h: ${v} tin"><i style="--h:${((v / mx) * 100).toFixed(1)}%;--i:${i}"></i><span>${i % 3 === 0 ? i : ''}</span></div>`).join('')}</div>
  <p class="mu" style="margin:10px 0 0">Cao điểm: <b style="color:var(--act)">${pk}h–${(pk + 1) % 24}h</b> theo giờ máy bạn · ${tot} tin nhắn trong 30 ngày</p>`;
}

// Biểu đồ lục giác (radar): ax = [{l, v}], avg = mảng trung bình các server hoặc null
function radar(ax, avg) {
  const cx = 160, cy = 150, R = 100, n = ax.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = (f) => ax.map((_, i) => pt(i, R * f(i)).map((x) => x.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon class="rg" points="${poly(() => k)}"/>`).join('');
  const spokes = ax.map((_, i) => { const [x, y] = pt(i, R); return `<line class="rg" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const labels = ax.map((a, i) => { const [x, y] = pt(i, R + 22), an = Math.abs(x - cx) < 5 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + (i === 0 ? -4 : 4)).toFixed(1)}" text-anchor="${an}">${a.l}<tspan class="v" x="${x.toFixed(1)}" dy="14">${a.v == null ? '—' : Math.round(a.v)}</tspan></text>`; }).join('');
  const dots = ax.map((a, i) => { if (a.v == null) return ''; const [x, y] = pt(i, (R * a.v) / 100); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"><title>${a.l}: ${num(a.v)}</title></circle>`; }).join('');
  return `<svg class="rd" viewBox="-50 0 420 305" role="img" aria-label="Biểu đồ lục giác các chỉ số">${rings}${spokes}
    ${avg ? `<polygon class="pa" points="${poly((i) => (avg[i] || 0) / 100)}"/>` : ''}<polygon class="pg" points="${poly((i) => (ax[i].v || 0) / 100)}"/>${dots}${labels}</svg>
    <div class="lgd"><span style="color:var(--ovr)">━ Server này</span>${avg ? '<span>┅ Trung bình các server</span>' : ''}</div>`;
}

// Biểu đồ đường tương tác: bật/tắt đường, chọn 7/30/90 ngày, chuẩn hóa, crosshair + tooltip
function chart(box, title, X, S, o = {}) {
  const st = { on: new Set(S.filter((s) => s.on !== false).map((s) => s.k)), range: 30, norm: !!o.norm, first: true };
  const W = 720, H = 250, L = 44, RR = 12, T = 12, B = 26;
  function draw() {
    const n = Math.min(st.range, X.length), xs = X.slice(-n);
    const vis = S.filter((s) => st.on.has(s.k)).map((s) => ({ ...s, v: s.v.slice(-n) }));
    const smax = (s) => Math.max(1, ...s.v.filter((x) => x != null));
    const mx = o.max || (st.norm ? 100 : niceMax(Math.max(1, ...vis.map(smax))));
    const xv = (i) => L + (n < 2 ? (W - L - RR) / 2 : (i * (W - L - RR)) / (n - 1)), yv = (v) => T + (H - T - B) * (1 - v / mx);
    const val = (s, v) => (st.norm ? (v / smax(s)) * 100 : v);
    const path = (s) => { let d = '', pen = false; s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${xv(i).toFixed(1)},${yv(val(s, v)).toFixed(1)}`; pen = true; }); return d; };
    const grid = [0, 1, 2, 3, 4].map((k) => { const y = yv((mx * k) / 4).toFixed(1); return `<line class="gd" x1="${L}" x2="${W - RR}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${+y + 3}" text-anchor="end">${fmt((mx * k) / 4)}${st.norm ? '%' : ''}</text>`; }).join('');
    const xl = [0, 1, 2, 3, 4].map((k) => { const i = n < 2 ? 0 : Math.round((k * (n - 1)) / 4); return `<text x="${xv(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${xs[i].slice(5)}</text>`; }).join('');
    const lines = vis.map((s) => { const last = s.v.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
      return `<path class="ln${st.first && !s.dash ? ' dr' : ''}" pathLength="1" d="${path(s)}" style="stroke:${s.c}"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>${last != null ? `<circle cx="${xv(last).toFixed(1)}" cy="${yv(val(s, s.v[last])).toFixed(1)}" r="3.5" style="fill:${s.c}"/>` : ''}`; }).join('');
    box.innerHTML = `<div class="ch-h"><h3>${title}</h3><div class="seg">${[7, 30, 90].map((r) => `<button data-r="${r}" class="${st.range === r ? 'on' : ''}">${r} ngày</button>`).join('')}</div></div>
      <div class="lgx">${S.map((s) => `<button data-k="${s.k}" class="${st.on.has(s.k) ? '' : 'off'}" style="--c:${s.c}"><i></i>${s.n}</button>`).join('')}${o.norm ? `<label><input type="checkbox" data-norm ${st.norm ? 'checked' : ''}> Chuẩn hóa từng đường</label>` : ''}</div>
      <div class="cw"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${grid}${xl}${lines}<line class="xh" y1="${T}" y2="${H - B}" x1="0" x2="0"/></svg><div class="tp"></div></div>`;
    const svg = $('svg', box), xh = $('.xh', box), tp = $('.tp', box);
    svg.onpointermove = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, n < 2 ? 0 : Math.round((px - L) / ((W - L - RR) / (n - 1)))));
      xh.setAttribute('x1', xv(i)); xh.setAttribute('x2', xv(i)); xh.style.opacity = 1;
      tp.innerHTML = `<span class="d">${xs[i]}</span>` + vis.map((s) => `<div><i style="background:${s.c}"></i>${s.n}<b>${s.v[i] == null ? '—' : fmt(s.v[i])}</b></div>`).join('');
      const left = (xv(i) / W) * 100; tp.style.opacity = 1;
      tp.style.left = left > 60 ? 'auto' : `calc(${left}% + 12px)`; tp.style.right = left > 60 ? `calc(${100 - left}% + 12px)` : 'auto';
    };
    svg.onpointerleave = () => { xh.style.opacity = 0; tp.style.opacity = 0; };
  }
  box.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) st.range = +b.dataset.r; else if (b.dataset.k) { st.on.has(b.dataset.k) ? st.on.delete(b.dataset.k) : st.on.add(b.dataset.k); } else return;
    st.first = false; draw();
  };
  box.onchange = (e) => { if (e.target.dataset.norm !== undefined) { st.norm = e.target.checked; st.first = false; draw(); } };
  draw();
}

/* ===== gợi ý cho chủ server (luật đơn giản từ số liệu) ===== */
function recs(d) {
  const s = d.score, r = [], add = (t, bad) => r.push(`<div class="rec${bad ? ' bad' : ''}">${t}</div>`);
  if (!s) return '<div class="rec">Chưa có điểm. Bot cần thu thập dữ liệu, lần tính đầu tiên chạy trong tối đa 1 giờ.</div>';
  const w = s.welcome, rw = s.raw;
  if (s.status === 'collecting') add('Server còn mới (dưới 7 ngày dữ liệu): điểm sẽ ổn định dần theo thời gian.');
  if (rw && (rw.mam < 10 || rw.messages < 100)) add(`Chưa đủ dữ liệu để tính điểm hoạt động (cần ≥10 người và ≥100 tin trong 30 ngày, hiện có ${rw.mam} người, ${rw.messages} tin).`);
  if (rw?.topMemberShare > 50) add(`Một thành viên tạo ${rw.topMemberShare}% tin nhắn: hoạt động đang phụ thuộc vào rất ít người.`);
  if (w.eligibleNew >= 10) {
    if (w.responseRate < 60) add(`Chỉ ${w.responseRate}% người mới được phản hồi trong 7 ngày đầu. Thử lập kênh chào mừng và nhờ moderator hoặc thành viên cũ trả lời.`, true);
    if (w.medianMin > 120) add(`Người mới chờ trung vị ${Math.round(w.medianMin)} phút mới được phản hồi lần đầu. Mục tiêu hợp lý: dưới 60 phút.`);
    if (w.d7Rate < 20) add(`Chỉ ${w.d7Rate}% người mới còn hoạt động ở ngày 6–8 (chỉ là tương quan, chưa chắc do cách đón tiếp).`);
  } else add(`Mới có ${w.eligibleNew} người mới đủ điều kiện (cần ≥10) nên điểm Đón người mới chưa hiển thị.`);
  const ch = d.channels?.[0];
  if (ch && ch.share > 70) add(`Kênh #${esc(ch.name)} chiếm ${ch.share}% hoạt động; các kênh khác gần như im lặng.`);
  if (s.components.activity.C != null && s.components.activity.C < 40) add('Số người hoạt động dao động mạnh giữa các ngày. Sự kiện định kỳ có thể giúp ổn định.');
  if (s.flags?.includes('spike')) add('Phát hiện đột biến hoạt động so với các ngày trước. Trạng thái tạm chuyển sang "đang kiểm tra" và ẩn percentile. Đây chưa phải kết luận gian lận.', true);
  if (s.coverage < 70) add(`Độ phủ dữ liệu chỉ ${s.coverage}%: kiểm tra bot có online và có quyền View Channel ở các kênh cần đo.`, true);
  const h = d.history.filter((x) => x.overall != null || x.activity != null), a = h.at(-1), b = h.at(-8);
  if (a && b) { const df = (a.overall ?? a.activity) - (b.overall ?? b.activity); if (Math.abs(df) >= 5) add(`Điểm ${df > 0 ? 'tăng' : 'giảm'} ${Math.abs(df).toFixed(1)} so với 7 ngày trước.`, df < 0); }
  return r.join('') || '<p class="mu">Không có gợi ý đặc biệt: các chỉ số đang ổn.</p>';
}

/* ===== trang ===== */
function nav() {
  const u = FT.user, h = location.hash || '#/', on = (p) => (h === p || h.startsWith(p + '/') ? 'on' : '');
  $('#nav').innerHTML = `<b class="brand">unzi <small>server intelligence</small></b><a href="#/" class="${h === '#/' ? 'on' : ''}">Trang chủ</a>${FT.leaderboard ? `<a href="#/leaderboard" class="${on('#/leaderboard')}">Xếp hạng công khai</a>` : ''}
    ${u ? `<a href="#/dashboard" class="${on('#/dashboard')}">Dashboard</a>` : ''}${u?.isAdmin ? `<a href="#/admin" class="${on('#/admin')}">Admin</a>` : ''}<a href="#/methodology" class="${on('#/methodology')}">Cách tính</a><span class="sp"></span>
    ${u ? `<span class="usr">${u.avatar ? `<img alt="" src="https://cdn.discordapp.com/avatars/${esc(u.id)}/${esc(u.avatar)}.png?size=64">` : ''}${esc(u.name)}</span><a href="/auth/logout">Đăng xuất</a>` : '<a class="btn p" href="/auth/login">Đăng nhập với Discord</a>'}`;
}

async function home() {
  view(`<section class="hero"><div class="in"><span class="eyebrow">PUBLIC SERVER RANKING</span><h1>Đánh giá server bằng dữ liệu, không bằng cảm tính.</h1>
    <p>unzi là bảng xếp hạng công khai cho các cộng đồng Discord. Bot đo metadata hoạt động, tự tính điểm sau 24 giờ đầu và cập nhật liên tục để mọi người có thể khám phá server minh bạch hơn.</p>
    <div class="acts"><a class="btn p" href="${FT.user ? '#/dashboard' : '/auth/login'}">${FT.user ? 'Mở dashboard' : 'Đăng nhập với Discord'}</a><a class="btn" href="${esc(FT.invite)}" target="_blank" rel="noopener">Thêm bot để tham gia xếp hạng</a></div></div>
    <div class="g in hero-card" style="animation-delay:.15s"><span class="eyebrow">CÁCH HOẠT ĐỘNG</span><div class="steps"><div><b>01</b><span>Thêm bot vào server</span></div><div><b>02</b><span>unzi thu thập metadata</span></div><div><b>03</b><span>Hồ sơ và thứ hạng được cập nhật</span></div></div><p class="mu">Không đọc nội dung tin nhắn. Bot chỉ rời server khi bị kick.</p></div></section>
    <section class="intro-grid"><div><span class="eyebrow">VÌ SAO UNZI?</span><h2>Nhìn thấy sức khỏe thật của cộng đồng</h2><p class="mu">Mỗi server có profile riêng với điểm hoạt động, khả năng đón người mới, xu hướng 30 ngày và biểu đồ theo thời gian.</p></div><div class="g"><b>Bảng xếp hạng mở</b><p class="mu">Mọi người đều có thể xem, so sánh và đánh giá server đã tham gia.</p></div><div class="g"><b>Điểm số tự động</b><p class="mu">Sau 24 giờ bot sẽ tạo biểu đồ đầu tiên, sau đó liên tục cập nhật chỉ số và thứ hạng.</p></div></section>`);
}

async function leaderboard() {
  const rows = await api('/leaderboard');
  view(`<div class="ph in"><h1>Bảng xếp hạng</h1></div><p class="mu">Điểm của 30 ngày gần nhất, không tính số thành viên. Thanh gạch chéo nghĩa là dữ liệu còn mỏng.</p>
  <div class="gr">${rows.length ? rows.map((r, i) => { const low = r.confidence < 60;
    return `<a class="g sv in" style="animation-delay:${Math.min(i, 12) * 40}ms" href="#/server/${esc(r.id)}"><div class="nm">${icon(r)}<div style="min-width:0"><b>${esc(r.name)}</b><div>${chip(r.status)}${r.percentile != null ? `<span class="chip">Top ${Math.max(1, Math.round(100 - r.percentile))}%</span>` : ''}</div></div></div>
    <div class="cp"><span>Hoạt động<small>${num(r.activity)}</small></span>${r.activity != null ? pbar(r.activity, 'act', low) : ''}</div>
    <div class="cp"><span>Đón người mới<small>${num(r.welcoming)}</small></span>${r.welcoming != null ? pbar(r.welcoming, 'wel', low) : ''}</div>
    <div class="mini"><span>Tổng hợp <b>${num(r.overall ?? r.activity, 0)}</b></span>${r.trend == null ? '' : `<span>${r.trend > 0 ? '+' : ''}${r.trend} / 30 ngày</span>`}</div></a>`; }).join('') : '<p class="mu">Chưa có server nào đủ dữ liệu để hiển thị.</p>'}</div>`);
}

async function dashboard() {
  const d = await api('/me/guilds'), a = d.guilds.filter((g) => g.bot_present), b = d.guilds.filter((g) => !g.bot_present);
  const state = (g) => UNZI.serverState(g);
  const sc = (g) => (g.overall != null || g.activity != null ? `<div class="mini"><span>Tổng hợp <b>${num(g.overall ?? g.activity)}</b></span><span>Hoạt động <b>${num(g.activity)}</b></span><span>Đón <b>${num(g.welcoming)}</b></span></div>` : '<div class="mini">Đang thu thập dữ liệu</div>');
  view(`<div class="ph in"><div><span class="eyebrow">DASHBOARD</span><h1>Server của bạn</h1><p class="mu">Tất cả server bạn quản lý, dù đã tham gia xếp hạng hay chưa.</p></div><a class="btn p" href="${esc(d.invite)}" target="_blank" rel="noopener">Thêm bot vào server</a></div>
  ${UNZI.sectionTitle('YOUR SERVERS', 'Một nơi cho mọi server', 'Click vào bất kỳ server nào để mở profile và xem trạng thái tham gia xếp hạng.')}
  <h2>Đã có bot (${a.length})</h2><div class="gr">${a.map((g, i) => `<a class="g sv in" style="animation-delay:${i * 50}ms" href="#/server/${esc(g.id)}"><div class="nm">${icon(g)}<b>${esc(g.name)}</b></div><div>${state(g)}${g.status ? chip(g.status) : ''}</div>${sc(g)}</a>`).join('') || '<p class="mu">Chưa có server nào.</p>'}</div>
  <h2>Chưa tham gia xếp hạng (${b.length})</h2><div class="gr">${b.map((g, i) => `<a class="g sv in" style="animation-delay:${i * 50}ms" href="#/server/${esc(g.id)}"><div class="nm">${icon(g)}<div><b>${esc(g.name)}</b><div><span class="chip">Chưa tham gia xếp hạng</span></div></div></div><span class="btn sm">Thêm bot để tham gia</span></a>`).join('') || '<p class="mu">Tất cả server của bạn đã tham gia xếp hạng.</p>'}</div>
  <p class="mu" style="margin-top:22px;font-size:13px">Chỉ hiển thị server bạn có quyền Manage Server. Bot luôn thu thập sau khi tham gia; muốn dừng, hãy kick bot khỏi server.</p>`);
  window.onfocus = () => { if (location.hash === '#/dashboard') dashboard().catch(() => {}); };
}

async function profile(id) {
  const d = await api('/guilds/' + id), g = d.guild, s = d.score, pv = d.role === 'manager', A = s?.components.activity || {}, low = s && s.confidence < 60;
  if (!d.bot_present) {
    view(`<a class="mu" href="#/dashboard">← Quay lại dashboard</a><section class="empty-profile g in"><span class="eyebrow">SERVER PROFILE</span><div class="nm">${icon(g, 1)}<div><h1 style="font-size:30px">${esc(g.name)}</h1><span class="chip">Chưa tham gia xếp hạng</span></div></div><p class="mu">Server này chưa thêm bot unzi nên chưa có dữ liệu, biểu đồ hoặc thứ hạng công khai.</p><a class="btn p" href="${esc(d.invite)}" target="_blank" rel="noopener">Thêm bot để tham gia xếp hạng</a></section>`);
    return;
  }
  const comps = (w, c, L) => Object.keys(w).map((k) => `<div class="cp"><span>${L[k]}<small>${Math.round(w[k] * 100)}%${c?.[k] != null ? ' · ' + num(c[k], 0) : ''}</small></span>${c?.[k] != null ? pbar(c[k], 'act', low) : '<small>Chưa đủ dữ liệu</small>'}</div>`).join('');
  const mc = (l, v, c, sub, i) => `<div class="g mc in" style="animation-delay:${i * 90}ms"><div class="rw">${ring(v, c)}<b class="num" style="color:var(--${c})"${v != null ? ` data-n="${v}"` : ''}>${v == null ? '—' : '0.0'}</b></div><h3>${l}</h3><p class="mu" style="margin:0;font-size:13px">${sub}</p></div>`;
  const pct = s?.percentile != null ? `Top ${Math.max(1, Math.round(100 - s.percentile))}% các server` : null;
  const ax = [{ l: 'Tham gia', v: A.U }, { l: 'Tần suất', v: A.F }, { l: 'Tương tác', v: A.Q }, { l: 'Đều đặn', v: A.C }, { l: 'Đa dạng', v: A.D }, { l: 'Đón người mới', v: s?.welcoming }];
  const gs = pv ? g : {};
  view(`<a class="mu" href="${pv ? '#/dashboard' : '#/leaderboard'}">← Quay lại</a>
  <div class="ph in"><div class="nm">${icon(g, 1)}<div><h1 style="font-size:30px">${esc(g.name)}</h1><div>${s ? chip(s.status) : ''}${gs.blocked ? '<span class="chip blocked">Bị khóa</span>' : ''}${gs.hidden ? '<span class="chip">Ẩn khỏi bảng xếp hạng</span>' : ''}</div></div></div>
  ${g.invite_url ? `<a class="btn" href="${esc(g.invite_url)}" target="_blank" rel="noopener">Tham gia server</a>` : ''}</div>
  ${g.description ? `<p class="mu" style="margin:4px 0 0">${esc(g.description)}</p>` : ''}
  ${s ? `<div class="tops">${mc('Tổng hợp', s.overall, 'ovr', pct || (s.overall == null ? 'Cần đủ cả hai nhóm dữ liệu' : '60% Hoạt động + 40% Đón người mới'), 0)}${mc('Hoạt động', s.activity, 'act', s.activity == null ? 'Chưa đủ dữ liệu' : '30 ngày gần nhất', 1)}${mc('Đón người mới', s.welcoming, 'wel', s.welcoming == null ? `Mới có ${s.welcome.eligibleNew} người mới trong mẫu` : `Mẫu ${s.welcome.eligibleNew} người mới`, 2)}</div>
  <div class="cf">Độ tin cậy dữ liệu <b style="color:var(--tx)">${num(s.confidence, 0)}/100</b><div class="tr"><i style="width:${s.confidence}%"></i></div><span>Cập nhật ${new Date(s.computed_at).toLocaleString('vi-VN')}</span></div>` : '<div class="g" style="margin-top:22px">Chưa có điểm cho server này. Bot cần thu thập dữ liệu, lần tính đầu tiên chạy trong tối đa 1 giờ.</div>'}
  <h2>Nhắn tin theo giờ trong ngày</h2><div class="g">${d.heat ? hourBars(d.heat) : '<p class="mu">Chưa đủ dữ liệu để hiển thị.</p>'}</div>
  <h2>Các chỉ số theo thời gian</h2><div class="g cb" id="c1"></div><div class="g cb" id="c2"></div>
  ${s ? `<h2>Hồ sơ chỉ số</h2><div class="two"><div class="g">${radar(ax, d.avg)}</div><div class="g"><h3 style="margin-bottom:12px">Hoạt động</h3>${comps(s.weights.activity, s.components.activity, LA)}<h3 style="margin:18px 0 12px">Đón người mới</h3>${comps(s.weights.welcoming, s.components.welcoming, LW)}
    <p class="mu" style="font-size:13px">Mẫu người mới: ${s.welcome.eligibleNew} · được phản hồi ${num(s.welcome.responseRate, 0)}% · phản hồi đầu tiên trung vị ${num(s.welcome.medianMin, 0)} phút (P90 ${num(s.welcome.p90Min, 0)}) · còn hoạt động D7 ${num(s.welcome.d7Rate, 0)}%. Retention chỉ là tương quan.</p></div></div>` : ''}
  ${pv ? `<h2>Gợi ý cải thiện</h2>${recs(d)}
  <h2>Phân bố theo kênh</h2><div class="g">${d.channels.length ? d.channels.map((c) => `<div class="cp"><span>#${esc(c.name)}<small>${c.share}%</small></span>${pbar(c.share, 'wel')}</div>`).join('') : '<p class="mu">Chưa có dữ liệu.</p>'}</div>
  <h2>Sức khỏe dữ liệu</h2><div class="g"><div class="mini" style="flex-wrap:wrap"><span>Sự kiện 24 giờ <b>${d.events24h}</b></span><span>Độ phủ <b>${num(s?.coverage, 0)}%</b></span><span>Ngày quan sát <b>${s?.obsDays ?? 0}</b></span><span>Bot báo cáo lần cuối <b>${g.last_heartbeat ? new Date(g.last_heartbeat).toLocaleString('vi-VN') : '—'}</b></span></div></div>
  <h2>Cấu hình</h2>${g.blocked ? '<div class="warn">Server này đã bị quản trị hệ thống khóa. Bạn có thể gửi khiếu nại bên dưới.</div>' : ''}
  <form class="g" id="cfg"><p class="rec">Bot unzi đang thu thập liên tục. Không có công tắc theo dõi/ngừng theo dõi trên dashboard; để rời bảng xếp hạng, hãy kick bot khỏi server.</p>
   <label class="sw"><input type="checkbox" name="is_public"${g.is_public ? ' checked' : ''}> Cho phép hiển thị hồ sơ khi hệ thống mở tính năng xem công khai</label>
   <label>Mô tả công khai</label><textarea name="description" rows="2" maxlength="500">${esc(g.description)}</textarea>
   <label>Link mời (discord.gg/...)</label><input type="text" name="invite_url" value="${esc(g.invite_url)}">
   <label>Kênh được đo (không chọn = tất cả kênh bot nhìn thấy)</label>${g.channels.map((c) => `<label class="ck"><input type="checkbox" name="ch" value="${esc(c.id)}"${g.selected_channels?.includes(c.id) ? ' checked' : ''}>#${esc(c.name)}</label>`).join('')}
   <div class="acl"><button class="btn p" type="submit">Lưu cấu hình</button></div><p class="mu" id="msg" role="status"></p></form>
  <h2>Khiếu nại về điểm số</h2><form class="g" id="ap"><p class="mu" style="margin-top:0">Nếu thấy số liệu sai (ví dụ bot thiếu quyền, kênh đo thiếu), mô tả ngắn gọn. Quản trị hệ thống chỉ có thể tính lại từ dữ liệu gốc, không sửa điểm trực tiếp.</p>
   <textarea name="message" rows="3" maxlength="1000" placeholder="Mô tả vấn đề (tối thiểu 10 ký tự)"></textarea><div class="acl"><button class="btn" type="submit">Gửi khiếu nại</button></div><p class="mu" id="amsg" role="status"></p>
   ${d.appeals.map((a) => `<div class="rec">${new Date(a.created_at).toLocaleDateString('vi-VN')} · <b>${a.status === 'open' ? 'Đang chờ' : a.status === 'resolved' ? 'Đã xử lý' : 'Từ chối'}</b><br>${esc(a.message)}${a.admin_reply ? `<br><span class="mu">Phản hồi: ${esc(a.admin_reply)}</span>` : ''}</div>`).join('')}</form>` : ''}`);

  const H = d.history;
  if (H.length) chart($('#c1'), 'Điểm theo ngày', H.map((h) => String(h.d).slice(0, 10)), [
    { k: 'o', n: 'Tổng hợp', c: 'var(--s1)', v: H.map((h) => (h.overall == null ? null : +h.overall)) }, { k: 'a', n: 'Hoạt động', c: 'var(--s2)', v: H.map((h) => (h.activity == null ? null : +h.activity)) },
    { k: 'w', n: 'Đón người mới', c: 'var(--s3)', v: H.map((h) => (h.welcoming == null ? null : +h.welcoming)) }, { k: 'c', n: 'Độ tin cậy', c: 'var(--s4)', dash: 1, on: false, v: H.map((h) => +h.confidence) }], { max: 100 });
  else $('#c1').innerHTML = '<h3>Điểm theo ngày</h3><p class="mu">Chưa đủ lịch sử để vẽ.</p>';
  if (d.daily?.length) { const D = d.daily, col = (k) => D.map((x) => +x[k]);
    chart($('#c2'), 'Hoạt động theo ngày', D.map((x) => String(x.day).slice(0, 10)), [
      { k: 'u', n: 'Người hoạt động', c: 'var(--s2)', v: col('unique_active') }, { k: 'm', n: 'Tin nhắn', c: 'var(--s3)', v: col('messages') }, { k: 's', n: 'Phiên trò chuyện', c: 'var(--s4)', on: false, v: col('sessions') },
      { k: 'r', n: 'Reply', c: 'var(--s5)', on: false, v: col('replies') }, { k: 'j', n: 'Vào server', c: 'var(--s6)', on: false, v: col('joins') }, { k: 'l', n: 'Rời server', c: 'var(--s1)', on: false, v: col('leaves') }], { norm: true });
  } else $('#c2').innerHTML = '<h3>Hoạt động theo ngày</h3><p class="mu">Chưa đủ dữ liệu để vẽ.</p>';

  if (!pv) return;
  const F = $('#cfg'), say = (t) => { $('#msg').textContent = t; };
  F.onsubmit = async (e) => { e.preventDefault(); const f = new FormData(F), ch = f.getAll('ch');
    try { await patch(`/manage/${id}/config`, { is_public: F.is_public.checked, description: f.get('description'), invite_url: f.get('invite_url'), selected_channels: ch.length ? ch : null }); say('Đã lưu.'); }
    catch { say('Không lưu được. Kiểm tra link mời hoặc quyền.'); } };
  $('#ap').onsubmit = async (e) => { e.preventDefault(); try { await post(`/manage/${id}/appeal`, { message: $('#ap textarea').value }); profile(id); } catch (x) { $('#amsg').textContent = x.status === 429 ? 'Bạn đang có quá nhiều khiếu nại chưa xử lý.' : 'Cần ít nhất 10 ký tự.'; } };
}

async function meth() {
  const m = await api('/methodology');
  view(`<div class="ph in"><h1>Cách tính điểm</h1></div><p class="mu">Phiên bản thuật toán ${esc(m.version)} · cửa sổ chính ${esc(m.window)}.</p>
  <div class="two" style="align-items:start"><div class="g"><h3>Hoạt động</h3>${Object.entries(m.weights.activity).map(([k, w]) => `<div class="cp"><span>${LA[k]}<small>${w * 100}%</small></span></div>`).join('')}</div>
  <div class="g"><h3>Đón người mới</h3>${Object.entries(m.weights.welcoming).map(([k, w]) => `<div class="cp"><span>${LW[k]}<small>${w * 100}%</small></span></div>`).join('')}</div></div>
  <h2>Tổng hợp</h2><p>${m.weights.overall.activity * 100}% Hoạt động + ${m.weights.overall.welcoming * 100}% Đón người mới</p><h2>Nguyên tắc</h2>${m.notes.map((n) => `<div class="rec">${esc(n)}</div>`).join('')}`);
}

const fail = (e) => view(e.status === 401 ? '<div class="ph"><h1>Đăng nhập để tiếp tục</h1></div><p><a class="btn p" href="/auth/login">Đăng nhập với Discord</a></p>'
  : e.status === 404 || e.status === 403 ? '<div class="ph"><h1>Không tìm thấy</h1></div><p class="mu">Trang này không tồn tại hoặc bạn không có quyền xem.</p>' : '<div class="ph"><h1>Có lỗi xảy ra</h1></div><p class="mu">Thử tải lại trang.</p>');
const ROUTES = [[/^#\/server\/(\d+)$/, profile], [/^#\/dashboard$/, dashboard], [/^#\/leaderboard$/, leaderboard], [/^#\/methodology$/, meth], [/^#\/admin(?:\/(\w+))?$/, (t) => admin(t)]];
async function route() {
  FT = await api('/features').catch(() => ({ invite: '#' }));
  nav();
  const h = location.hash || '#/';
  for (const [r, f] of ROUTES) { const m = h.match(r); if (m) return f(m[1]).catch(fail); }
  return home().catch(fail);
}
addEventListener('hashchange', route);
route();
