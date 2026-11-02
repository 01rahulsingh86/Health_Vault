const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { dataDir } = require('./config');

fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
const db = new Database(path.join(dataDir, 'vault.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  doctor_name TEXT NOT NULL DEFAULT '',
  lab_name TEXT NOT NULL DEFAULT '',
  facility_name TEXT NOT NULL DEFAULT '',
  facility_address TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL DEFAULT '[]',
  file_name TEXT, file_mime TEXT, file_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, date DESC);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS record_files (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_record ON record_files(record_id, position);
`);
const recordCols = db.prepare('PRAGMA table_info(records)').all().map((c) => c.name);
for (const col of ['notes', 'doctor_name', 'lab_name', 'facility_name', 'facility_address']) {
  if (!recordCols.includes(col)) db.exec(`ALTER TABLE records ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
}
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const col of ['plan', 'ai_usage', 'ai_usage_month']) {
  if (!userCols.includes(col)) {
    if (col === 'plan') db.exec('ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT \"free\"');
    else if (col === 'ai_usage') db.exec('ALTER TABLE users ADD COLUMN ai_usage INTEGER NOT NULL DEFAULT 0');
    else db.exec('ALTER TABLE users ADD COLUMN ai_usage_month TEXT NOT NULL DEFAULT \"\"');
  }
}
// migrate v1 single-file records
for (const r of db.prepare('SELECT id, file_name, file_mime, file_path FROM records WHERE file_path IS NOT NULL').all()) {
  if (!db.prepare('SELECT 1 FROM record_files WHERE record_id = ?').get(r.id)) {
    db.prepare('INSERT INTO record_files (id, record_id, name, mime, path, position) VALUES (?,?,?,?,?,0)')
      .run(require('crypto').randomUUID(), r.id, r.file_name || 'report', r.file_mime, r.file_path);
  }
}

module.exports = db;
