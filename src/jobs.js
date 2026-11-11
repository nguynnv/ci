import { q } from './db.js';
import { computeGuild, VERSION } from './scoring.js';

let busy = false;

// Tính daily metrics + snapshot điểm (1 snapshot/guild/ngày, có version) + percentile + dọn event hết hạn
export async function runJobs() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date(), today = now.toISOString().slice(0, 10);
    const gs = await q('SELECT id, consented_at FROM guilds WHERE enabled=1 AND paused=0 AND deleted_at IS NULL AND bot_present=1 AND consented_at IS NOT NULL');
    for (const g of gs) {
      try {
        const r = await computeGuild(g, now);
        const from = new Date(g.consented_at).toISOString().slice(0, 10);
        const d = r.daily.slice(-3).filter((x) => x.day >= from)
          .map((x) => [g.id, x.day, x.unique_active, x.messages, x.sessions, x.replies, x.joins, x.leaves]);
        if (d.length) await q('INSERT INTO daily_metrics (guild_id,day,unique_active,messages,sessions,replies,joins,leaves) VALUES ? ON DUPLICATE KEY UPDATE unique_active=VALUES(unique_active), messages=VALUES(messages), sessions=VALUES(sessions), replies=VALUES(replies), joins=VALUES(joins), leaves=VALUES(leaves)', [d]);
        await q(`INSERT INTO score_snapshots (guild_id,scoring_version,snap_date,window_start,window_end,activity,welcoming,overall,confidence,ranking_status,breakdown,computed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE window_start=VALUES(window_start), window_end=VALUES(window_end), activity=VALUES(activity), welcoming=VALUES(welcoming), overall=VALUES(overall), confidence=VALUES(confidence), ranking_status=VALUES(ranking_status), breakdown=VALUES(breakdown), computed_at=VALUES(computed_at)`,
          [g.id, VERSION, today, new Date(+now - 30 * 864e5), now, r.activity, r.welcoming, r.overall, r.confidence, r.status, JSON.stringify(r.breakdown), now]);
      } catch (e) { console.error('[jobs] guild', g.id, e); }
    }
    await percentiles(today);
    await q('DELETE FROM events WHERE expires_at < ?', [now]);
  } catch (e) { console.error('[jobs]', e); } finally { busy = false; }
}

// Percentile = % server cùng nhóm (category đầu tiên + ngôn ngữ) có điểm ≤ điểm này. Nhóm <5 server → không xếp. Review → ẩn.
async function percentiles(today) {
  const rows = await q(`SELECT s.id, s.ranking_status st, COALESCE(s.overall, s.activity) sc, g.categories c, g.language l
    FROM score_snapshots s JOIN guilds g ON g.id=s.guild_id WHERE s.snap_date=? AND s.scoring_version=? AND g.enabled=1`, [today, VERSION]);
  const grp = new Map();
  for (const r of rows) { const k = `${r.c?.[0] ?? 'other'}|${r.l}`; (grp.get(k) ?? grp.set(k, []).get(k)).push(r); }
  for (const list of grp.values()) {
    const ok = list.filter((r) => r.sc != null && r.st !== 'review').map((r) => Number(r.sc));
    for (const r of list) {
      const p = ok.length >= 5 && r.sc != null && r.st !== 'review'
        ? Math.round((1000 * ok.filter((x) => x <= Number(r.sc)).length) / ok.length) / 10 : null;
      await q('UPDATE score_snapshots SET percentile=? WHERE id=?', [p, r.id]);
    }
  }
}
