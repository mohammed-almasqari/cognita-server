// auth.js — تجزئة كلمات المرور + JWT + وسطاء الحماية + بذرة المشرف
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { q } from "./db.js";

// سرّ توقيع الرموز: من متغيّر البيئة إن وُجد (الأفضل)، وإلا يُضبط من القاعدة عند الإقلاع عبر setSecret().
let SECRET = (process.env.JWT_SECRET || "").trim();
export const hasStrongSecret = () => SECRET.length >= 16;
export const setSecret = (s) => { const v = String(s || "").trim(); if (v.length >= 16) SECRET = v; };

export const hashPassword = (p) => bcrypt.hashSync(p, 10);
export const verifyPassword = (p, h) => bcrypt.compareSync(p, h);
export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, is_admin: !!user.is_admin }, SECRET, { expiresIn: "30d" });

export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  try { req.auth = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: "غير مُصرّح — يرجى تسجيل الدخول مجدداً." }); }
}

// يقبل إمّا مشرفاً مسجّلاً (JWT + is_admin)، أو رمز ADMIN_TOKEN كبديل بدائي
export async function adminAuth(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN || "";
  if (adminToken && req.headers["x-admin-token"] === adminToken) { req.isAdmin = true; return next(); }
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  try {
    const a = jwt.verify(token, SECRET);
    const r = await q("SELECT is_admin FROM users WHERE id=$1", [a.id]);
    if (r.rows[0]?.is_admin) { req.auth = a; req.isAdmin = true; return next(); }
    return res.status(403).json({ error: "هذا الإجراء يتطلّب صلاحية مشرف." });
  } catch { return res.status(401).json({ error: "غير مُصرّح — سجّل الدخول كمشرف." }); }
}

// إنشاء/تحديث حساب المشرف من متغيّرات البيئة عند الإقلاع
export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) { console.warn("⚠️  ADMIN_EMAIL/ADMIN_PASSWORD غير مضبوطين — لن يُنشأ حساب مشرف."); return; }
  const r = await q("SELECT id, is_admin FROM users WHERE lower(email)=lower($1)", [email]);
  if (r.rows[0]) {
    // اجعل ADMIN_PASSWORD مصدر الحقيقة: حدّث الصلاحية وكلمة المرور في كل إقلاع
    await q("UPDATE users SET is_admin=true, pass_hash=$1, plan='pro' WHERE id=$2", [hashPassword(pass), r.rows[0].id]);
    console.log("✓ حساب المشرف مُحدّث (كلمة المرور من ADMIN_PASSWORD):", email);
  } else {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await q("INSERT INTO users(id,email,pass_hash,plan,is_admin,created_at) VALUES($1,$2,$3,'pro',true,$4)",
      [id, email, hashPassword(pass), Date.now()]);
    await q("INSERT INTO sync_data(user_id,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, Date.now()]);
    console.log("✓ أُنشئ حساب المشرف:", email);
  }
}
