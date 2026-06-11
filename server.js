// server.js — خادم Cognita (Express + PostgreSQL) — منصة كاملة مع لوحة أدمن وفوترة
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { q, init, uid, getSettings, saveSettings } from "./db.js";
import { hashPassword, verifyPassword, signToken, authMiddleware, adminAuth, seedAdmin, hasStrongSecret, setSecret } from "./auth.js";
import { genKey, entitlementFor } from "./licenses.js";
import { BRAND, PRICING, PAYMENT } from "./config.js";
import { callModel as proxyCall } from "./models.js";
import { mailerStatus, notifyInvoiceCreated, notifyLicenseIssued, notifyPasswordReset, notifyRenewalReminder } from "./mailer.js";
import * as paypal from "./paypal.js";
import { randomBytes, createHash } from "crypto";
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "public");
const app = express();
const PORT = process.env.PORT || 8080;
app.set("trust proxy", 1); // خلف وكيل Coolify/Traefik — ليقرأ rate-limit عنوان IP الحقيقي

// CORS مُقيّد: الموقع نفسه + امتدادات المتصفح فقط (لا أي موقع عشوائي)
const SITE_ORIGIN = (process.env.SITE_URL || BRAND.url || "https://cognita.dalilai.net").replace(/\/+$/, "");
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // طلبات من نفس الأصل أو أدوات الخادم
    if (/^(chrome|moz)-extension:\/\//.test(origin)) return cb(null, true);
    if (origin === SITE_ORIGIN) return cb(null, true);
    return cb(null, false);
  },
}));
// ترويسات أمان أساسية
app.use((_q, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUB, { extensions: ["html"] }));

// حدود معدّل الطلبات
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: "محاولات كثيرة. حاول بعد قليل." } });
const proxyLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "طلبات كثيرة للوكيل. تمهّل قليلاً." } });
app.use(["/api/auth/login", "/api/auth/register", "/api/admin/login", "/api/auth/forgot", "/api/auth/reset"], authLimiter);

const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: "خطأ في الخادم." });
});
const publicUser = (u) => ({ id: u.id, email: u.email, plan: u.plan, licenseKey: u.license_key, expiresAt: u.expires_at, isAdmin: !!u.is_admin, trialUsed: !!u.trial_used });
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
// إعدادات الدفع الفعّالة (مع السرّ — للاستخدام الداخلي فقط)
async function paymentConfig() {
  const c = await effConfig();
  const pay = c.payment || {};
  const pp = pay.paypal || {};
  return {
    bankEnabled: pay.bankEnabled !== false,
    bankDetails: pay.bankDetails || "",
    instructions: pay.instructions || "",
    paypal: {
      enabled: !!pp.enabled, clientId: pp.clientId || "", secret: pp.secret || "",
      mode: pp.mode === "sandbox" ? "sandbox" : "live",
      currency: pp.currency || "USD", rate: Number(pp.rate || 1) || 1,
    },
  };
}
// نسخة عامة آمنة (بلا أسرار) تُرسَل في /api/config
function publicPayment(pay) {
  const pp = (pay && pay.paypal) || {};
  return {
    bankEnabled: pay?.bankEnabled !== false, bankDetails: pay?.bankDetails || "", instructions: pay?.instructions || "",
    paypal: { enabled: !!pp.enabled, mode: pp.mode === "sandbox" ? "sandbox" : "live" },
  };
}
const ym = () => new Date().toISOString().slice(0, 7);
// آخر n شهر بصيغة YYYY-MM (تصاعدياً)
function lastMonths(n = 6) {
  const out = [], d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

// ===== عام =====
app.get("/api/health", (_q, r) => r.json({ ok: true, service: "cognita-server", version: "1.3.0" }));
app.get("/api/config", ah(async (_q, r) => {
  const c = await effConfig();
  r.json({ brand: c.brand, pricing: c.pricing, payment: publicPayment(c.payment) });
}));

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

// نسيت كلمة المرور — يرسل رابطاً للبريد (لا يكشف وجود الحساب)
app.post("/api/auth/forgot", ah(async (req, res) => {
  const email = String((req.body || {}).email || "").trim();
  const u = email ? (await q("SELECT * FROM users WHERE lower(email)=lower($1)", [email])).rows[0] : null;
  if (u) {
    const tok = randomBytes(24).toString("hex");
    await q("UPDATE users SET reset_token=$1, reset_expires=$2 WHERE id=$3", [sha(tok), Date.now() + 3600000, u.id]);
    const cfg = await effConfig();
    const base = (process.env.SITE_URL || cfg.brand.url || "https://cognita.dalilai.net").replace(/\/+$/, "");
    notifyPasswordReset({ brand: cfg.brand, user: { email: u.email }, resetUrl: `${base}/reset?token=${tok}&email=${encodeURIComponent(u.email)}` }).catch(() => {});
  }
  res.json({ ok: true });
}));
app.post("/api/auth/reset", ah(async (req, res) => {
  const { email = "", token = "", password = "" } = req.body || {};
  if (String(password).length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل." });
  const u = (await q("SELECT * FROM users WHERE lower(email)=lower($1)", [String(email).trim()])).rows[0];
  if (!u || !u.reset_token || u.reset_token !== sha(token) || !u.reset_expires || Date.now() > Number(u.reset_expires))
    return res.status(400).json({ error: "رابط غير صالح أو منتهٍ. اطلب رابطاً جديداً." });
  await q("UPDATE users SET pass_hash=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2", [hashPassword(password), u.id]);
  res.json({ ok: true });
}));

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
// تصدير بيانات المستخدم (امتثال للخصوصية)
app.get("/api/me/export", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT id,email,plan,expires_at,license_key,created_at FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  const invoices = (await q("SELECT number,type,plan,cycle,amount,currency,status,created_at,paid_at FROM invoices WHERE user_id=$1", [u.id])).rows;
  const library = (await q("SELECT prompts,flows,searches,updated_at FROM sync_data WHERE user_id=$1", [u.id])).rows[0] || {};
  res.set("Content-Disposition", "attachment; filename=cognita-data.json");
  res.json({ exportedAt: Date.now(), account: u, invoices, library });
}));
// حذف الحساب نهائياً (امتثال للخصوصية)
app.post("/api/me/delete", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  if (u.is_admin) return res.status(400).json({ error: "لا يمكن حذف حساب المشرف من هنا." });
  if (!verifyPassword(String((req.body || {}).password || ""), u.pass_hash)) return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  await q("UPDATE licenses SET used_by=NULL WHERE used_by=$1", [u.id]);
  await q("DELETE FROM usage_log WHERE user_id=$1", [u.id]);
  await q("DELETE FROM sync_data WHERE user_id=$1", [u.id]);
  await q("DELETE FROM invoices WHERE user_id=$1", [u.id]);
  await q("DELETE FROM users WHERE id=$1", [u.id]);
  res.json({ ok: true });
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
app.post("/api/model/proxy", proxyLimiter, authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  if (entOf(u).plan !== "pro") return res.status(403).json({ error: "وكيل النماذج متاح في خطة Pro فقط." });
  const inLen = String(req.body?.user || "").length + String(req.body?.system || "").length;
  if (inLen > 24000) return res.status(400).json({ error: "النص طويل جداً (الحد ~24000 حرفاً)." });
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
    text = await proxyCall({ provider, key, model: req.body?.model || cfg.models[provider], system: req.body?.system, user: req.body?.user || "", temperature: req.body?.temperature });
  } catch (e) { return res.status(502).json({ error: "خطأ من مزوّد النموذج: " + (e.message || "") }); }
  await q(`INSERT INTO usage_log(user_id,ym,count,updated_at) VALUES($1,$2,1,$3)
           ON CONFLICT (user_id,ym) DO UPDATE SET count=usage_log.count+1, updated_at=$3`, [u.id, m, Date.now()]);
  res.json({ text, usage: used + 1, limit });
}));

// ===== الفوترة (العميل) =====
async function createInvoice(user, { type = "subscription", plan = "pro", cycle = "monthly", note = "", discountPercent = 0, couponCode = "" }) {
  const { amount, currency } = await priceFor(plan, cycle);
  let amt = parseFloat(amount) || 0;
  if (discountPercent > 0) amt = Math.max(0, Math.round(amt * (1 - discountPercent / 100) * 100) / 100);
  const fullNote = couponCode ? `كوبون ${couponCode} (−${discountPercent}%)${note ? " · " + note : ""}` : String(note || "");
  const id = uid();
  await q(`INSERT INTO invoices(id,number,user_id,email,type,plan,cycle,amount,currency,method,note,coupon,status,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'bank_transfer',$10,$11,'unpaid',$12)`,
    [id, "INV-" + id.toUpperCase(), user.id, user.email, type, plan, cycle, String(amt), currency, fullNote, couponCode || null, Date.now()]);
  return (await q("SELECT * FROM invoices WHERE id=$1", [id])).rows[0];
}
// إتمام الفاتورة: إصدار مفتاح + ترقية المستخدم + إشعار بريد (يُعاد استخدامه للدفع اليدوي وPayPal)
async function fulfillInvoice(inv, daysOverride) {
  const days = daysOverride != null ? daysOverride : (inv.cycle === "lifetime" ? null : inv.cycle === "annual" ? 365 : 30);
  const now = Date.now(), key = genKey();
  await q("INSERT INTO licenses(key,tier,days,used_by,activated_at,expires_at,created_at) VALUES($1,'pro',$2,$3,$4,$5,$4)",
    [key, days, inv.user_id, now, days ? now + days * 864e5 : null]);
  const expiresAt = days ? now + days * 864e5 : null;
  await q("UPDATE users SET plan='pro', license_key=$1, expires_at=$2 WHERE id=$3", [key, expiresAt, inv.user_id]);
  await q("UPDATE invoices SET status='paid', issued_key=$1, paid_at=$2 WHERE id=$3", [key, now, inv.id]);
  if (inv.coupon) await q("UPDATE coupons SET used=used+1 WHERE code=$1", [inv.coupon]).catch(() => {});
  const cfg = await effConfig();
  notifyLicenseIssued({ brand: cfg.brand, user: { email: inv.email }, key, invoice: inv }).catch(() => {});
  return key;
}
async function resolveCoupon(code) {
  if (!code) return { discountPercent: 0, couponCode: "" };
  const c = (await q("SELECT * FROM coupons WHERE lower(code)=lower($1)", [String(code).trim()])).rows[0];
  const now = Date.now();
  if (c && c.active && (!c.expires_at || Number(c.expires_at) > now) && (!c.max_uses || c.used < c.max_uses))
    return { discountPercent: c.percent, couponCode: c.code };
  return null; // غير صالح
}
app.post("/api/orders", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  const { plan = "pro", cycle = "monthly", note = "", coupon = "" } = req.body || {};
  const cp = await resolveCoupon(coupon);
  if (!cp) return res.status(400).json({ error: "كوبون غير صالح أو منتهٍ." });
  const inv = await createInvoice(u, { type: "subscription", plan, cycle, note, ...cp });
  const cfg = await effConfig();
  notifyInvoiceCreated({ brand: cfg.brand, payment: cfg.payment, user: u, invoice: inv }).catch(() => {});
  res.json({ ok: true, invoice: inv, payment: publicPayment(cfg.payment), discountPercent: cp.discountPercent });
}));
app.post("/api/subscription/renew", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  const { cycle = "monthly", coupon = "" } = req.body || {};
  const cp = await resolveCoupon(coupon);
  if (!cp) return res.status(400).json({ error: "كوبون غير صالح أو منتهٍ." });
  const inv = await createInvoice(u, { type: "renewal", plan: "pro", cycle, ...cp });
  const cfg = await effConfig();
  notifyInvoiceCreated({ brand: cfg.brand, payment: cfg.payment, user: u, invoice: inv }).catch(() => {});
  res.json({ ok: true, invoice: inv, payment: publicPayment(cfg.payment), discountPercent: cp.discountPercent });
}));
// تجربة Pro المجانية (مرّة واحدة لكل حساب)
app.post("/api/subscription/trial", authMiddleware, ah(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id=$1", [req.auth.id])).rows[0];
  if (!u) return res.status(404).json({ error: "المستخدم غير موجود." });
  const days = Number((await effConfig()).pricing.trialDays || 0);
  if (!days) return res.status(400).json({ error: "التجربة المجانية غير مُفعّلة حالياً." });
  if (u.trial_used) return res.status(400).json({ error: "استخدمت التجربة المجانية سابقاً." });
  if (entOf(u).plan === "pro") return res.status(400).json({ error: "لديك اشتراك Pro فعّال بالفعل." });
  const expiresAt = Date.now() + days * 864e5;
  await q("UPDATE users SET plan='pro', expires_at=$1, trial_used=true WHERE id=$2", [expiresAt, u.id]);
  res.json({ ok: true, plan: "pro", expiresAt, days });
}));
app.get("/api/invoices/mine", authMiddleware, ah(async (req, res) => {
  res.json({ invoices: (await q("SELECT * FROM invoices WHERE user_id=$1 ORDER BY created_at DESC", [req.auth.id])).rows });
}));
app.post("/api/invoices/:id/reference", authMiddleware, ah(async (req, res) => {
  const { reference = "", note = "", receipt = "" } = req.body || {};
  let rcpt = String(receipt || "");
  if (rcpt && !/^data:image\/(png|jpe?g|webp);base64,/i.test(rcpt)) return res.status(400).json({ error: "صيغة الإيصال غير مدعومة (PNG/JPG/WEBP)." });
  if (rcpt.length > 2000000) return res.status(400).json({ error: "حجم الإيصال كبير جداً (الحد ~1.5MB)." });
  await q("UPDATE invoices SET reference=$1, note=$2, receipt=COALESCE(NULLIF($3,''), receipt) WHERE id=$4 AND user_id=$5",
    [String(reference), String(note), rcpt, req.params.id, req.auth.id]);
  res.json({ ok: true });
}));

// ===== PayPal (تلقائي) =====
app.post("/api/invoices/:id/paypal/create", authMiddleware, ah(async (req, res) => {
  const inv = (await q("SELECT * FROM invoices WHERE id=$1 AND user_id=$2", [req.params.id, req.auth.id])).rows[0];
  if (!inv) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  if (inv.status !== "unpaid") return res.status(400).json({ error: "الفاتورة ليست معلّقة." });
  const pay = await paymentConfig(), pp = pay.paypal;
  if (!pp.enabled || !pp.clientId || !pp.secret) return res.status(400).json({ error: "الدفع عبر PayPal غير مُفعّل حالياً." });
  const amount = (parseFloat(inv.amount) || 0) * (pp.rate || 1);
  if (!(amount > 0)) return res.status(400).json({ error: "مبلغ غير صالح." });
  const origin = `${req.protocol}://${req.get("host")}`;
  const brandName = (await effConfig()).brand?.name || "Cognita";
  try {
    const order = await paypal.createOrder({
      clientId: pp.clientId, secret: pp.secret, mode: pp.mode,
      amount, currency: pp.currency, invoiceNumber: inv.number || inv.id, brandName,
      returnUrl: `${origin}/api/paypal/return`, cancelUrl: `${origin}/api/paypal/cancel`,
    });
    await q("UPDATE invoices SET pp_order_id=$1, method='paypal' WHERE id=$2", [order.id, inv.id]);
    res.json({ approveUrl: order.approveUrl });
  } catch (e) { res.status(502).json({ error: "تعذّر إنشاء طلب PayPal: " + (e.message || "") }); }
}));
app.get("/api/paypal/return", ah(async (req, res) => {
  const orderId = req.query.token;
  if (!orderId) return res.redirect("/app?payfail=1");
  const inv = (await q("SELECT * FROM invoices WHERE pp_order_id=$1", [String(orderId)])).rows[0];
  if (!inv) return res.redirect("/app?payfail=1");
  if (inv.status === "paid") return res.redirect("/app?paid=1");
  const pay = await paymentConfig(), pp = pay.paypal;
  try {
    const cap = await paypal.captureOrder({ clientId: pp.clientId, secret: pp.secret, mode: pp.mode, orderId: String(orderId) });
    if (cap.status !== "COMPLETED") return res.redirect("/app?payfail=1");
    await fulfillInvoice(inv);
    res.redirect("/app?paid=1");
  } catch (e) { console.error("paypal capture:", e.message); res.redirect("/app?payfail=1"); }
}));
app.get("/api/paypal/cancel", (_q, res) => res.redirect("/app?paycancel=1"));

// ===== الإدارة =====
app.get("/api/admin/stats", adminAuth, ah(async (_q, res) => {
  const customers = (await q("SELECT COUNT(*) c FROM users WHERE is_admin=false")).rows[0].c;
  const unpaid = (await q("SELECT COUNT(*) c FROM invoices WHERE status='unpaid'")).rows[0].c;
  const paid = (await q("SELECT COUNT(*) c FROM invoices WHERE status='paid'")).rows[0].c;
  const active = (await q("SELECT COUNT(*) c FROM users WHERE plan='pro' AND (expires_at IS NULL OR expires_at > $1)", [Date.now()])).rows[0].c;
  const revenueRows = (await q("SELECT amount FROM invoices WHERE status='paid'")).rows;
  const revenue = revenueRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  res.json({ customers: +customers, invoicesUnpaid: +unpaid, invoicesPaid: +paid, activeSubs: +active, revenue, mailer: mailerStatus() });
}));

// تحليلات للوحة الأدمن: سلاسل زمنية (آخر 6 أشهر) + توزيعات — تُحسب في Node لتجنّب فروق SQL
app.get("/api/admin/analytics", adminAuth, ah(async (_q, res) => {
  const months = lastMonths(6);
  const invs = (await q("SELECT amount,status,paid_at FROM invoices")).rows;
  const users = (await q("SELECT plan,expires_at,created_at FROM users WHERE is_admin=false")).rows;
  const usageRows = (await q("SELECT ym, SUM(count) c FROM usage_log GROUP BY ym")).rows;
  const mk = (ms) => { const t = Number(ms); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 7) : ""; };
  const z = () => Object.fromEntries(months.map((m) => [m, 0]));
  const rev = z(), subs = z(), signups = z(), usage = z();
  for (const v of invs) if (v.status === "paid" && v.paid_at) { const m = mk(v.paid_at); if (m in rev) { rev[m] += parseFloat(v.amount) || 0; subs[m] += 1; } }
  for (const u of users) { const m = mk(u.created_at); if (m in signups) signups[m] += 1; }
  for (const r of usageRows) if (r.ym in usage) usage[r.ym] = Number(r.c) || 0;
  const now = Date.now();
  const planSplit = { free: 0, pro: 0 };
  for (const u of users) { const pro = u.plan === "pro" && (!u.expires_at || Number(u.expires_at) > now); planSplit[pro ? "pro" : "free"]++; }
  const statusSplit = { unpaid: 0, paid: 0, canceled: 0 };
  for (const v of invs) statusSplit[v.status] = (statusSplit[v.status] || 0) + 1;
  res.json({
    months,
    revenue: months.map((m) => rev[m]),
    subs: months.map((m) => subs[m]),
    signups: months.map((m) => signups[m]),
    usage: months.map((m) => usage[m]),
    planSplit, statusSplit,
  });
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
  res.json({ invoices: (await q(`SELECT id,number,user_id,email,type,plan,cycle,amount,currency,method,reference,note,status,issued_key,created_at,paid_at,pp_order_id,(receipt IS NOT NULL AND receipt<>'') AS has_receipt FROM invoices ORDER BY created_at DESC LIMIT 500`)).rows });
}));
// عرض صورة الإيصال المرفق (للمشرف)
app.get("/api/admin/invoices/:id/receipt", adminAuth, ah(async (req, res) => {
  const r = (await q("SELECT receipt FROM invoices WHERE id=$1", [req.params.id])).rows[0];
  const m = r?.receipt && /^data:(image\/[a-z]+);base64,(.+)$/i.exec(r.receipt);
  if (!m) return res.status(404).json({ error: "لا إيصال مرفق." });
  res.set("Content-Type", m[1]); res.send(Buffer.from(m[2], "base64"));
}));
app.post("/api/admin/invoices/:id/pay", adminAuth, ah(async (req, res) => {
  const inv = (await q("SELECT * FROM invoices WHERE id=$1", [req.params.id])).rows[0];
  if (!inv) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  if (inv.status === "paid") return res.json({ ok: true, key: inv.issued_key });
  const daysOverride = (req.body || {}).days != null ? Number(req.body.days) : undefined;
  const key = await fulfillInvoice(inv, daysOverride);
  res.json({ ok: true, key });
}));
app.post("/api/admin/invoices/:id/cancel", adminAuth, ah(async (req, res) => {
  await q("UPDATE invoices SET status='canceled' WHERE id=$1", [req.params.id]); res.json({ ok: true });
}));
app.get("/api/admin/settings", adminAuth, ah(async (_q, res) => {
  const eff = await effConfig(), p = await proxyConfig(), pay = await paymentConfig();
  const maskedKeys = Object.fromEntries(Object.entries(p.providerKeys).map(([k, v]) => [k, v ? "•••• " + String(v).slice(-4) : ""]));
  const payOut = { ...pay, paypal: { ...pay.paypal, secret: pay.paypal.secret ? "•••• " + pay.paypal.secret.slice(-4) : "" } };
  res.json({ ...eff, payment: payOut, proxy: { ...p, providerKeys: maskedKeys } });
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
  // دمج إعدادات الدفع (مع حماية سرّ PayPal من الكتابة بقيمة مُقنّعة)
  let payment = cur.payment || {};
  if (req.body?.payment) {
    const ip = req.body.payment, curPP = (cur.payment && cur.payment.paypal) || {};
    let secret = curPP.secret || "";
    if (typeof ip.paypal?.secret === "string") {
      if (ip.paypal.secret && !ip.paypal.secret.includes("••")) secret = ip.paypal.secret.trim();
      else if (ip.paypal.secret === "") secret = "";
    }
    payment = {
      bankEnabled: ip.bankEnabled !== undefined ? !!ip.bankEnabled : (cur.payment?.bankEnabled !== false),
      bankDetails: ip.bankDetails !== undefined ? String(ip.bankDetails) : (cur.payment?.bankDetails || ""),
      instructions: ip.instructions !== undefined ? String(ip.instructions) : (cur.payment?.instructions || ""),
      paypal: {
        enabled: ip.paypal?.enabled !== undefined ? !!ip.paypal.enabled : !!curPP.enabled,
        clientId: ip.paypal?.clientId !== undefined ? String(ip.paypal.clientId).trim() : (curPP.clientId || ""),
        secret,
        mode: (ip.paypal?.mode || curPP.mode) === "sandbox" ? "sandbox" : "live",
        currency: ip.paypal?.currency !== undefined ? String(ip.paypal.currency || "USD").trim() : (curPP.currency || "USD"),
        rate: ip.paypal?.rate !== undefined ? (Number(ip.paypal.rate) || 1) : (Number(curPP.rate) || 1),
      },
    };
  }
  const raw = (await getSettings()) || {}; // نحافظ على مفاتيح داخلية مثل jwtSecret
  const next = {
    ...raw,
    brand: { ...cur.brand, ...(req.body?.brand || {}) },
    pricing: { ...cur.pricing, ...(req.body?.pricing || {}) },
    payment,
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

// ===== الكوبونات =====
app.get("/api/admin/coupons", adminAuth, ah(async (_q, res) => {
  res.json({ coupons: (await q("SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200")).rows });
}));
app.post("/api/admin/coupons", adminAuth, ah(async (req, res) => {
  const { code, percent = 10, maxUses = 0, days = 0 } = req.body || {};
  const c = String(code || "").trim().toUpperCase();
  if (!c) return res.status(400).json({ error: "أدخِل رمز الكوبون." });
  const p = Math.max(1, Math.min(100, Number(percent) || 0));
  const expires = Number(days) > 0 ? Date.now() + Number(days) * 864e5 : null;
  await q(`INSERT INTO coupons(code,percent,max_uses,active,expires_at,created_at) VALUES($1,$2,$3,true,$4,$5)
           ON CONFLICT (code) DO UPDATE SET percent=$2, max_uses=$3, expires_at=$4, active=true`,
    [c, p, Number(maxUses) || 0, expires, Date.now()]);
  res.json({ ok: true, code: c });
}));
app.post("/api/admin/coupons/:code/toggle", adminAuth, ah(async (req, res) => {
  await q("UPDATE coupons SET active=NOT active WHERE code=$1", [req.params.code]); res.json({ ok: true });
}));

// ===== تصدير CSV =====
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const toCsv = (rows, cols) => "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvEsc(r[c])).join(","))].join("\n");
app.get("/api/admin/export/customers.csv", adminAuth, ah(async (_q, res) => {
  const rows = (await q("SELECT email,plan,expires_at,is_admin,created_at FROM users ORDER BY created_at DESC")).rows;
  res.set("Content-Type", "text/csv; charset=utf-8"); res.set("Content-Disposition", "attachment; filename=customers.csv");
  res.send(toCsv(rows, ["email", "plan", "expires_at", "is_admin", "created_at"]));
}));
app.get("/api/admin/export/invoices.csv", adminAuth, ah(async (_q, res) => {
  const rows = (await q("SELECT number,email,type,plan,cycle,amount,currency,status,reference,coupon,created_at,paid_at FROM invoices ORDER BY created_at DESC")).rows;
  res.set("Content-Type", "text/csv; charset=utf-8"); res.set("Content-Disposition", "attachment; filename=invoices.csv");
  res.send(toCsv(rows, ["number", "email", "type", "plan", "cycle", "amount", "currency", "status", "reference", "coupon", "created_at", "paid_at"]));
}));

// ===== تذكير تجديد الاشتراك (مجدول يومي) =====
async function runRenewalReminders() {
  try {
    const now = Date.now(), soon = now + 7 * 864e5;
    const rows = (await q("SELECT id,email,expires_at,reminder_at FROM users WHERE plan='pro' AND expires_at IS NOT NULL AND expires_at>$1 AND expires_at<=$2", [now, soon])).rows;
    if (!rows.length) return;
    const cfg = await effConfig();
    const base = (process.env.SITE_URL || cfg.brand.url || "https://cognita.dalilai.net").replace(/\/+$/, "");
    for (const u of rows) {
      if (u.reminder_at && now - Number(u.reminder_at) < 2 * 864e5) continue; // تذكير واحد كل يومين كحدّ أقصى
      const daysLeft = Math.max(1, Math.ceil((Number(u.expires_at) - now) / 864e5));
      await notifyRenewalReminder({ brand: cfg.brand, user: { email: u.email }, daysLeft, renewUrl: base + "/app" });
      await q("UPDATE users SET reminder_at=$1 WHERE id=$2", [now, u.id]);
    }
  } catch (e) { console.warn("تذكير التجديد:", e && e.message ? e.message : e); }
}
setTimeout(runRenewalReminders, 30000);
setInterval(runRenewalReminders, 24 * 60 * 60 * 1000);

// ===== صفحات الموقع =====
for (const p of ["app", "admin", "pricing", "privacy", "terms", "contact", "docs", "reset"])
  app.get("/" + p, (_q, res) => res.sendFile(path.join(PUB, p + ".html")));
app.get("/", (_q, res) => res.sendFile(path.join(PUB, "index.html")));

// ضمان وجود سرّ توقيع قوي: من البيئة (الأفضل) أو مولّد ومحفوظ في القاعدة (يبقى ثابتاً عبر إعادات التشغيل)
async function ensureSecret() {
  if (hasStrongSecret()) { console.log("✓ JWT_SECRET من متغيّرات البيئة."); return; }
  const data = (await getSettings()) || {};
  let secret = data.jwtSecret;
  if (!secret || String(secret).length < 16) {
    secret = randomBytes(48).toString("base64url");
    await saveSettings({ ...data, jwtSecret: secret });
    console.warn("⚠️ لم يُضبط JWT_SECRET كمتغيّر بيئة — وُلّد سرّ قوي تلقائياً وحُفظ في القاعدة (يُفضّل ضبطه كمتغيّر بيئة).");
  } else {
    console.log("✓ JWT_SECRET من إعدادات القاعدة.");
  }
  setSecret(secret);
}

init()
  .then(ensureSecret)
  // تهيئة حساب المشرف لا يجب أن تُسقط الخادم إن فشلت — نُسجّل تحذيراً ونُكمل
  .then(() => seedAdmin().catch((e) => console.warn("⚠️ تعذّر تهيئة حساب المشرف:", e && (e.message || e.code) ? (e.message || e.code) : e)))
  .then(() => app.listen(PORT, () => console.log(`Cognita server يعمل على المنفذ ${PORT}`)))
  .catch((e) => { console.error("فشل تهيئة قاعدة البيانات:", e && (e.message || e.code) ? (e.message || e.code) : e); process.exit(1); });
