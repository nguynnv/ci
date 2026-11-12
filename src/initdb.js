import fs from 'node:fs';
import { pool } from './db.js';

const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
for (const s of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) {
  try { await pool.query(s); } catch (e) { if (e.errno !== 1060) throw e; } // 1060 = cột đã có (ALTER cho DB cũ)
}
console.log('Đã tạo/cập nhật schema.');
process.exit(0);
