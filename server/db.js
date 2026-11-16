const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DSX_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'dsx.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL,
    pass_hash   TEXT NOT NULL,
    salt        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL
  );

  -- One row per (user, asset). USD is the cash asset.
  -- amount = total held, locked = reserved by open limit orders, avg_cost = average USD cost per unit.
  CREATE TABLE IF NOT EXISTS balances (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset     TEXT NOT NULL,
    amount    REAL NOT NULL DEFAULT 0,
    locked    REAL NOT NULL DEFAULT 0,
    avg_cost  REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, asset)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    side         TEXT NOT NULL CHECK (side IN ('buy','sell')),
    type         TEXT NOT NULL CHECK (type IN ('market','limit')),
    qty          REAL NOT NULL,
    limit_price  REAL,
    status       TEXT NOT NULL CHECK (status IN ('open','filled','cancelled')),
    fill_price   REAL,
    fee          REAL NOT NULL DEFAULT 0,
    realized_pnl REAL,
    reserved     REAL NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(status, symbol);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
`);

/** Run fn inside a transaction; rolls back on throw. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, tx };
