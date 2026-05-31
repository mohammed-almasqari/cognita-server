// server.js — خادم Cognita (Express + PostgreSQL) — منصة كاملة مع لوحة أدمن وفوترة
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { q, init, uid, getSettings, saveSettings } from "./db.js";
import { hashPassword, verifyPassword, signToken, authMiddleware, adminAuth, seedAdmin } from "./auth.js";
import { genKey, entitlementFor } from "./licenses.js";
import { BRAND, PRICING, PAYMENT } from "./config.js";
import { callModel as proxyCall } from "./models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "public");
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUB, { extensions: ["html"] }));

const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: "خطأ في الخادم." });
});
const publicUser = (u) => ({ id: u.id, email: u.email, plan: u.plan, licenseKey: u.license_key, expiresAt: u.expires_at, isAdmin: !!u.is_admin });
const entOf = (u) => entitlementFor({ plan: u.plan, expiresAt: u.expires_at });

// إعدادات فعّالة = الافتراضي + ما يحفظه المشرف
const DEFAULTS = { brand: BRAND, pricing: PRICING, payment: PAYMENT };
async function effConfig() {
  const saved = await getSettings();
  if (!saved) return DEFAULTS;
  return {
    brand: { ...DEFAULTS.brand, ...(saved.brand || {}) },
    pricing: { ...DEFAULTS.pricing, ...(saved.pricing || {}) },
    payment: { ...DEFAULTS.payment, ...(saved.payment || {}) },
  };
}
async function priceFor(plan, cycle) {
  const c = await effConfig();
  const p = c.pricing.plans?.[plan] || c.pricing.plans?.pro || { monthly: 29 };
  return { amount: String(p[cycle] ?? p.monthly), currency: c.pricing.currencyLabel || c.pricing.currency || "SAR" };
}
// إعدادات وكيل النماذج (سرّية — لا تُعرض في /api/config العام)
async function proxyConfig() {
  const s = await getSettings();
  const p = (s && s.proxy) || {};
  return {
    enabled: p.enabled !== false,
    defaultProvider: p.defaultProvider || "openai",
    models: p.models || {},
    providerKeys: p.providerKeys || { openai: "", anthropic: "", gemini: "" },
    limits: { pro: Number(p.limits?.pro ?? 1000), free: Number(p.limits?.free ?? 0) },
  };
}
const ym = () => new Date().toISOString().slice(0, 7);

// ===== عام =====
app.get("/api/health", (_q, r) => r.json({ ok: true, service: "cognita-server", version: "1.3.0" }));
app.get("/api/config", ah(async (_q, r) => r.json(await effConfig())));

// ===== المصادقة =====
app.post("/api/auth/register", ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) return res.status(400).json({ error: "البريد وكلمة مرور (6 أحرف على الأقل) مطلوبة." });
  if ((await q("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email])).rowCount) return res.status(400).json({ error: "البريد مسجّل مسبقاً." });
  const u = { id: uid(), email, ph: hashPassword(password), t: Date.now() };
  await q("INSERT INTO users(id,email,pass_hash,plan,created_at) VALUES($1,$2,$3,'free',$4)", [u.id, u.email, u.ph, u.t]);
  await q("INSERT INTO sync_data(user_id,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [u.id, u.t]);
  res.json({ token: signToken({ id: u.id, email: u.email, is_admin: false }), user: { id: u.id, email: u.email, plan: "free", expiresAt: null, isAdmin: false } });
}));
app.post("/api/auth/login", ah(async (req, res) => {
  const { email, password } = req.body || {};
  const u = (await q("SELECT * FROM users WHERE lower(email)=lower($1)", [email || ""])).rows[0];
  if (!u || !verifyPassword(password || "", u.pass_hash)) return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// تشخيص آمن: يكشف البريد المُهيّأ وطول كلمة المرور (دون كشف كلمة المرور) لتأكيد التطابق
app.get("/api/admin/diag", (_req, res) => {
  const AE = (process.env.ADMIN_EMAIL || "").trim(), AP = (process.env.ADMIN_PASSWORD || "").trim();
  res.json({
    adminEmailConfigured: !!AE,
    adminEmail: AE || null,
    adminPasswordConfigured: !!AP,
    adminPasswordLength: AP.length,
  });
});

// دخول المشرف: يتحقّق مباشرةً من متغيّري البيئة ويُنشئ/يُصلح حساب المشرف لحظياً (مضمون)
app.post("/api/admin/login", ah(async (req, res) => {
  const { email, password } = req.body || {};
  const AE = (process.env.ADMIN_EMAIL || "").trim(), AP = (process.env.ADMIN_PASSWORD || "").trim();
  if (!AE || !AP) return res.status(500).json({ error: "لم تُضبط ADMIN_EMAIL/ADMIN_PASSWORD على الخادم." });
  if (String(email || "").trim().toLowerCase() !== AE.toLowerCase() || String(password || "").trim() !== AP)
    return res.status(401).json({ error: "بيانات دخول المشرف غير صحيحة." });
  let u = (await q("SELECT * FROM users WHERE lower(email)=lower($1)", [AE])).rows[0];
  if (!u) {
    const id = uid();
    await q("INSERT INTO users(id,email,pass_hash,plan,is_admin,created_at) VALUES($1,$2,$3,'pro',true,$4)", [id, AE, hashPassword(AP), Date.now()]);
    await q("INSERT INTO sync_data(user_id,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, Date.now()]);
    u = (await q("SELECT * FROM users WHERE id=$1", [id])).rows[0];
  } else if (!u.is_admin) {
    await q("UPDATE users SET is_admin=true WHERE id=$1", [u.id]); u.is_admin = true;
  }
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// ===== الحساب والصلاحية =====
app.get("/api/me", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  res.json({ user: publicUser(u), entitlement: entOf(u) });
}));
app.get("/api/license/validate", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  res.json(entOf(u));
}));
app.post("/api/license/activate", authMiddleware, ah(async (req, res) => {
  const key = String((req.body || {}).key || "").trim().toUpperCase();
  const lic = (await q("SELECT * FROM licenses WHERE key=$1", [key])).rows[0];
  if (!lic) return res.status(400).json({ error: "مفتاح ترخيص غير صالح." });
  if (lic.used_by && lic.used_by !== req.auth.id) return res.status(400).json({ error: "هذا المفتاح مُستخدَم على حساب آخر." });
  const now = Date.now(), activatedAt = lic.activated_at || now;
  const expiresAt = lic.days ? activatedAt + lic.days * 864e5 : null;
  await q("UPDATE licenses SET used_by=$1, activated_at=$2, expires_at=$3 WHERE key=$4", [req.auth.id, activatedAt, expiresAt, key]);
  await q("UPDATE users SET plan=$1, license_key=$2, expires_at=$3 WHERE id=$4", [lic.tier === "pro" ? "pro" : "free", key, expiresAt, req.auth.id]);
  res.json(entOf((await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0]));
}));

// ===== المزامنة (Pro) =====
app.post("/api/sync/push", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "المزامنة متاحة في خطة Pro فقط." });
  const { prompts = [], flows = [], searches = [] } = req.body || {};
  await q(`INSERT INTO sync_data(user_id,prompts,flows,searches,updated_at) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT (user_id) DO UPDATE SET prompts=$2,flows=$3,searches=$4,updated_at=$5`,
    [u.id, JSON.stringify(prompts), JSON.stringify(flows), JSON.stringify(searches), Date.now()]);
  res.json({ ok: true });
}));
app.get("/api/sync/pull", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "المزامنة متاحة في خطة Pro فقط." });
  res.json((await q("SELECT prompts,flows,searches FROM sync_data WHERE user_id=$1", [u.id])).rows[0] || { prompts: [], flows: [], searches: [] });
}));

// ===== وكيل النماذج المركزي (Pro) =====
app.post("/api/model/proxy", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "وكيل النماذج متاح في خطة Pro فقط." });
  const cfg = await proxyConfig();
  if (!cfg.enabled) return res.status(403).json({ error: "وكيل النماذج غير مُفعّل على الخادم." });
  const provider = (req.body?.provider) || cfg.defaultProvider;
  const key = cfg.providerKeys[provider];
  if (!key) return res.status(400).json({ error: "لم يُضبط مفتاح هذا المزوّد في الخادم." });
  const m = ym();
  const used = Number((await q("SELECT count FROM usage_log WHERE user_id=$1 AND ym=$2", [u.id, m])).rows[0]?.count || 0);
  const limit = cfg.limits.pro;
  if (limit && used >= limit) return res.status(429).json({ error: `تجاوزت حد الاستخدام الشهري (${limit} طلب).` });
  let text;
  try {
    text = await proxyCall({ provider, model: req.body?.model || cfg.models[provider], system: req.body?.system, user: req.body?.user || "", temperature: req.body?.temperature });
  } catch (e) { return res.status(502).json({ error: "خطأ من مزوّد النموذج: " + (e.message || "") }); }
  await q(`INSERT INTO usage_log(user_id,ym,count,updated_at) VALUES($1,$2,1,$3)
           ON CONFLICT (user_id,ym) DO UPDATE SET count=usage_log.count+1, updated_at=$3`, [u.id, m, Date.now()]);
  res.json({ text, usage: used + 1, limit });
}));

// ===== الفوترة (العميل) =====
async function createInvoice(user, { type = "subscription", plan = "pro", cycle = "monthly", note = "" }) {
  const { amount, currency } = await priceFor(plan, cycle);
  const id = uid();
  await q(`INSERT INTO invoices(id,number,user_id,email,type,plan,cycle,amount,currency,method,note,status,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'bank_transfer',$10,'unpaid',$11)`,
    [id, "INV-" + id.toUpperCase(), user.id, user.email, type, plan, cycle, amount, currency, String(note || ""), Date.now()]);
  return (await q("SELECT * FROM invoices WHERE id=$1", [id])).rows[0];
}
app.post("/api/orders", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  const { plan = "pro", cycle = "monthly", note = "" } = req.body || {};
  const inv = await createInvoice(u, { type: "subscription", plan, cycle, note });
  res.json({ ok: true, invoice: inv, payment: (await effConfig()).payment });
}));
app.post("/api/subscription/renew", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  const { cycle = "monthly" } = req.body || {};
  const inv = await createInvoice(u, { type: "renewal", plan: "pro", cycle });
  res.json({ ok: true, invoice: inv, payment: (await effConfig()).payment });
}));
app.get("/api/invoices/mine", authMiddleware, ah(async (req, res) => {
  res.json({ invoices: (await q("SELECT * FROM invoices WHERE user_id=$1 ORDER BY created_at DESC", [req.auth.id])).rows });
}));
app.post("/api/invoices/:id/reference", authMiddleware, ah(async (req, res) => {
  const { reference = "", note = "" } = req.body || {};
  await q("UPDATE invoices SET reference=$1, note=$2 WHERE id=$3 AND user_id=$4",
    [String(reference), String(note), req.params.id, req.auth.id]);
  res.json({ ok: true });
}));

// ===== الإدارة =====
app.get("/api/admin/stats", adminAuth, ah(async (_q, res) => {
  const customers = (await q("SELECT COUNT(*) c FROM users WHERE is_admin=false")).rows[0].c;
  const unpaid = (await q("SELECT COUNT(*) c FROM invoices WHERE status='unpaid'")).rows[0].c;
  const paid = (await q("SELECT COUNT(*) c FROM invoices WHERE status='paid'")).rows[0].c;
  const active = (await q("SELECT COUNT(*) c FROM users WHERE plan='pro' AND (expires_at IS NULL OR expires_at > $1)", [Date.now()])).rows[0].c;
  const revenueRows = (await q("SELECT amount FROM invoices WHERE status='paid'")).rows;
  const revenue = revenueRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  res.json({ customers: +customers, invoicesUnpaid: +unpaid, invoicesPaid: +paid, activeSubs: +active, revenue });
}));
app.get("/api/admin/customers", adminAuth, ah(async (_q, res) => {
  res.json({ customers: (await q("SELECT id,email,plan,expires_at,is_admin,created_at FROM users ORDER BY created_at DESC LIMIT 500")).rows });
}));
app.post("/api/admin/customers/:id", adminAuth, ah(async (req, res) => {
  const { plan, expiresAt } = req.body || {};
  await q("UPDATE users SET plan=COALESCE($1,plan), expires_at=COALESCE($2,expires_at) WHERE id=$3", [plan ?? null, expiresAt ?? null, req.params.id]);
  res.json({ ok: true });
}));
app.get("/api/admin/invoices", adminAuth, ah(async (_q, res) => {
  res.json({ invoices: (await q("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 500")).rows });
}));
app.post("/api/admin/invoices/:id/pay", adminAuth, ah(async (req, res) => {
  const inv = (await q("SELECT * FROM invoices WHERE id=$1", [req.params.id])).rows[0];
  if (!inv) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  const days = Number((req.body || {}).days) || (inv.cycle === "lifetime" ? null : inv.cycle === "annual" ? 365 : 30);
  const now = Date.now();
  const key = genKey();
  await q("INSERT INTO licenses(key,tier,days,used_by,activated_at,expires_at,created_at) VALUES($1,'pro',$2,$3,$4,$5,$4)",
    [key, days, inv.user_id, now, days ? now + days * 864e5 : null]);
  const expiresAt = days ? now + days * 864e5 : null;
  await q("UPDATE users SET plan='pro', license_key=$1, expires_at=$2 WHERE id=$3", [key, expiresAt, inv.user_id]);
  await q("UPDATE invoices SET status='paid', issued_key=$1, paid_at=$2 WHERE id=$3", [key, now, inv.id]);
  res.json({ ok: true, key });
}));
app.post("/api/admin/invoices/:id/cancel", adminAuth, ah(async (req, res) => {
  await q("UPDATE invoices SET status='canceled' WHERE id=$1", [req.params.id]); res.json({ ok: true });
}));
app.get("/api/admin/settings", adminAuth, ah(async (_q, res) => {
  const eff = await effConfig(), p = await proxyConfig();
  const maskedKeys = Object.fromEntries(Object.entries(p.providerKeys).map(([k, v]) => [k, v ? "•••• " + String(v).slice(-4) : ""]));
  res.json({ ...eff, proxy: { ...p, providerKeys: maskedKeys } });
}));
app.post("/api/admin/settings", adminAuth, ah(async (req, res) => {
  const cur = await effConfig(), curProxy = await proxyConfig();
  // دمج إعدادات الوكيل: لا نكتب فوق المفتاح إلا إذا أُرسلت قيمة جديدة حقيقية (غير مُقنّعة)
  let proxy = curProxy;
  if (req.body?.proxy) {
    const inp = req.body.proxy, keys = { ...curProxy.providerKeys };
    for (const k of ["openai", "anthropic", "gemini"]) {
      const v = inp.providerKeys?.[k];
      if (typeof v === "string") {
        if (v && !v.includes("••")) keys[k] = v.trim();
        else if (v === "") keys[k] = "";
      }
    }
    proxy = {
      enabled: inp.enabled !== undefined ? !!inp.enabled : curProxy.enabled,
      defaultProvider: inp.defaultProvider || curProxy.defaultProvider,
      models: { ...curProxy.models, ...(inp.models || {}) },
      providerKeys: keys,
      limits: { pro: Number(inp.limits?.pro ?? curProxy.limits.pro), free: Number(inp.limits?.free ?? curProxy.limits.free) },
    };
  }
  const next = {
    brand: { ...cur.brand, ...(req.body?.brand || {}) },
    pricing: { ...cur.pricing, ...(req.body?.pricing || {}) },
    payment: { ...cur.payment, ...(req.body?.payment || {}) },
    proxy,
  };
  await saveSettings(next);
  res.json({ ok: true });
}));
app.get("/api/admin/usage", adminAuth, ah(async (_q, res) => {
  const m = ym();
  const rows = (await q(
    `SELECT u.email, l.count FROM usage_log l JOIN users u ON u.id=l.user_id WHERE l.ym=$1 ORDER BY l.count DESC LIMIT 200`, [m]
  )).rows;
  res.json({ ym: m, total: rows.reduce((s, r) => s + Number(r.count), 0), users: rows });
}));
app.post("/api/admin/licenses", adminAuth, ah(async (req, res) => {
  const { tier = "pro", days = 365, count = 1 } = req.body || {};
  const keys = [];
  for (let i = 0; i < Math.min(Number(count) || 1, 200); i++) {
    const key = genKey();
    await q("INSERT INTO licenses(key,tier,days,created_at) VALUES($1,$2,$3,$4)", [key, tier === "pro" ? "pro" : "free", Number(days) || null, Date.now()]);
    keys.push(key);
  }
  res.json({ keys });
}));

// ===== صفحات الموقع =====
for (const p of ["app", "admin", "pricing", "privacy", "terms", "contact", "docs"])
  app.get("/" + p, (_q, res) => res.sendFile(path.join(PUB, p + ".html")));
app.get("/", (_q, res) => res.sendFile(path.join(PUB, "index.html")));

init()
  // تهيئة حساب المشرف لا يجب أن تُسقط الخادم إن فشلت — نُسجّل تحذيراً ونُكمل
  .then(() => seedAdmin().catch((e) => console.warn("⚠️ تعذّر تهيئة حساب المشرف:", e && (e.message || e.code) ? (e.message || e.code) : e)))
  .then(() => app.listen(PORT, () => console.log(`Cognita server يعمل على المنفذ ${PORT}`)))
  .catch((e) => { console.error("فشل تهيئة قاعدة البيانات:", e && (e.message || e.code) ? (e.message || e.code) : e); process.exit(1); });
