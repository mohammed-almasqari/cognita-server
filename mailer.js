// mailer.js — إشعارات البريد عبر SMTP (اختيارية تماماً).
// إن لم تُضبط متغيّرات SMTP_* فلا يُرسَل شيء ولا ينكسر أي تدفّق (no-op آمن).
// المتغيّرات: SMTP_HOST, SMTP_PORT (افتراضي 587), SMTP_USER, SMTP_PASS,
//            SMTP_FROM (افتراضي = SMTP_USER), SMTP_SECURE ("true" للمنفذ 465).
import nodemailer from "nodemailer";

const HOST = (process.env.SMTP_HOST || "").trim();
const USER = (process.env.SMTP_USER || "").trim();
const PASS = (process.env.SMTP_PASS || "").trim();
const PORT = Number(process.env.SMTP_PORT || 587);
const FROM = (process.env.SMTP_FROM || USER || "").trim();
const SECURE = process.env.SMTP_SECURE === "true" || PORT === 465;

let _t = null;
const isConfigured = () => !!(HOST && USER && PASS);

export function mailerStatus() {
  return { configured: isConfigured(), from: FROM || null, host: HOST || null, port: PORT };
}

function transport() {
  if (_t) return _t;
  if (!isConfigured()) return null;
  _t = nodemailer.createTransport({ host: HOST, port: PORT, secure: SECURE, auth: { user: USER, pass: PASS } });
  return _t;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const stripHtml = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// إرسال عام — يعيد {sent, reason?} ولا يرمي أبداً
export async function sendMail({ to, subject, html, text }) {
  const t = transport();
  if (!t || !to) return { sent: false, reason: "not_configured" };
  try {
    await t.sendMail({ from: FROM, to, subject, html, text: text || stripHtml(html) });
    return { sent: true };
  } catch (e) {
    console.warn("✉️ تعذّر إرسال البريد:", e && e.message ? e.message : e);
    return { sent: false, reason: e && e.message ? e.message : "error" };
  }
}

// قالب رسالة موحّد (RTL)
function layout(brand, title, bodyHtml) {
  const name = esc(brand?.name || "Cognita");
  const url = esc(brand?.url || "https://cognita.dalilai.net");
  const email = esc(brand?.email || "support@dalilai.net");
  const copyright = esc(brand?.copyright || "© 2026 Mohammed Almasqari");
  return `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">
  <body style="margin:0;background:#0b1020;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1f2937">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:18px 0">
        <span style="display:inline-block;font-size:20px;font-weight:800;color:#fff;background:linear-gradient(135deg,#6366f1,#a855f7);padding:10px 20px;border-radius:12px">${name}</span>
      </div>
      <div style="background:#fff;border-radius:16px;padding:30px 28px;line-height:1.9">
        <h1 style="font-size:20px;color:#0f1729;margin:0 0 14px">${esc(title)}</h1>
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#8a95b4;font-size:12px;margin:18px 0 6px">
        <a href="${url}" style="color:#a5b0ff;text-decoration:none">${url}</a> · <a href="mailto:${email}" style="color:#a5b0ff;text-decoration:none">${email}</a>
      </p>
      <p style="text-align:center;color:#6b7280;font-size:11px;margin:0">${copyright}</p>
    </div>
  </body></html>`;
}

const money = (inv) => `${esc(inv.amount)} ${esc(inv.currency || "ريال")}`;
const cycleAr = (c) => (c === "lifetime" ? "مدى الحياة" : c === "annual" ? "سنوي" : "شهري");

// إشعار: أُنشئت فاتورة وتنتظر الدفع
export async function notifyInvoiceCreated({ brand, payment, user, invoice }) {
  const pay = payment || {};
  const body = `
    <p style="color:#374151;font-size:14.5px">مرحباً،</p>
    <p style="color:#374151;font-size:14.5px">تم إنشاء فاتورة ${invoice.type === "renewal" ? "تجديد اشتراك" : "اشتراك"} <b>Pro</b> (${cycleAr(invoice.cycle)}). يرجى إتمام الدفع لتفعيل اشتراكك.</p>
    <div style="background:#f3f4f6;border-radius:10px;padding:14px 16px;margin:14px 0;font-size:14px">
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#6b7280">رقم الفاتورة</span><b>${esc(invoice.number || invoice.id)}</b></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#6b7280">المبلغ</span><b>${money(invoice)}</b></div>
    </div>
    ${pay.bankDetails ? `<p style="color:#374151;font-size:13.5px;white-space:pre-wrap;background:#fafafa;border:1px dashed #d1d5db;border-radius:10px;padding:12px">${esc(pay.bankDetails)}</p>` : ""}
    ${pay.instructions ? `<p style="color:#4b5563;font-size:13.5px">${esc(pay.instructions)}</p>` : ""}
  `;
  return sendMail({
    to: user.email,
    subject: `فاتورتك من ${esc(brand?.name || "Cognita")} — بانتظار الدفع (${invoice.number || invoice.id})`,
    html: layout(brand, "فاتورة بانتظار الدفع", body),
  });
}

// إشعار: تم الدفع وإصدار مفتاح التفعيل
export async function notifyLicenseIssued({ brand, user, key, invoice }) {
  const body = `
    <p style="color:#374151;font-size:14.5px">تهانينا! تم تأكيد دفعتك وتفعيل اشتراك <b>Pro</b>.</p>
    <p style="color:#374151;font-size:14.5px">مفتاح التفعيل الخاص بك:</p>
    <div style="font-family:monospace;font-size:16px;letter-spacing:1px;text-align:center;background:#0b1020;color:#a5b0ff;border-radius:10px;padding:16px;margin:12px 0;direction:ltr">${esc(key)}</div>
    <p style="color:#4b5563;font-size:13.5px">فعّله من الإضافة عبر: الإعدادات ← الحساب ← «تفعيل بمفتاح»، أو من لوحة العميل على الموقع.</p>
    ${invoice ? `<p style="color:#6b7280;font-size:12.5px">مرتبط بالفاتورة ${esc(invoice.number || invoice.id)} · ${money(invoice)}</p>` : ""}
  `;
  return sendMail({
    to: user.email,
    subject: `تم تفعيل اشتراك Pro — مفتاحك من ${esc(brand?.name || "Cognita")}`,
    html: layout(brand, "تم تفعيل اشتراكك ✓", body),
  });
}
