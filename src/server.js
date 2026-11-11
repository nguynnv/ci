import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { q, audit } from './db.js';
import { runJobs } from './jobs.js';
import { VERSION, WEIGHTS } from './scoring.js';

const { DISCORD_CLIENT_ID: CID, DISCORD_CLIENT_SECRET: SECRET, BASE_URL = 'http://localhost:3000', PORT = 3000 } = process.env;
const ADMIN_IDS = new Set((process.env.ADMIN_DISCORD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
const CATS = ['gaming', 'education', 'technology', 'creator', 'social', 'support', 'fan', 'marketplace', 'other'];
const A = (f) => (req, res) => f(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server' }); });

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use((_, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
  next();
});
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
const publicDir = fileURLToPath(new URL('../public', import.meta.url));
app.get('/dashboard', (_, res) => res.sendFile(`${publicDir}\\dashboard.html`));
app.get('/admin', (_, res) => res.sendFile(`${publicDir}\\admin.html`));
app.get('/server', (_, res) => res.sendFile(`${publicDir}\\server.html`));
app.get('/methodology', (_, res) => res.sendFile(`${publicDir}\\methodology.html`));

// ---- Discord OAuth2 + session trong bộ nhớ (MVP; đổi sang bảng/Redis khi chạy nhiều tiến trình) ----
const sessions = new Map();
const cookie = (req, k) => (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([n]) => n === k)?.[1];
const sess = (req) => { const s = sessions.get(cookie(req, 'sid')); return s && s.exp > Date.now() ? s : null; };
const settings = async () => Object.fromEntries((await q('SELECT setting_key, setting_value FROM system_settings')).map((r) => [r.setting_key, !!r.setting_value]));
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
    sessions.set(sid, { id: me.id, name: me.global_name || me.username, exp: Date.now() + 7 * 864e5,
      guilds: gs.map((g) => ({ id: g.id, name: g.name, icon: g.icon, can_manage: g.owner || !!(BigInt(g.permissions) & 0x20n) })) });
    setCk(res, 'sid', sid, 7 * 86400);
    res.redirect('/#/dashboard');
  } catch (e) { console.error(e); res.status(500).send('Lỗi đăng nhập'); }
});
app.get('/auth/logout', (req, res) => { sessions.delete(cookie(req, 'sid')); setCk(res, 'sid', '', 0); res.redirect('/'); });
app.get('/api/session', (req, res) => {
  const s = sess(req);
  res.json(s ? { authenticated: true, user: { id: s.id, name: s.name } } : { authenticated: false });
});

// ---- Public API ----
const latest = async (id) => (await q('SELECT * FROM score_snapshots WHERE guild_id=? AND scoring_version=? ORDER BY snap_date DESC LIMIT 1', [id, VERSION]))[0];
const daily = async (id, n) => (await q('SELECT day, unique_active, messages FROM daily_metrics WHERE guild_id=? ORDER BY day DESC LIMIT ?', [id, n])).reverse();

app.get('/api/methodology', A(async (_, res) => {
  if (!(await settings()).public_methodology) return res.status(404).json({ error: 'feature_disabled' });
  res.json({ version: VERSION, weights: WEIGHTS, window: '30 ngày', categories: CATS,
  notes: ['Không dùng tổng số thành viên, boost hay quảng cáo để tính điểm.', 'Thiếu dữ liệu hiển thị "chưa đủ dữ liệu", không bị tính 0.', 'Độ tin cậy dữ liệu là chỉ số riêng, không phải chất lượng cộng đồng.', 'Ranked cần ≥60 ngày quan sát, đủ mẫu, độ tin cậy ≥60 và không có cờ bất thường.'] });
}));

app.get('/api/leaderboard', A(async (req, res) => {
  const flags = await settings();
  if (!flags.public_leaderboard) return res.status(404).json({ error: 'feature_disabled' });
  const { category, language } = req.query, w = [], p = [];
  if (CATS.includes(category)) { w.push('JSON_CONTAINS(g.categories, JSON_QUOTE(?))'); p.push(category); }
  if (/^[a-z]{2,8}$/.test(language || '')) { w.push('g.language=?'); p.push(language); }
  const ago = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const rows = await q(`SELECT g.id,g.name,g.icon,g.categories,g.language, s.activity,s.welcoming,s.overall,s.confidence,s.percentile,s.ranking_status status,
      (SELECT COALESCE(o.overall,o.activity) FROM score_snapshots o WHERE o.guild_id=g.id AND o.scoring_version=? AND o.snap_date<=? ORDER BY o.snap_date DESC LIMIT 1) prev
    FROM guilds g JOIN score_snapshots s ON s.guild_id=g.id AND s.scoring_version=? AND s.snap_date=(SELECT MAX(snap_date) FROM score_snapshots WHERE guild_id=g.id AND scoring_version=?)
    WHERE g.bot_present=1 AND g.is_public=1 AND g.deleted_at IS NULL AND s.ranking_status<>'collecting'${w.length ? ' AND ' + w.join(' AND ') : ''}
    ORDER BY (s.ranking_status='ranked') DESC, COALESCE(s.overall,s.activity) DESC LIMIT 500`, [VERSION, ago, VERSION, VERSION, ...p]);
  res.json(rows.map(({ prev, ...r }) => ({ ...r, trend: prev == null ? null : Math.round((Number(r.overall ?? r.activity) - Number(prev)) * 10) / 10 })));
}));

app.get('/api/guilds/:id', A(async (req, res) => {
  const flags = await settings();
  if (!flags.public_profiles) return res.status(404).json({ error: 'feature_disabled' });
  const [g] = await q('SELECT id,name,icon,description,categories,language,invite_url FROM guilds WHERE id=? AND bot_present=1 AND is_public=1 AND deleted_at IS NULL', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'not_found' });
  const s = await latest(g.id), b = s?.breakdown, ok = b?.raw?.mam >= 10; // suppression: mẫu nhỏ thì không công khai biểu đồ
  const history = (await q('SELECT snap_date d, activity, welcoming, overall FROM score_snapshots WHERE guild_id=? AND scoring_version=? ORDER BY snap_date DESC LIMIT 90', [g.id, VERSION])).reverse();
  const r = b?.raw;
  res.json({ guild: g, history,
    score: s && { activity: s.activity, welcoming: s.welcoming, overall: s.overall, confidence: s.confidence, percentile: s.percentile, status: s.ranking_status, computed_at: s.computed_at,
      weights: b.weights, components: { activity: b.activity, welcoming: b.welcoming },
      welcome: { eligibleNew: r.eligibleNew, responseRate: r.welcomeResponseRate, medianMin: r.firstResponseMedianMin, p90Min: r.firstResponseP90Min, d7Rate: r.d7Rate } },
    daily: ok ? await daily(g.id, 90) : null, heat: ok ? b.heat : null });
}));

// ---- Admin API (chỉ người có Manage Server ở server đó) ----
const member = (req, res, next) => {
  const s = sess(req);
  if (!s) return res.status(401).json({ error: 'login' });
  if (!s.guilds.some((g) => g.id === req.params.id)) return res.status(403).json({ error: 'forbidden' });
  req.s = s; next();
};
const mine = (req, res, next) => {
  const s = sess(req);
  if (!s) return res.status(401).json({ error: 'login' });
  if (!s.guilds.some((g) => g.id === req.params.id && g.can_manage)) return res.status(403).json({ error: 'manage_server_required' });
  req.s = s; next();
};
const admin = (req, res, next) => {
  const s = sess(req);
  if (!s) return res.status(401).json({ error: 'login' });
  if (!ADMIN_IDS.has(s.id)) return res.status(403).json({ error: 'admin_only' });
  req.s = s; next();
};

app.get('/api/admin/guilds', A(async (req, res) => {
  const s = sess(req);
  if (!s) return res.status(401).json({ error: 'login' });
  const ids = s.guilds.map((g) => g.id);
  const have = ids.length ? await q('SELECT id,bot_present FROM guilds WHERE id IN (?)', [ids]) : [];
  const m = new Map(have.map((r) => [r.id, r]));
  res.json({ user: { id: s.id, name: s.name }, guilds: s.guilds.map((g) => ({ ...g, ...(m.get(g.id) || { bot_present: 0 }),
    invite: g.can_manage ? `https://discord.com/oauth2/authorize?client_id=${CID}&scope=bot%20applications.commands&permissions=1024&guild_id=${g.id}&disable_guild_select=true` : null })) });
}));

app.get('/api/my/guilds/:id', member, A(async (req, res) => {
  const [g] = await q('SELECT id,name,icon,description,categories,language,invite_url,bot_present FROM guilds WHERE id=?', [req.params.id]);
  const base = req.s.guilds.find((x) => x.id === req.params.id);
  if (!base) return res.status(403).json({ error: 'forbidden' });
  if (!g) return res.json({ guild: { ...base, bot_present: 0 }, ranking: false, score: null, history: [], daily: null, heat: null });
  const s = await latest(g.id), b = s?.breakdown, ok = b?.raw?.mam >= 10;
  res.json({ guild: g, ranking: !!g.bot_present, score: s && {
    activity: s.activity, welcoming: s.welcoming, overall: s.overall, confidence: s.confidence,
    percentile: s.percentile, status: s.ranking_status, computed_at: s.computed_at, weights: b.weights,
    components: { activity: b.activity, welcoming: b.welcoming },
    welcome: { eligibleNew: b.raw.eligibleNew, responseRate: b.raw.welcomeResponseRate, medianMin: b.raw.firstResponseMedianMin, p90Min: b.raw.firstResponseP90Min, d7Rate: b.raw.d7Rate },
  }, history: (await q('SELECT snap_date d, activity, welcoming, overall FROM score_snapshots WHERE guild_id=? AND scoring_version=? ORDER BY snap_date DESC LIMIT 90', [g.id, VERSION])).reverse(),
  daily: ok ? await daily(g.id, 90) : null, heat: ok ? b.heat : null });
}));

app.get('/api/admin/overview', admin, A(async (req, res) => {
  const [counts] = await q(`SELECT
    COUNT(*) total,
    SUM(bot_present=1) connected,
    SUM(bot_present=1) tracking,
    SUM(bot_present=0) paused,
    SUM(bot_present=1) public_count
    FROM guilds WHERE deleted_at IS NULL`);
  const [events] = await q('SELECT COUNT(*) total FROM events WHERE ts>=?', [new Date(Date.now() - 864e5)]);
  const history = await q(`SELECT day, SUM(messages) messages, SUM(replies) replies,
      COUNT(DISTINCT guild_id) active_servers
    FROM daily_metrics WHERE day>=? GROUP BY day ORDER BY day`, [new Date(Date.now() - 30 * 864e5)]);
  const [recent] = await q(`SELECT g.id,g.name,g.bot_present,g.enabled,g.paused,g.last_heartbeat,
      s.overall,s.activity,s.welcoming,s.confidence,s.ranking_status status
    FROM guilds g LEFT JOIN score_snapshots s ON s.guild_id=g.id AND s.scoring_version=? AND s.snap_date=(
      SELECT MAX(snap_date) FROM score_snapshots WHERE guild_id=g.id AND scoring_version=?)
    WHERE g.deleted_at IS NULL ORDER BY g.last_heartbeat DESC LIMIT 500`, [VERSION, VERSION]);
  const auditRows = await q('SELECT id,guild_id,actor_id,action,created_at FROM audit_logs ORDER BY id DESC LIMIT 30');
  const adjustments = await q(`SELECT a.id,a.guild_id,a.points,a.reason,a.actor_id,a.created_at,g.name
    FROM score_adjustments a LEFT JOIN guilds g ON g.id=a.guild_id ORDER BY a.id DESC LIMIT 100`);
  res.json({ user: { id: req.s.id, name: req.s.name }, counts: { ...counts, events24h: events.total },
    history, settings: await settings(), guilds: recent, adjustments, audit: auditRows });
}));

app.patch('/api/admin/settings', admin, A(async (req, res) => {
  const allowed = ['public_leaderboard', 'public_profiles', 'public_methodology'];
  const updates = Object.entries(req.body || {}).filter(([key, value]) => allowed.includes(key) && typeof value === 'boolean');
  if (!updates.length) return res.status(400).json({ error: 'empty' });
  for (const [key, value] of updates) {
    await q('INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)', [key, value ? 1 : 0, req.s.id]);
  }
  await audit(null, req.s.id, 'system_settings', updates.map(([key]) => key));
  res.json({ settings: await settings() });
}));

app.post('/api/admin/guilds/:id/adjustment', admin, A(async (req, res) => {
  const points = Number(req.body?.points), reason = String(req.body?.reason || '').trim().slice(0, 255);
  if (!Number.isFinite(points) || points === 0 || points < -100 || points > 100 || !reason) {
    return res.status(400).json({ error: 'invalid_adjustment' });
  }
  const [g] = await q('SELECT id FROM guilds WHERE id=?', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'not_found' });
  await q('INSERT INTO score_adjustments (guild_id,points,reason,actor_id) VALUES (?,?,?,?)', [g.id, points, reason, req.s.id]);
  await audit(g.id, req.s.id, 'score_adjustment', { points, reason });
  res.json({ ok: true });
}));

app.get('/api/admin/guilds/:id', mine, A(async (req, res) => {
  const [g] = await q('SELECT * FROM guilds WHERE id=?', [req.params.id]);
  if (!g || !g.bot_present) return res.status(404).json({ error: 'bot_missing' });
  const [h] = await q('SELECT COUNT(*) n FROM events WHERE guild_id=? AND ts>=?', [g.id, new Date(Date.now() - 864e5)]);
  res.json({ guild: g, score: await latest(g.id), daily: await daily(g.id, 30), health: { events24h: h.n, lastHeartbeat: g.last_heartbeat } });
}));

app.patch('/api/admin/guilds/:id/config', mine, A(async (req, res) => {
  const [g] = await q('SELECT channels FROM guilds WHERE id=?', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'bot_missing' });
  const b = req.body || {}, set = [], p = [], put = (c, v) => { set.push(`${c}=?`); p.push(v); };
  if ('description' in b) put('description', String(b.description || '').slice(0, 500));
  if (/^[a-z]{2,8}$/.test(b.language || '')) put('language', b.language);
  if (Array.isArray(b.categories)) put('categories', JSON.stringify(b.categories.filter((c) => CATS.includes(c)).slice(0, 3)));
  if ('invite_url' in b) {
    const u = String(b.invite_url || '');
    if (u && !/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/.test(u)) return res.status(400).json({ error: 'invite_url' });
    put('invite_url', u || null);
  }
  if ('selected_channels' in b) { // null = tất cả kênh; ngược lại chỉ nhận id kênh có thật
    const ok = new Set((g.channels || []).map((c) => c.id));
    put('selected_channels', Array.isArray(b.selected_channels) ? JSON.stringify(b.selected_channels.filter((id) => ok.has(id))) : null);
  }
  set.push('is_public=1');
  if (!set.length) return res.status(400).json({ error: 'empty' });
  await q(`UPDATE guilds SET ${set.join(', ')} WHERE id=?`, [...p, req.params.id]);
  await audit(req.params.id, req.s.id, 'config', Object.keys(b));
  res.json({ ok: true });
}));

app.listen(PORT, () => console.log(`Web: ${BASE_URL}`));
setTimeout(runJobs, 10e3);
setInterval(runJobs, (+process.env.JOB_INTERVAL_MIN || 60) * 6e4);
