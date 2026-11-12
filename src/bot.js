import 'dotenv/config';
import { Client, GatewayIntentBits as I, ChannelType as CT, Events, MessageType, PermissionFlagsBits as P, SlashCommandBuilder } from 'discord.js';
import { q, pseudo, audit } from './db.js';

const TTL = (+process.env.EVENT_TTL_DAYS || 35) * 864e5;
const BASE = process.env.BASE_URL || 'http://localhost:3000';
// Chỉ cần Guilds + GuildMembers (privileged) + GuildMessages. KHÔNG xin Message Content: bot không đọc nội dung.
const client = new Client({ intents: [I.Guilds, I.GuildMembers, I.GuildMessages] });

let cfg = new Map();
const loadCfg = async () => {
  const rows = await q('SELECT id, enabled, paused, blocked, selected_channels sel FROM guilds WHERE bot_present=1');
  cfg = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) if (r.blocked) client.guilds.cache.get(r.id)?.leave().catch(() => {}); // admin khóa → bot rời server
};
const on = (id) => { const c = cfg.get(id); return c?.enabled && !c.paused ? c : null; };

// ---- buffer → INSERT IGNORE theo event_id (idempotent khi retry/reconnect) ----
let buf = [];
const flush = async () => {
  if (!buf.length) return;
  const rows = buf; buf = [];
  try {
    await q('INSERT IGNORE INTO events (event_id,guild_id,type,ts,channel_key,actor_key,target_key,is_reply,expires_at) VALUES ?',
      [rows.map((e) => [e.id, e.guild, e.type, e.ts, e.ch ?? null, e.actor, e.target ?? null, e.reply ? 1 : 0, new Date(+e.ts + TTL)])]);
  } catch (err) { console.error('flush lỗi', err.message); if (buf.length < 20000) buf = rows.concat(buf); }
};
const push = (e) => { buf.push(e); if (buf.length >= 500) flush(); };

client.on(Events.MessageCreate, (m) => {
  if (!m.guildId || m.author.bot || m.webhookId || m.system) return;
  if (m.type !== MessageType.Default && m.type !== MessageType.Reply) return;
  const c = on(m.guildId), ch = m.channel.isThread() ? m.channel.parentId : m.channelId;
  if (!c || (c.sel && !c.sel.includes(ch))) return;
  const ref = m.reference?.messageId;
  const other = m.mentions.repliedUser ?? (ref && m.channel.messages.cache.get(ref)?.author) ?? m.mentions.users.find((u) => !u.bot);
  const target = other && !other.bot && other.id !== m.author.id ? pseudo(m.guildId, other.id) : null;
  push({ id: `m:${m.id}`, guild: m.guildId, type: 'message', ts: new Date(m.createdTimestamp), ch, actor: pseudo(m.guildId, m.author.id), target, reply: !!ref });
});
client.on(Events.GuildMemberAdd, (mem) => {
  if (mem.user.bot || !on(mem.guild.id)) return;
  const ts = mem.joinedTimestamp ?? Date.now(), actor = pseudo(mem.guild.id, mem.id);
  push({ id: `j:${mem.guild.id}:${actor}:${ts}`, guild: mem.guild.id, type: 'join', ts: new Date(ts), actor });
});
client.on(Events.GuildMemberRemove, (mem) => {
  if (mem.user.bot || !on(mem.guild.id)) return;
  const actor = pseudo(mem.guild.id, mem.id), ts = Date.now();
  push({ id: `l:${mem.guild.id}:${actor}:${ts}`, guild: mem.guild.id, type: 'leave', ts: new Date(ts), actor });
});

// ---- đồng bộ server / kênh (kênh dùng cho lựa chọn phạm vi đo trên dashboard) ----
const syncGuild = async (g) => {
  await q('INSERT INTO guilds (id,name,icon,bot_present) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name), icon=VALUES(icon), bot_present=1', [g.id, g.name, g.icon]);
  const ch = g.channels.cache.filter((c) => [CT.GuildText, CT.GuildAnnouncement, CT.GuildForum].includes(c.type)).map((c) => ({ id: c.id, name: c.name }));
  await q('UPDATE guilds SET channels=? WHERE id=?', [JSON.stringify(ch), g.id]);
};
// Server vừa thêm bot: tự động tham gia xếp hạng và báo công khai trong server
const notice = () => `unzi đã tham gia bảng xếp hạng server này. Bot chỉ ghi metadata (thời điểm, kênh, mã băm một chiều của người gửi), **không đọc nội dung tin nhắn**.\nMuốn dừng thu thập, quản trị viên chỉ cần kick bot khỏi server. Dùng \`/ci privacy\` để xem chi tiết. Dashboard: ${BASE}`;
const onJoin = async (g) => {
  await syncGuild(g);
  const [r] = await q('SELECT blocked FROM guilds WHERE id=?', [g.id]);
  if (r?.blocked) return g.leave();
  await q('UPDATE guilds SET enabled=1, deleted_at=NULL, consented_at=COALESCE(consented_at, ?) WHERE id=?', [new Date(), g.id]);
  g.systemChannel?.send(notice()).catch(() => {});
  await loadCfg();
};
let isReady = false;
client.on(Events.GuildCreate, (g) => { if (isReady) onJoin(g).catch(console.error); });
client.on(Events.GuildDelete, async (g) => {
  if (g.unavailable) return;
  await q('UPDATE guilds SET bot_present=0 WHERE id=?', [g.id]);
  await loadCfg();
});

// ---- lệnh /ci ----
const cmd = new SlashCommandBuilder().setName('ci').setDescription('Community Intelligence').setDMPermission(false);
for (const [n, d] of [['setup', 'Mở dashboard để cấu hình'], ['status', 'Tình trạng bot và dữ liệu'], ['report', 'Điểm gần nhất'],
  ['privacy', 'Dữ liệu được thu thập']]) cmd.addSubcommand((s) => s.setName(n).setDescription(d));

const f = (v) => (v == null ? 'chưa đủ dữ liệu' : Number(v).toFixed(1));
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'ci') return;
  const sub = i.options.getSubcommand(), gid = i.guildId;
  const say = (content) => i.reply({ content, flags: 64 });
  if (sub !== 'report' && sub !== 'privacy' && !i.memberPermissions?.has(P.ManageGuild)) return say('Lệnh này cần quyền Manage Server.');
  try {
    if (sub === 'setup') return say(`Hồ sơ và cấu hình server: ${BASE}/#/server/${gid}`);
    if (sub === 'privacy') return say('**Thu thập:** thời điểm, kênh, mã băm một chiều của tác giả và người được trả lời/nhắc tới, loại tin (thường/reply), sự kiện vào/rời server.\n**Không thu thập:** nội dung tin nhắn, file, DM, hoạt động ở server khác. Bot không đọc nội dung (không dùng Message Content intent). Event tự xóa sau ' + TTL / 864e5 + ' ngày; chỉ giữ số liệu tổng hợp.');
    if (sub === 'status') {
      const [g] = await q('SELECT enabled, paused, last_heartbeat FROM guilds WHERE id=?', [gid]);
      const [{ n }] = await q('SELECT COUNT(*) n FROM events WHERE guild_id=? AND ts>=?', [gid, new Date(Date.now() - 864e5)]);
      return say(`Thu thập: **${g?.enabled ? (g.paused ? 'đang tạm dừng' : 'đang bật') : 'chưa bật (chạy /ci setup)'}**\nSự kiện 24 giờ qua: **${n}**\nBot báo cáo lần cuối: ${g?.last_heartbeat ? `<t:${Math.floor(+new Date(g.last_heartbeat) / 1000)}:R>` : 'chưa có'}`);
    }
    if (sub === 'report') {
      const [s] = await q('SELECT * FROM score_snapshots WHERE guild_id=? ORDER BY snap_date DESC LIMIT 1', [gid]);
      if (!s) return say('Chưa có điểm. Server cần bật thu thập và đợi lần tính đầu tiên.');
      return say(`**Hoạt động:** ${f(s.activity)}\n**Đón người mới:** ${f(s.welcoming)}\n**Tổng hợp:** ${f(s.overall)}\n**Độ tin cậy dữ liệu:** ${f(s.confidence)}\n**Percentile:** ${s.percentile ?? 'chưa xếp'}\n**Trạng thái:** ${s.ranking_status}\nChi tiết: ${BASE}/#/server/${gid}`);
    }
  } catch (e) { console.error(e); say('Có lỗi xảy ra, thử lại sau.').catch(() => {}); }
});

client.once(Events.ClientReady, async () => {
  await client.application.commands.set([cmd.toJSON()]);
  const known = new Set((await q('SELECT id FROM guilds')).map((r) => r.id));
  for (const g of client.guilds.cache.values()) await (known.has(g.id) ? syncGuild(g) : onJoin(g)); // server thêm bot lúc bot offline cũng được tự theo dõi
  await loadCfg();
  isReady = true;
  setInterval(loadCfg, 30e3);
  setInterval(flush, 5e3);
  setInterval(() => {
    const ids = [...client.guilds.cache.keys()];
    if (ids.length) q('UPDATE guilds SET bot_present=1, last_heartbeat=? WHERE id IN (?)', [new Date(), ids]);
  }, 60e3);
  setInterval(() => client.guilds.cache.forEach((g) => syncGuild(g).catch(() => {})), 10 * 60e3);
  console.log(`Bot sẵn sàng: ${client.user.tag}, ${client.guilds.cache.size} server`);
});
client.on('error', console.error);
process.on('SIGINT', async () => { await flush(); process.exit(0); });
client.login(process.env.DISCORD_TOKEN);
