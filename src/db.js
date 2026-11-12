import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

export const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, timezone: 'Z', connectionLimit: 10,
});
export const q = async (sql, p) => (await pool.query(sql, p))[0];

// Băm user id theo từng server: không theo dõi được người dùng xuyên server, không lưu mapping ngược
export const pseudo = (guildId, userId) =>
  crypto.createHmac('sha256', process.env.PSEUDONYM_SECRET).update(`${guildId}:${userId}`).digest('hex').slice(0, 24);

export const audit = (guildId, actor, action, meta = null) =>
  q('INSERT INTO audit_logs (guild_id, actor_id, action, meta) VALUES (?,?,?,?)', [guildId, actor, action, meta && JSON.stringify(meta)]);

export async function unlinkGuild(id, actor) {
  for (const t of ['events', 'daily_metrics', 'score_snapshots']) await q(`DELETE FROM ${t} WHERE guild_id=?`, [id]);
  await q('UPDATE guilds SET enabled=0, paused=0, is_public=0, consented_at=NULL, deleted_at=? WHERE id=?', [new Date(), id]);
  await audit(id, actor, 'unlink');
}

// ---- Công tắc tính năng (admin bật/tắt). "off" = ẩn hẳn: không menu, API trả 404 ----
export const SETTING_VALUES = {
  leaderboard: ['off', 'managers', 'public'],
  public_profiles: ['off', 'managers', 'public'],
  show_percentile: ['off', 'on'],
};
const DEF = { leaderboard: 'public', public_profiles: 'public', show_percentile: 'on' };
export const getSettings = async () => ({ ...DEF, ...Object.fromEntries((await q('SELECT k, v FROM settings')).map((r) => [r.k, r.v])) });
export const setSetting = (k, v) => q('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, v]);
