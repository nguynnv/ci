import { q } from './db.js';
import { computeGuild, VERSION } from './scoring.js';

export const jobState = { running: false, lastStart: null, lastEnd: null, lastMs: null, guilds: 0, errors: 0, lastError: null };
const dayStr = (d) => d.toISOString().slice(0, 10);

async function processGuild(g, now) {
  const r = await computeGuild(g, now), from = dayStr(new Date(g.consented_at));
  const [adjustment] = await q('SELECT COALESCE(SUM(delta),0) total FROM score_adjustments WHERE guild_id=?', [g.id]);
  if (r.overall != null) r.overall = Math.max(0, Math.min(100, Math.round((r.overall + Number(adjustment.total)) * 10) / 10));
  const d = r.daily.slice(-3).filter((x) => x.day >= from).map((x) => [g.id, x.day, x.unique_active, x.messages, x.sessions, x.replies, x.joins, x.leaves]);
  if (d.length) await q('INSERT INTO daily_metrics (guild_id,day,unique_active,messages,sessions,replies,joins,leaves) VALUES ? ON DUPLICATE KEY UPDATE unique_active=VALUES(unique_active), messages=VALUES(messages), sessions=VALUES(sessions), replies=VALUES(replies), joins=VALUES(joins), leaves=VALUES(leaves)', [d]);
  await q(`INSERT INTO score_snapshots (guild_id,scoring_version,snap_date,window_start,window_end,activity,welcoming,overall,confidence,ranking_status,breakdown,computed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE window_start=VALUES(window_start), window_end=VALUES(window_end), activity=VALUES(activity), welcoming=VALUES(welcoming), overall=VALUES(overall), confidence=VALUES(confidence), ranking_status=VALUES(ranking_status), breakdown=VALUES(breakdown), computed_at=VALUES(computed_at)`,
    [g.id, VERSION, dayStr(now), new Date(+now - 30 * 864e5), now, r.activity, r.welcoming, r.overall, r.confidence, r.status, JSON.stringify({ ...r.breakdown, manualAdjustment: Number(adjustment.total) }), now]);
}

// Admin chỉ được "tính lại" điểm, không có đường nào sửa trực tiếp điểm số
export async function recomputeGuild(id) {
  const [g] = await q('SELECT id, consented_at FROM guilds WHERE id=? AND consented_at IS NOT NULL AND bot_present=1', [id]);
  if (!g) throw new Error('not_tracked');
  const now = new Date();
  await processGuild(g, now); await percentiles(dayStr(now));
}

export async function runJobs() {
  if (jobState.running) return;
  Object.assign(jobState, { running: true, lastStart: new Date(), errors: 0, lastError: null });
  try {
    const now = new Date();
    const gs = await q('SELECT id, consented_at FROM guilds WHERE enabled=1 AND blocked=0 AND deleted_at IS NULL AND bot_present=1 AND consented_at IS NOT NULL');
    jobState.guilds = gs.length;
    for (const g of gs) {
      try { await processGuild(g, now); } catch (e) { jobState.errors++; jobState.lastError = `${g.id}: ${e.message}`; console.error('[jobs] guild', g.id, e); }
    }
    await percentiles(dayStr(now));
    await q('DELETE FROM events WHERE expires_at < ?', [now]);
  } catch (e) { jobState.errors++; jobState.lastError = e.message; console.error('[jobs]', e); }
  finally { Object.assign(jobState, { running: false, lastEnd: new Date() }); jobState.lastMs = jobState.lastEnd - jobState.lastStart; }
}

// Percentile so với TẤT CẢ server đang tính điểm (không chia nhóm). <5 server → chưa xếp. Review/ẩn/khóa → loại.
async function percentiles(today) {
  const rows = await q(`SELECT s.id, s.ranking_status st, COALESCE(s.overall, s.activity) sc FROM score_snapshots s JOIN guilds g ON g.id=s.guild_id
    WHERE s.snap_date=? AND s.scoring_version=? AND g.enabled=1 AND g.hidden=0 AND g.blocked=0`, [today, VERSION]);
  const ok = rows.filter((r) => r.sc != null && r.st !== 'review').map((r) => Number(r.sc));
  for (const r of rows) {
    const p = ok.length >= 5 && r.sc != null && r.st !== 'review' ? Math.round((1000 * ok.filter((x) => x <= Number(r.sc)).length) / ok.length) / 10 : null;
    await q('UPDATE score_snapshots SET percentile=? WHERE id=?', [p, r.id]);
  }
}
