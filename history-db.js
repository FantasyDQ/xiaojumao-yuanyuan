// ============================================================
//  会话历史库：摘要索引表 + 原文表（SQLite via sql.js / WASM）
// ------------------------------------------------------------
//  设计要点：
//   · 摘要（turns）是索引，原文（raw）是负载 —— 原文不丢，但不进 prompt
//   · 本地存储免费，只有「注入 prompt」才花 token：存一万条也不要紧，
//     每轮只把最近 N 条摘要喂给模型
//   · 用 sql.js（WASM）而不是 better-sqlite3：后者是原生模块，Electron 的
//     ABI 跟 Node 不同，预编译二进制一加载就崩进程（实测过）。
//     sql.js 零编译，Electron 33 主进程直接可用。
//   · 没有 FTS5（sql.js 默认构建不带），用 LIKE 子串匹配做中文关键词检索。
//     几千条量级下足够；将来要 BM25/模糊检索，换 better-sqlite3 只改 init/搜索两处。
// ============================================================
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;
let db = null;
let dbPath = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  q TEXT,            -- 用户原话（意图本体）
  intent TEXT,       -- 一句话概括这轮想干什么
  points TEXT,       -- 结论要点，逗号分隔（检索命中 + 直接作答的关键）
  attachments TEXT,  -- JSON：[{name,type,size,asset,path}]
  raw_id INTEGER,    -- 指向 raw.id（原始回复）
  chars INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts);
`;

// sql.js 在 Electron 里必须显式指定 wasm 路径，否则 require 会卡死（实测）。
// 不能用 require.resolve('sql.js/package.json') —— 该包的 exports 没暴露 package.json，
// 会抛异常并退化成相对路径（实测解析到 <项目>/dist/sql-wasm.wasm）。
function wasmDir() {
  try {
    // require.resolve('sql.js') → .../node_modules/sql.js/dist/sql-wasm.js，wasm 就在同一目录
    return path.dirname(require.resolve('sql.js'));
  } catch (e) {
    return path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  }
}

async function open(file) {
  if (db) return db;
  dbPath = file;
  SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir(), f) });
  const buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
  db = buf && buf.length ? new SQL.Database(buf) : new SQL.Database();
  db.exec(SCHEMA);
  return db;
}

function isOpen() { return !!db; }

// 原子写：temp + rename。直接 writeFileSync 崩在半路会把整个库写坏。
function saveNow() {
  if (!db) return false;
  try {
    const data = Buffer.from(db.export());
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbPath);
    return true;
  } catch (e) {
    console.warn('[history-db] 落盘失败:', e.message);
    return false;
  }
}

// 延迟落盘：连续写入时合并成一次 IO
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 800);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  return saveNow();
}

// ── raw：原文 ────────────────────────────────────────────────
function addRaw(role, text, meta) {
  if (!db) return null;
  const st = db.prepare('INSERT INTO raw(role, text, meta) VALUES(?,?,?)');
  st.run([role || 'user', String(text == null ? '' : text), meta ? JSON.stringify(meta) : null]);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  save();
  return id;
}

function getRaw(id) {
  if (!db) return null;
  const r = db.exec(`SELECT id, role, text, meta FROM raw WHERE id = ${Number(id) || 0}`);
  if (!r.length || !r[0].values.length) return null;
  const [rid, role, text, meta] = r[0].values[0];
  return { id: rid, role, text, meta: meta ? safeJson(meta) : null };
}

// ── turns：摘要索引 ──────────────────────────────────────────
function addTurn(t) {
  if (!db) return null;
  const st = db.prepare('INSERT INTO turns(ts,q,intent,points,attachments,raw_id,chars) VALUES(?,?,?,?,?,?,?)');
  st.run([
    t.ts || new Date().toISOString(),
    String(t.q || ''),
    String(t.intent || ''),
    Array.isArray(t.points) ? t.points.join('，') : String(t.points || ''),
    t.attachments ? JSON.stringify(t.attachments) : null,
    t.rawId || null,
    Number(t.chars) || 0,
  ]);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  save();
  return id;
}

function rowToTurn(row) {
  const [id, ts, q, intent, points, attachments, rawId, chars] = row;
  return {
    id, ts, q, intent,
    points: points ? String(points).split('，').filter(Boolean) : [],
    attachments: attachments ? safeJson(attachments) : [],
    rawId, chars,
  };
}

// 最近 N 条摘要（不带原文）—— 这是每轮注入 prompt 的那部分
function recentTurns(n = 30) {
  if (!db) return [];
  const r = db.exec(`SELECT id,ts,q,intent,points,attachments,raw_id,chars
                     FROM turns ORDER BY id DESC LIMIT ${Math.max(1, Number(n) || 30)}`);
  if (!r.length) return [];
  return r[0].values.map(rowToTurn).reverse();
}

function getTurn(id) {
  if (!db) return null;
  const r = db.exec(`SELECT id,ts,q,intent,points,attachments,raw_id,chars
                     FROM turns WHERE id = ${Number(id) || 0}`);
  if (!r.length || !r[0].values.length) return null;
  return rowToTurn(r[0].values[0]);
}

// 关键词检索摘要：LIKE 子串匹配（中文够用，见文件头说明）
function searchTurns(keyword, limit = 10) {
  if (!db || !keyword) return [];
  const kw = String(keyword).replace(/[%_\\]/g, (m) => '\\' + m);   // 转义 LIKE 通配符
  const sql = `SELECT id,ts,q,intent,points,attachments,raw_id,chars FROM turns
               WHERE q LIKE ? ESCAPE '\\' OR intent LIKE ? ESCAPE '\\'
                     OR points LIKE ? ESCAPE '\\' OR attachments LIKE ? ESCAPE '\\'
               ORDER BY id DESC LIMIT ${Math.max(1, Number(limit) || 10)}`;
  const like = `%${kw}%`;
  const stmt = db.prepare(sql);
  stmt.bind([like, like, like, like]);
  const out = [];
  while (stmt.step()) out.push(rowToTurn(stmt.get()));
  stmt.free();
  return out;
}

function countAll() {
  if (!db) return { turns: 0, raw: 0 };
  const t = db.exec('SELECT COUNT(*) FROM turns');
  const r = db.exec('SELECT COUNT(*) FROM raw');
  return { turns: t[0]?.values[0][0] || 0, raw: r[0]?.values[0][0] || 0 };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function close() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
  db = null;
}

module.exports = {
  open, close, isOpen, save, flush, saveNow,
  addRaw, getRaw,
  addTurn, getTurn, recentTurns, searchTurns, countAll,
};
