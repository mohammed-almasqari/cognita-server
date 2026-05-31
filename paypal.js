// paypal.js — تكامل PayPal (REST Orders API v2) بمفاتيح الخادم.
// يعمل على Node 18+ (fetch مدمج). تُحقن المفاتيح من إعدادات لوحة الأدمن.
const BASE = (mode) => (mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

async function accessToken({ clientId, secret, mode }) {
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const r = await fetch(BASE(mode) + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description || d.error || "فشل مصادقة PayPal");
  return d.access_token;
}

// إنشاء طلب دفع → يعيد { id, approveUrl }
export async function createOrder({ clientId, secret, mode, amount, currency, invoiceNumber, returnUrl, cancelUrl, brandName }) {
  const at = await accessToken({ clientId, secret, mode });
  const r = await fetch(BASE(mode) + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        amount: { currency_code: currency || "USD", value: Number(amount).toFixed(2) },
        description: `${brandName || "Cognita"} Pro — ${invoiceNumber}`,
        custom_id: invoiceNumber,
      }],
      application_context: {
        brand_name: brandName || "Cognita",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || "فشل إنشاء طلب PayPal");
  const approveUrl = (d.links || []).find((l) => l.rel === "approve")?.href;
  return { id: d.id, approveUrl };
}

// التقاط الدفع بعد موافقة العميل → يعيد كائن النتيجة (status === "COMPLETED" عند النجاح)
export async function captureOrder({ clientId, secret, mode, orderId }) {
  const at = await accessToken({ clientId, secret, mode });
  const r = await fetch(BASE(mode) + `/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || "فشل التقاط دفعة PayPal");
  return d;
}
