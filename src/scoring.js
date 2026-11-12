import { q } from './db.js';

export const VERSION = 'v1'; // activity_v1 / welcoming_v1 / overall_v1
export const WEIGHTS = {
  activity: { U: 0.2, F: 0.15, Q: 0.25, C: 0.2, D: 0.1, T: 0.1 },
  welcoming: { R: 0.25, F: 0.2, C: 0.2, D7: 0.2, D: 0.1, V: 0.05 },
  overall: { activity: 0.6, welcoming: 0.4 },
};

const DAY = 864e5, MIN = 6e4;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lin = (x, lo, hi) => 100 * clamp((x - lo) / (hi - lo)); // threshold scoring
const logs = (x, lo, hi) => lin(Math.log10(Math.max(x, 1e-9)), Math.log10(lo), Math.log10(hi)); // log scaling
const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const quant = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const rc = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]));
// Thiếu dữ liệu ≠ 0: bỏ thành phần null và chuẩn hóa lại trọng số; cần ≥60% trọng số mới ra điểm
const combine = (w, c) => { let s = 0, t = 0; for (const k in w) if (c[k] != null) { s += w[k] * c[k]; t += w[k]; } return t >= 0.6 ? s / t : null; };

export async function computeGuild(g, now = new Date()) {
  const N = +now, since = N - 30 * DAY;
  const tracked = clamp(Math.ceil((N - +new Date(g.consented_at)) / DAY), 1, 30);
  const [rows, [cv]] = await Promise.all([
    q('SELECT type, ts, channel_key ch, actor_key a, target_key t, is_reply r FROM events WHERE guild_id=? AND ts>=? AND ts<=? ORDER BY ts', [g.id, new Date(since), now]),
    q('SELECT COUNT(*) total, COALESCE(SUM(day>=?),0) recent FROM daily_metrics WHERE guild_id=?', [dayKey(since), g.id]),
  ]);
  const obsDays = Number(cv.total);
  const coverage = clamp((Number(cv.recent) + 1) / tracked); // +1: hôm nay chưa có dòng

  // ---- 1. Gom event: loại spam lặp <3s, dựng ngày / phiên / cạnh tương tác ----
  const days = new Map();
  for (let i = 29; i >= 0; i--) { const d = dayKey(N - i * DAY); days.set(d, { day: d, actors: new Set(), messages: 0, sessions: 0, replies: 0, joins: 0, leaves: 0 }); }
  const msgs = [], joins = new Map(), lastSeen = new Map();
  for (const e of rows) {
    const ms = +e.ts, d = days.get(dayKey(ms));
    if (e.type === 'join') { if (!joins.has(e.a)) joins.set(e.a, ms); if (d) d.joins++; continue; }
    if (e.type === 'leave') { if (d) d.leaves++; continue; }
    const k = `${e.a}|${e.ch}`, p = lastSeen.get(k);
    if (p !== undefined && ms - p < 3000) continue;
    lastSeen.set(k, ms);
    msgs.push({ ms, ch: e.ch, a: e.a, t: e.t, r: e.r });
    if (d) { d.actors.add(e.a); d.messages++; if (e.r) d.replies++; }
  }
  const M = msgs.length, dl = [...days.values()];

  const sessions = [], cur = new Map(); // phiên = cùng kênh, khoảng cách ≤10 phút
  const perActor = new Map(), perCh = new Map(), hourCnt = Array(24).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const edges = new Map(), byA = new Map(), byT = new Map();
  let replies = 0;
  for (const m of msgs) {
    let s = cur.get(m.ch);
    if (!s || m.ms - s.last > 10 * MIN) { s = { start: m.ms, last: m.ms, authors: new Set(), n: 0 }; cur.set(m.ch, s); sessions.push(s); }
    s.last = m.ms; s.authors.add(m.a); s.n++;
    perActor.set(m.a, (perActor.get(m.a) || 0) + 1);
    perCh.set(m.ch, (perCh.get(m.ch) || 0) + 1);
    const dt = new Date(m.ms); hourCnt[dt.getUTCHours()]++; heat[dt.getUTCDay()][dt.getUTCHours()]++;
    if (m.r) replies++;
    if (m.t) { const k = `${m.a}>${m.t}`; edges.set(k, (edges.get(k) || 0) + 1); }
    (byA.get(m.a) ?? byA.set(m.a, []).get(m.a)).push(m);
    if (m.t) (byT.get(m.t) ?? byT.set(m.t, []).get(m.t)).push(m);
  }
  for (const s of sessions) { const d = days.get(dayKey(s.start)); if (d) d.sessions++; }

  const mam = perActor.size;
  const memberDays = dl.reduce((s, d) => s + d.actors.size, 0);
  const topShare = M ? Math.max(0, ...perActor.values()) / M : 0;
  const topCh = M ? Math.max(0, ...perCh.values()) : 0;
  const pairs = new Set(); let recip = 0;
  for (const k of edges.keys()) {
    const [a, t] = k.split('>'), pk = a < t ? `${a}|${t}` : `${t}|${a}`;
    if (pairs.has(pk)) continue;
    pairs.add(pk);
    if (edges.has(`${t}>${a}`)) recip++;
  }
  let H = 0; const tot = [...edges.values()].reduce((s, x) => s + x, 0);
  for (const c of edges.values()) H -= (c / tot) * Math.log(c / tot);

  // ---- 2. Community Activity (A) ----
  const enough = mam >= 10 && M >= 100;
  const hist = dl.slice(-tracked), act = {};
  if (enough) {
    act.U = 0.5 * logs(mam, 5, 300) + 0.5 * lin(memberDays / mam, 1, 6); // log-scaled, không thưởng tổng member
    act.F = logs(sessions.length / tracked, 0.5, 40);
    const multi = sessions.filter((s) => s.authors.size > 1 && s.n >= 3).length / (sessions.length || 1);
    act.Q = avg([lin(replies / M, 0.05, 0.45), pairs.size >= 5 ? lin(recip / pairs.size, 0.02, 0.3) : null, lin(multi, 0.1, 0.6)]);
    if (tracked >= 7) {
      const v = hist.map((d) => d.actors.size), mu = avg(v);
      act.C = mu ? 100 * (1 - clamp(Math.sqrt(avg(v.map((x) => (x - mu) ** 2))) / mu - 0.2)) : null; // CV 0.2→100, 1.2→0
    }
    act.D = edges.size >= 10 ? lin(H / Math.log(edges.size), 0.6, 0.95) : null; // normalized entropy
    act.T = avg([lin(hourCnt.filter((c) => c / M >= 0.02).length, 3, 12), lin(1 - topCh / M, 0, 0.5)]);
  }
  const A = enough ? combine(WEIGHTS.activity, act) : null;

  // ---- 3. Welcoming (W): cohort tham gia 9–30 ngày trước, để đủ cửa sổ quan sát D7 ----
  const cohort = [...joins].filter(([, ts]) => ts >= since && ts <= N - 9 * DAY);
  let responded = 0, conv = 0, d7 = 0;
  const firsts = [], divs = [];
  for (const [m, t0] of cohort) {
    // lời chào đủ điều kiện: người thật khác (không phải người mới hơn) trả lời/nhắc tới trong 7 ngày
    const recv = (byT.get(m) || []).filter((x) => x.ms >= t0 && x.ms <= t0 + 7 * DAY && x.a !== m && !(joins.get(x.a) > t0));
    const mine = byA.get(m) || [];
    if (recv.length) {
      responded++; firsts.push((recv[0].ms - t0) / MIN); divs.push(new Set(recv.map((x) => x.a)).size);
      if (mine.some((x) => x.ms > recv[0].ms && x.ms <= t0 + 7 * DAY)) conv++; // trao đổi hai chiều
    }
    if (mine.some((x) => x.ms >= t0 + 6 * DAY && x.ms < t0 + 9 * DAY)) d7++; // D7 = hoạt động trong ngày 6–8
  }
  const nC = cohort.length, med = quant(firsts, 0.5);
  const wel = {
    R: nC ? lin(responded / nC, 0, 0.9) : null,
    F: responded >= 5 ? 100 - logs(med, 10, 1440) : null, // ≤10 phút = 100, ≥24h = 0
    C: nC ? lin(conv / nC, 0.05, 0.5) : null,
    D7: nC ? lin(d7 / nC, 0.05, 0.45) : null,
    D: responded >= 5 ? lin(quant(divs, 0.5), 1, 4) : null,
    V: coverage * 100,
  };
  const W = nC >= 10 ? combine(WEIGHTS.welcoming, wel) : null;
  const O = A != null && W != null ? WEIGHTS.overall.activity * A + WEIGHTS.overall.welcoming * W : null;

  // ---- 4. Anomaly + Confidence + trạng thái ----
  const flags = [];
  if (tracked >= 16) {
    const hs = hist.slice(0, -2).map((d) => d.messages), y = hist.at(-2).messages, mu = avg(hs);
    const sd = Math.sqrt(avg(hs.map((x) => (x - mu) ** 2)));
    if (mu > 0 && y > 3 * mu && (y - mu) / (sd || 1) > 4) flags.push('spike');
  }
  if (mam >= 10 && topShare > 0.5) flags.push('concentration'); // chỉ chẩn đoán, không hạ hạng
  const conf = 100 * Math.pow(clamp(obsDays / 60) * clamp(Math.sqrt(M / 1000)) * coverage * (flags.includes('spike') ? 0.6 : 1), 0.25);
  const status = obsDays + 1 < 2 ? 'collecting' : flags.includes('spike') ? 'review' : coverage < 0.7 ? 'limited'
    : obsDays >= 60 && O != null && conf >= 60 ? 'ranked' : 'provisional';

  return {
    activity: r1(A), welcoming: r1(W), overall: r1(O), confidence: r1(conf), status, flags,
    daily: dl.map((d) => ({ day: d.day, unique_active: d.actors.size, messages: d.messages, sessions: d.sessions, replies: d.replies, joins: d.joins, leaves: d.leaves })),
    breakdown: {
      weights: WEIGHTS, activity: rc(act), welcoming: rc(wel), flags, obsDays, coverage: r1(coverage * 100),
      raw: {
        mam, messages: M, sessions: sessions.length, replyRate: M ? r1((100 * replies) / M) : null, topMemberShare: r1(100 * topShare),
        eligibleNew: nC, welcomeResponseRate: nC ? r1((100 * responded) / nC) : null, firstResponseMedianMin: r1(med),
        firstResponseP90Min: r1(quant(firsts, 0.9)), d7Rate: nC ? r1((100 * d7) / nC) : null,
      },
      heat, channels: [...perCh].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, share: r1((100 * n) / M) })),
    },
  };
}
