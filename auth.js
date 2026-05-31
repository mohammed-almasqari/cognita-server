// auth.js — تجزئة كلمات المرور + JWT + وسيط الحماية
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "change-me-in-production";
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET غير مضبوط — استخدم سراً قوياً في الإنتاج.");
}

export const hashPassword = (p) => bcrypt.hashSync(p, 10);
export const verifyPassword = (p, h) => bcrypt.compareSync(p, h);
export const signToken = (user) => jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "30d" });

export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  try {
    req.auth = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "غير مُصرّح — يرجى تسجيل الدخول مجدداً." });
  }
}
