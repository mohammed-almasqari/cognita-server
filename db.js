// db.js — طبقة PostgreSQL (عبر مكتبة pg)
import pg from "pg";
const { Pool } = pg;

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: process.env.PGDATABASE || "cognita",
        ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
      }
);
pool.on("error", (e) => console.error("PG pool error:", e.message));

export const q = (text, params) => pool.query(text, params);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function createTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free', license_key TEXT, expires_at BIGINT,
      created_at BIGINT NOT NULL
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_at BIGINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY, tier TEXT NOT NULL, days INTEGER, used_by TEXT,
      activated_at BIGINT, expires_at BIGINT, created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_data (
      user_id TEXT PRIMARY KEY, prompts JSONB NOT NULL DEFAULT '[]',
      flows JSONB NOT NULL DEFAULT '[]', searches JSONB NOT NULL DEFAULT '[]', updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, number TEXT, user_id TEXT NOT NULL, email TEXT,
      type TEXT NOT NULL DEFAULT 'subscription', plan TEXT, cycle TEXT,
      amount TEXT, currency TEXT, method TEXT NOT NULL DEFAULT 'bank_transfer',
      reference TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'unpaid',
      issued_key TEXT, created_at BIGINT NOT NULL, paid_at BIGINT
    );
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pp_order_id TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS coupon TEXT;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      user_id TEXT NOT NULL, ym TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, updated_at BIGINT,
      PRIMARY KEY (user_id, ym)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY, percent INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true, expires_at BIGINT, created_at BIGINT NOT NULL
    );
  `);
}

export async function getSettings() {
  const r = await q("SELECT data FROM settings WHERE id=1");
  return r.rows[0]?.data || null;
}
export async function saveSettings(data) {
  await q(
    `INSERT INTO settings(id, data) VALUES(1, $1)
     ON CONFLICT (id) DO UPDATE SET data=$1`,
    [JSON.stringify(data)]
  );
  return data;
}

// إعادة المحاولة عند الإقلاع لتحمّل تأخّر جاهزية قاعدة البيانات
export async function init() {
  const tries = Number(process.env.DB_INIT_RETRIES || 15);
  for (let i = 1; i <= tries; i++) {
    try {
      await createTables();
      console.log("✓ تم تهيئة قاعدة بيانات PostgreSQL");
      return;
    } catch (e) {
      const msg = e && (e.message || e.code) ? (e.message || e.code) : String(e);
      console.warn(`محاولة الاتصال بقاعدة البيانات ${i}/${tries} فشلت: ${msg}`);
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
