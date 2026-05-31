// server.js — خادم Cognita (Express + PostgreSQL)
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { q, init, uid } from "./db.js";
import { hashPassword, verifyPassword, signToken, authMiddleware } from "./auth.js";
import { genKey, entitlementFor } from "./licenses.js";
import { BRAND, PRICING, PAYMENT } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "public");
const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUB, { extensions: ["html"] }));

const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: "خطأ في الخادم." });
});
const publicUser = (u) => ({ id: u.id, email: u.email, plan: u.plan, licenseKey: u.license_key, expiresAt: u.expires_at });
const entOf = (u) => entitlementFor({ plan: u.plan, expiresAt: u.expires_at });

// ===== الصحة والإعدادات العامة =====
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "cognita-server", version: "1.2.0" }));
app.get("/api/config", (_req, res) => res.json({ brand: BRAND, pricing: PRICING, payment: PAYMENT }));

// ===== المصادقة =====
app.post("/api/auth/register", ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6)
    return res.status(400).json({ error: "البريد وكلمة مرور (6 أحرف على الأقل) مطلوبة." });
  const exists = await q("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
  if (exists.rowCount) return res.status(400).json({ error: "البريد مسجّل مسبقاً." });
  const u = { id: uid(), email, passHash: hashPassword(password), createdAt: Date.now() };
  await q("INSERT INTO users(id,email,pass_hash,plan,created_at) VALUES($1,$2,$3,'free',$4)",
    [u.id, u.email, u.passHash, u.createdAt]);
  await q("INSERT INTO sync_data(user_id,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [u.id, Date.now()]);
  res.json({ token: signToken(u), user: { id: u.id, email: u.email, plan: "free", expiresAt: null } });
}));

app.post("/api/auth/login", ah(async (req, res) => {
  const { email, password } = req.body || {};
  const r = await q("SELECT * FROM users WHERE lower(email)=lower($1)", [email || ""]);
  const u = r.rows[0];
  if (!u || !verifyPassword(password || "", u.pass_hash))
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// ===== الحساب والصلاحية =====
app.get("/api/me", authMiddleware, ah(async (req, res) => {
  const r = await q("SELECT * FROM users WHERE id=$1", [req.auth.id]);
  const u = r.rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  res.json({ user: publicUser(u), entitlement: entOf(u) });
}));

app.get("/api/license/validate", authMiddleware, ah(async (req, res) => {
  const r = await q("SELECT * FROM users WHERE id=$1", [req.auth.id]);
  if (!r.rowCount) return res.status(404).json({ error: "المستخدم غير موجود." });
  res.json(entOf(r.rows[0]));
}));

app.post("/api/license/activate", authMiddleware, ah(async (req, res) => {
  const key = String((req.body || {}).key || "").trim().toUpperCase();
  const lr = await q("SELECT * FROM licenses WHERE key=$1", [key]);
  const lic = lr.rows[0];
  if (!lic) return res.status(400).json({ error: "مفتاح ترخيص غير صالح." });
  if (lic.used_by && lic.used_by !== req.auth.id)
    return res.status(400).json({ error: "هذا المفتاح مُستخدَم على حساب آخر." });
  const now = Date.now();
  const activatedAt = lic.activated_at || now;
  const expiresAt = lic.days ? activatedAt + lic.days * 864e5 : null;
  await q("UPDATE licenses SET used_by=$1, activated_at=$2, expires_at=$3 WHERE key=$4",
    [req.auth.id, activatedAt, expiresAt, key]);
  await q("UPDATE users SET plan=$1, license_key=$2, expires_at=$3 WHERE id=$4",
    [lic.tier === "pro" ? "pro" : "free", key, expiresAt, req.auth.id]);
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  res.json(entOf(u));
}));

// ===== المزامنة (Pro) =====
app.post("/api/sync/push", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "المزامنة متاحة في خطة Pro فقط." });
  const { prompts = [], flows = [], searches = [] } = req.body || {};
  await q(`INSERT INTO sync_data(user_id,prompts,flows,searches,updated_at)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT (user_id) DO UPDATE SET prompts=$2, flows=$3, searches=$4, updated_at=$5`,
    [u.id, JSON.stringify(prompts), JSON.stringify(flows), JSON.stringify(searches), Date.now()]);
  res.json({ ok: true });
}));

app.get("/api/sync/pull", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "المزامنة متاحة في خطة Pro فقط." });
  const r = await q("SELECT prompts,flows,searches FROM sync_data WHERE user_id=$1", [u.id]);
  res.json(r.rows[0] || { prompts: [], flows: [], searches: [] });
}));

// ===== طلب ترقية (دفع يدوي) =====
app.post("/api/orders", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  const { plan = "pro", cycle = "monthly", amount = "", reference = "", note = "" } = req.body || {};
  const id = uid();
  await q(`INSERT INTO license_requests(id,user_id,email,plan,cycle,amount,reference,note,status,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
    [id, u.id, u.email, plan, cycle, String(amount), String(reference), String(note), Date.now()]);
  res.json({ ok: true, id });
}));

// ===== الإدارة =====
function admin(req, res, next) {
  if (!ADMIN_TOKEN || req.headers["x-admin-token"] !== ADMIN_TOKEN)
    return res.status(401).json({ error: "رمز إدارة غير صحيح." });
  next();
}

app.post("/api/admin/licenses", admin, ah(async (req, res) => {
  const { tier = "pro", days = 365, count = 1 } = req.body || {};
  const keys = [];
  for (let i = 0; i < Math.min(Number(count) || 1, 200); i++) {
    const key = genKey();
    await q("INSERT INTO licenses(key,tier,days,created_at) VALUES($1,$2,$3,$4)",
      [key, tier === "pro" ? "pro" : "free", Number(days) || null, Date.now()]);
    keys.push(key);
  }
  res.json({ keys });
}));

app.get("/api/admin/requests", admin, ah(async (req, res) => {
  const r = await q("SELECT * FROM license_requests ORDER BY created_at DESC LIMIT 200");
  res.json({ requests: r.rows });
}));

app.post("/api/admin/requests/:id/fulfill", admin, ah(async (req, res) => {
  const { days = 365 } = req.body || {};
  const rr = await q("SELECT * FROM license_requests WHERE id=$1", [req.params.id]);
  const reqRow = rr.rows[0];
  if (!reqRow) return res.status(404).json({ error: "الطلب غير موجود." });
  const key = genKey();
  await q("INSERT INTO licenses(key,tier,days,created_at) VALUES($1,'pro',$2,$3)",
    [key, Number(days) || 365, Date.now()]);
  await q("UPDATE license_requests SET status='fulfilled', issued_key=$1 WHERE id=$2", [key, req.params.id]);
  res.json({ key, email: reqRow.email });
}));

// ===== صفحات الموقع (روابط نظيفة) =====
for (const p of ["app", "pricing", "privacy", "terms", "contact"]) {
  app.get("/" + p, (_req, res) => res.sendFile(path.join(PUB, p + ".html")));
}
app.get("/", (_req, res) => res.sendFile(path.join(PUB, "index.html")));

init()
  .then(() => app.listen(PORT, () => console.log(`Cognita server يعمل على المنفذ ${PORT}`)))
  .catch((e) => { console.error("فشل تهيئة قاعدة البيانات:", e.message); process.exit(1); });
