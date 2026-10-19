const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const rootDir = path.resolve(__dirname, '../..');
const databasePath = process.env.DATABASE_PATH || path.join(rootDir, 'data', 'taskora.db');
const resolvedPath = path.isAbsolute(databasePath) ? databasePath : path.resolve(rootDir, databasePath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new Database(resolvedPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  db.prepare('INSERT OR IGNORE INTO _migrations (id) VALUES (1)').run();
}

migrate();

function transaction(fn) {
  return db.transaction(fn)();
}

module.exports = { db, migrate, transaction, databasePath: resolvedPath };
