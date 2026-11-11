import fs from 'node:fs';
import { pool } from './db.js';

const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
for (const s of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
console.log('Đã tạo schema.');
process.exit(0);
