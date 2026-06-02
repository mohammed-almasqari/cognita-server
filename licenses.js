// licenses.js — توليد مفاتيح الترخيص وحساب الصلاحيات (يطابق خريطة ميزات الإضافة)
import crypto from "crypto";

// يجب أن تطابق FEATURE في shared/config.js داخل الإضافة
export const FEATURES = {
  // الذكاء بمفتاح المستخدم مجاني؛ Pro يفتح تشغيل الوكلاء والبحث متعدد التبويبات والمزامنة (ووكيل الخادم بمفاتيحنا)
  free: { aiOptimize: true, agentRun: false, autoSearchMulti: false, cloudSync: false },
  pro: { aiOptimize: true, agentRun: true, autoSearchMulti: true, cloudSync: true },
};

export const featuresFor = (plan) => FEATURES[plan === "pro" ? "pro" : "free"];

export function genKey() {
  const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `COG-${seg()}-${seg()}-${seg()}`;
}

// حساب صلاحية المستخدم بناءً على خطته وتاريخ الانتهاء
export function entitlementFor(user) {
  const now = Date.now();
  const expired = user.expiresAt && now > user.expiresAt;
  const plan = !expired && user.plan === "pro" ? "pro" : "free";
  return {
    plan,
    features: featuresFor(plan),
    expiresAt: user.expiresAt || null,
    valid: !expired,
  };
}
