// db.js — طبقة PostgreSQL (عبر مكتبة pg)
import pg from "pg";
const { Pool } = pg;

// يدعم DATABASE_URL (يوفّره Coolify) أو متغيّرات PG* المنفصلة.
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

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// تهيئة المخطّط تلقائياً عند الإقلاع
async function createTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      pass_hash   TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free',
      license_key TEXT,
      expires_at  BIGINT,
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS licenses (
      key          TEXT PRIMARY KEY,
      tier         TEXT NOT NULL,
      days         INTEGER,
      used_by      TEXT,
      activated_at BIGINT,
      expires_at   BIGINT,
      created_at   BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_data (
      user_id   TEXT PRIMARY KEY,
      prompts   JSONB NOT NULL DEFAULT '[]',
      flows     JSONB NOT NULL DEFAULT '[]',
      searches  JSONB NOT NULL DEFAULT '[]',
      updated_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS license_requests (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      email      TEXT,
      plan       TEXT,
      cycle      TEXT,
      amount     TEXT,
      reference  TEXT,
      note       TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      issued_key TEXT,
      created_at BIGINT NOT NULL
    );
  `);
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
