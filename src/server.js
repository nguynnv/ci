import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q, audit, getSettings, setSetting, SETTING_VALUES } from './db.js';
import { runJobs, recomputeGuild, jobState } from './jobs.js';
import { VERSION, WEIGHTS } from './scoring.js';

const { DISCORD_CLIENT_ID: CID, DISCORD_CLIENT_SECRET: SECRET, BASE_URL = 'http://localhost:3000', PORT = 3000 } = process.env;
const ADMINS = new Set((process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const INVITE = `https://discord.com/oauth2/authorize?client_id=${CID}&scope=bot%20applications.commands&permissions=3072`; // View Channel + Send Messages (để gửi thông báo minh bạch)
const A = (f) => (req, res) => f(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server' }); });
const today = () => new Date().toISOString().slice(0, 10);
const INVITE_RE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/;

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use((_, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'" });
  next();
});
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// ---- Discord OAuth2 + session trong RAM (MVP) ----
const sessions = new Map();
const cookie = (req, k) => (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([n]) => n === k)?.[1];
const sess = (req) => { const s = sessions.get(cookie(req, 'sid')); return s && s.exp > Date.now() ? s : null; };
const setCk = (res, k, v, age) => res.append('Set-Cookie', `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${BASE_URL.startsWith('https') ? '; Secure' : ''}`);
const REDIRECT = `${BASE_URL}/auth/callback`;

app.get('/auth/login', (_, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setCk(res, 'st', state, 600);
  res.redirect('https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: CID, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify guilds', state }));
});
app.get('/auth/callback', async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== cookie(req, 'st')) return res.status(400).send('state không hợp lệ');
    const tok = await (await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: REDIRECT }) })).json();
    if (!tok.access_token) return res.status(400).send('Đăng nhập thất bại');
    const H = { Authorization: `Bearer ${tok.access_token}` };
    const [me, gs] = await Promise.all(['users/@me', 'users/@me/guilds'].map((p) => fetch('https://discord.com/api/' + p, { headers: H }).then((r) => r.json())));
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { id: me.id, name: me.global_name || me.username, avatar: me.avatar, isAdmin: ADMINS.has(me.id), exp: Date.now() + 7 * 864e5,
      guilds: gs.filter((g) => g.owner || (BigInt(g.permissions) & 0x20n)).map((g) => ({ id: g.id, name: g.name, icon: g.icon })) }); // chỉ server user có Manage Server
    setCk(res, 'sid', sid, 7 * 86400);
    res.redirect('/#/dashboard');
  } catch (e) { console.error(e); res.status(500).send('Lỗi đăng nhập'); }
});
app.get('/auth/logout', (req, res) => { sessions.delete(cookie(req, 'sid')); setCk(res, 'sid', '', 0); res.redirect('/'); });

// ---- Quyền xem: 'off' = ẩn hẳn (không menu, API 404). Admin luôn xem được ----
const can = (level, s) => level === 'public' || !!s?.isAdmin || (level === 'managers' && !!s && s.guilds.length > 0);
const need = (req, res, next) => { const s = sess(req); if (!s) return res.status(401).json({ error: 'login' }); req.s = s; next(); };
const adminOnly = (req, res, next) => need(req, res, () => (req.s.isAdmin ? next() : res.status(404).json({ error: 'not_found' })));
const manage = (req, res, next) => need(req, res, () => (req.s.isAdmin || req.s.guilds.some((g) => g.id === req.params.id) ? next() : res.status(403).json({ error: 'forbidden' })));

app.get('/api/features', A(async (req, res) => {
  const st = await getSettings(), s = sess(req);
  res.json({ user: s && { id: s.id, name: s.name, avatar: s.avatar, isAdmin: s.isAdmin }, leaderboard: can(st.leaderboard, s), profiles: can(st.public_profiles, s),
    percentile: st.show_percentile === 'on' || !!s?.isAdmin, invite: INVITE });
}));
app.get('/api/methodology', (_, res) => res.json({ version: VERSION, weights: WEIGHTS, window: '30 ngày',
  notes: ['Không dùng tổng số thành viên, boost hay quảng cáo để tính điểm.', 'Thiếu dữ liệu hiển thị "chưa đủ dữ liệu", không bị tính 0.', 'Độ tin cậy dữ liệu là chỉ số riêng, không phải chất lượng cộng đồng.', 'Không ai (kể cả quản trị hệ thống) sửa trực tiếp điểm số; chỉ có thể tính lại từ dữ liệu gốc.'] }));

const latest = async (id) => (await q('SELECT * FROM score_snapshots WHERE guild_id=? AND scoring_version=? ORDER BY snap_date DESC LIMIT 1', [id, VERSION]))[0];
const daily = async (id, n) => (await q('SELECT day, unique_active, messages, sessions, replies, joins, leaves FROM daily_metrics WHERE guild_id=? ORDER BY day DESC LIMIT ?', [id, n])).reverse();
const LATEST = `LEFT JOIN score_snapshots s ON s.guild_id=g.id AND s.scoring_version=? AND s.snap_date=(SELECT MAX(snap_date) FROM score_snapshots WHERE guild_id=g.id AND scoring_version=?)`;

// Trung bình các server (để vẽ đường so sánh trên biểu đồ lục giác); cần ≥3 server
async function radarAvg() {
  const rows = await q(`SELECT s.breakdown b, s.welcoming w FROM score_snapshots s JOIN guilds g ON g.id=s.guild_id
    WHERE s.snap_date=? AND s.scoring_version=? AND g.enabled=1 AND g.hidden=0 AND g.blocked=0 AND s.activity IS NOT NULL`, [today(), VERSION]);
  if (rows.length < 3) return null;
  const m = (f) => { const v = rows.map(f).filter((x) => x != null).map(Number); return v.length >= 3 ? Math.round((v.reduce((a, x) => a + x, 0) / v.length) * 10) / 10 : null; };
  return ['U', 'F', 'Q', 'C', 'D'].map((k) => m((r) => r.b.activity[k])).concat(m((r) => r.w));
}

// ---- Leaderboard (ẩn hẳn khi công tắc = off) ----
app.get('/api/leaderboard', A(async (req, res) => {
  const st = await getSettings(), s = sess(req);
  if (!can(st.leaderboard, s)) return res.status(404).json({ error: 'not_found' });
  const ago = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), pct = st.show_percentile === 'on' || s?.isAdmin;
  const rows = await q(`SELECT g.id,g.name,g.icon, s.activity,s.welcoming,s.overall,s.confidence,s.percentile,s.ranking_status status,
      (SELECT COALESCE(o.overall,o.activity) FROM score_snapshots o WHERE o.guild_id=g.id AND o.scoring_version=? AND o.snap_date<=? ORDER BY o.snap_date DESC LIMIT 1) prev
    FROM guilds g JOIN score_snapshots s ON s.guild_id=g.id AND s.scoring_version=? AND s.snap_date=(SELECT MAX(snap_date) FROM score_snapshots WHERE guild_id=g.id AND scoring_version=?)
    WHERE g.enabled=1 AND g.paused=0 AND g.hidden=0 AND g.blocked=0 AND g.is_public=1 AND g.deleted_at IS NULL AND s.ranking_status NOT IN ('collecting','review')
    ORDER BY (s.ranking_status='ranked') DESC, COALESCE(s.overall,s.activity) DESC LIMIT 500`, [VERSION, ago, VERSION, VERSION]);
  res.json(rows.map(({ prev, ...r }) => ({ ...r, percentile: pct ? r.percentile : null, trend: prev == null ? null : Math.round((Number(r.overall ?? r.activity) - Number(prev)) * 10) / 10 })));
}));

// ---- Danh sách server của người dùng: đã/chưa có bot ----
app.get('/api/me/guilds', need, A(async (req, res) => {
  const ids = req.s.guilds.map((g) => g.id);
  const have = ids.length ? await q(`SELECT g.id,g.enabled,g.paused,g.blocked,g.bot_present,s.activity,s.welcoming,s.overall,s.ranking_status status FROM guilds g ${LATEST} WHERE g.id IN (?)`, [VERSION, VERSION, ids]) : [];
  const m = new Map(have.map((r) => [String(r.id), r]));
  res.json({ invite: INVITE, guilds: req.s.guilds.map((g) => ({ ...g, ...(m.get(String(g.id)) || { bot_present: 0 }), invite: `${INVITE}&guild_id=${g.id}&disable_guild_select=true` })) });
}));

// ---- Hồ sơ server: chủ server/admin xem đầy đủ; người khác chỉ xem nếu công tắc cho phép ----
app.get('/api/guilds/:id', A(async (req, res) => {
  const s = sess(req), id = req.params.id, st = await getSettings();
  const [g] = await q('SELECT * FROM guilds WHERE id=? AND bot_present=1', [id]);
  const priv = !!s && (s.isAdmin || s.guilds.some((x) => x.id === id));
  if (!g) {
    const own = s?.guilds.find((x) => x.id === id);
    if (!own) return res.status(404).json({ error: 'not_found' });
    return res.json({ role: 'manager', bot_present: false, invite: `${INVITE}&guild_id=${id}&disable_guild_select=true`, guild: own });
  }
  if (!priv && !(g.enabled && !g.deleted_at && g.is_public && !g.hidden && !g.blocked && can(st.public_profiles, s))) return res.status(404).json({ error: 'not_found' });
  const snap = await latest(id), b = snap?.breakdown, ok = priv || b?.raw?.mam >= 10; // mẫu nhỏ: ẩn biểu đồ chi tiết với người ngoài
  const history = (await q('SELECT snap_date d, activity, welcoming, overall, confidence FROM score_snapshots WHERE guild_id=? AND scoring_version=? ORDER BY snap_date DESC LIMIT 90', [id, VERSION])).reverse();
  const r = b?.raw, names = new Map((g.channels || []).map((c) => [c.id, c.name]));
  const out = { role: priv ? 'manager' : 'viewer', isAdmin: !!s?.isAdmin, history, avg: await radarAvg(),
    guild: { id: g.id, name: g.name, icon: g.icon, description: g.description, invite_url: g.invite_url },
    score: snap && { activity: snap.activity, welcoming: snap.welcoming, overall: snap.overall, confidence: snap.confidence, status: snap.ranking_status, computed_at: snap.computed_at,
      percentile: st.show_percentile === 'on' || priv ? snap.percentile : null, weights: b.weights, components: { activity: b.activity, welcoming: b.welcoming },
      welcome: { eligibleNew: r.eligibleNew, responseRate: r.welcomeResponseRate, medianMin: r.firstResponseMedianMin, p90Min: r.firstResponseP90Min, d7Rate: r.d7Rate },
      ...(priv ? { flags: b.flags, coverage: b.coverage, obsDays: b.obsDays, raw: r } : {}) },
    daily: ok ? await daily(id, 90) : null, heat: ok ? b.heat : null };
  if (priv) {
    const [h] = await q('SELECT COUNT(*) n FROM events WHERE guild_id=? AND ts>=?', [id, new Date(Date.now() - 864e5)]);
    Object.assign(out.guild, { enabled: g.enabled, paused: g.paused, blocked: g.blocked, hidden: g.hidden, is_public: g.is_public, selected_channels: g.selected_channels, channels: g.channels || [], last_heartbeat: g.last_heartbeat, consented_at: g.consented_at });
    out.channels = (b?.channels || []).map((c) => ({ ...c, name: names.get(c.id) || c.id }));
    out.events24h = h.n;
    out.appeals = await q('SELECT id,message,status,admin_reply,created_at FROM appeals WHERE guild_id=? ORDER BY id DESC LIMIT 5', [id]);
  }
  res.json(out);
}));

// ---- Quản lý server (chủ server có Manage Server, hoặc admin) ----
app.patch('/api/manage/:id/config', manage, A(async (req, res) => {
  const [g] = await q('SELECT channels, blocked FROM guilds WHERE id=? AND bot_present=1', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'bot_missing' });
  const b = req.body || {}, set = [], p = [], put = (c, v) => { set.push(`${c}=?`); p.push(v); };
  if ('description' in b) put('description', String(b.description || '').slice(0, 500));
  if ('is_public' in b) put('is_public', b.is_public ? 1 : 0);
  if ('invite_url' in b) {
    const u = String(b.invite_url || '');
    if (u && !INVITE_RE.test(u)) return res.status(400).json({ error: 'invite_url' });
    put('invite_url', u || null);
  }
  if ('selected_channels' in b) { // null = tất cả kênh; ngược lại chỉ nhận id kênh có thật
    const ok = new Set((g.channels || []).map((c) => c.id));
    put('selected_channels', Array.isArray(b.selected_channels) ? JSON.stringify(b.selected_channels.filter((id) => ok.has(id))) : null);
  }
  if (b.enabled === true) {
    if (g.blocked && !req.s.isAdmin) return res.status(403).json({ error: 'blocked' });
    set.push('enabled=1', 'deleted_at=NULL', 'consented_at=COALESCE(consented_at, ?)'); p.push(new Date());
  }
  if (b.enabled === false) set.push('enabled=0');
  if (!set.length) return res.status(400).json({ error: 'empty' });
  await q(`UPDATE guilds SET ${set.join(', ')} WHERE id=?`, [...p, req.params.id]);
  await audit(req.params.id, req.s.id, 'config', Object.keys(b));
  res.json({ ok: true });
}));
app.post('/api/manage/:id/appeal', manage, A(async (req, res) => {
  const msg = String(req.body?.message || '').trim().slice(0, 1000);
  if (msg.length < 10) return res.status(400).json({ error: 'too_short' });
  const [{ n }] = await q("SELECT COUNT(*) n FROM appeals WHERE guild_id=? AND status='open'", [req.params.id]);
  if (n >= 3) return res.status(429).json({ error: 'too_many_open' });
  const snap = await latest(req.params.id);
  await q('INSERT INTO appeals (guild_id,user_id,snapshot_id,message) VALUES (?,?,?,?)', [req.params.id, req.s.id, snap?.id ?? null, msg]);
  await audit(req.params.id, req.s.id, 'appeal'); res.json({ ok: true });
}));

// ---- Admin panel ----
app.get('/api/admin/overview', adminOnly, A(async (_, res) => {
  const [t] = await q(`SELECT COUNT(*) total, COALESCE(SUM(enabled=1 AND blocked=0),0) tracking, COALESCE(SUM(blocked=1),0) blocked, COALESCE(SUM(hidden=1),0) hidden, MAX(last_heartbeat) hb FROM guilds WHERE bot_present=1`);
  const [ev] = await q('SELECT COUNT(*) n FROM events WHERE ts>=?', [new Date(Date.now() - 864e5)]);
  const [ap] = await q("SELECT COUNT(*) n FROM appeals WHERE status='open'");
  const [rv] = await q("SELECT COUNT(*) n FROM score_snapshots WHERE snap_date=? AND scoring_version=? AND ranking_status='review'", [today(), VERSION]);
  const series = (await q('SELECT day, SUM(messages) messages, SUM(unique_active) active, SUM(joins) joins, SUM(leaves) leaves FROM daily_metrics GROUP BY day ORDER BY day DESC LIMIT 90')).reverse();
  res.json({ ...t, events24h: ev.n, appeals: ap.n, review: rv.n, job: jobState, series, settings: await getSettings() });
}));
app.get('/api/admin/guilds', adminOnly, A(async (_, res) => {
  res.json(await q(`SELECT g.id,g.name,g.icon,g.description,g.invite_url,g.enabled,g.paused,g.hidden,g.blocked,g.bot_present,g.is_public,g.admin_note,g.consented_at,g.last_heartbeat,
    s.activity,s.welcoming,s.overall,s.confidence,s.percentile,s.ranking_status status,s.computed_at,
    COALESCE((SELECT SUM(delta) FROM score_adjustments a WHERE a.guild_id=g.id),0) adjustment
    FROM guilds g ${LATEST} ORDER BY COALESCE(s.overall,s.activity) DESC, g.name LIMIT 5000`, [VERSION, VERSION]));
}));
app.patch('/api/admin/guilds/:id', adminOnly, A(async (req, res) => {
  const b = req.body || {}, set = [], p = [], put = (c, v) => { set.push(`${c}=?`); p.push(v); };
  for (const k of ['hidden', 'is_public']) if (k in b) put(k, b[k] ? 1 : 0);
  if (b.blocked === true) set.push('blocked=1', 'enabled=0'); // bot sẽ tự rời server trong ≤30 giây
  if (b.blocked === false) set.push('blocked=0');
  if ('admin_note' in b) put('admin_note', String(b.admin_note || '').slice(0, 500) || null);
  if ('description' in b) put('description', String(b.description || '').slice(0, 500) || null);
  if ('invite_url' in b) { const u = String(b.invite_url || ''); if (u && !INVITE_RE.test(u)) return res.status(400).json({ error: 'invite_url' }); put('invite_url', u || null); }
  if (!set.length) return res.status(400).json({ error: 'empty' });
  await q(`UPDATE guilds SET ${set.join(', ')} WHERE id=?`, [...p, req.params.id]);
  await audit(req.params.id, req.s.id, 'admin_edit', b); res.json({ ok: true });
}));
app.post('/api/admin/guilds/:id/recompute', adminOnly, A(async (req, res) => {
  try { await recomputeGuild(req.params.id); await audit(req.params.id, req.s.id, 'recompute'); res.json({ ok: true }); }
  catch { res.status(400).json({ error: 'not_tracked' }); }
}));
app.post('/api/admin/guilds/:id/adjust-score', adminOnly, A(async (req, res) => {
  const delta = Number(req.body?.delta), reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 25 || reason.length < 3) return res.status(400).json({ error: 'invalid_adjustment' });
  await q('INSERT INTO score_adjustments (guild_id,delta,reason,actor_id) VALUES (?,?,?,?)', [req.params.id, delta, reason, req.s.id]);
  await recomputeGuild(req.params.id); await audit(req.params.id, req.s.id, 'score_adjustment', { delta, reason }); res.json({ ok: true });
}));
app.post('/api/admin/guilds/:id/purge', adminOnly, A(async (req, res) => { await q('DELETE FROM events WHERE guild_id=?', [req.params.id]); await audit(req.params.id, req.s.id, 'purge_events'); res.json({ ok: true }); }));
app.post('/api/admin/jobs/run', adminOnly, A(async (req, res) => { runJobs(); await audit(null, req.s.id, 'run_jobs'); res.json({ ok: true }); }));

app.get('/api/admin/appeals', adminOnly, A(async (_, res) => res.json(await q('SELECT a.*, g.name FROM appeals a LEFT JOIN guilds g ON g.id=a.guild_id ORDER BY (a.status=\'open\') DESC, a.id DESC LIMIT 200'))));
app.post('/api/admin/appeals/:id', adminOnly, A(async (req, res) => {
  const { status, reply } = req.body || {};
  if (!['resolved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status' });
  await q('UPDATE appeals SET status=?, admin_reply=?, resolved_at=? WHERE id=?', [status, String(reply || '').slice(0, 1000) || null, new Date(), req.params.id]);
  await audit(null, req.s.id, 'appeal_' + status, { id: req.params.id }); res.json({ ok: true });
}));
app.get('/api/admin/audit', adminOnly, A(async (_, res) => res.json(await q('SELECT a.id,a.guild_id,a.actor_id,a.action,a.meta,a.created_at,g.name FROM audit_logs a LEFT JOIN guilds g ON g.id=a.guild_id ORDER BY a.id DESC LIMIT 200'))));
app.put('/api/admin/settings', adminOnly, A(async (req, res) => {
  const { k, v } = req.body || {};
  if (!SETTING_VALUES[k]?.includes(v)) return res.status(400).json({ error: 'invalid' });
  await setSetting(k, v); await audit(null, req.s.id, 'setting', { k, v }); res.json(await getSettings());
}));

app.listen(PORT, () => console.log(`Web: ${BASE_URL}`));
setTimeout(runJobs, 10e3);
setInterval(runJobs, (+process.env.JOB_INTERVAL_MIN || 60) * 6e4);
