// app.js — لوحة تحكم العميل
const $ = (id) => document.getElementById(id);
const tk = "cognita_token";
let token = localStorage.getItem(tk) || "";
let CFG = null;

function msg(t, k = "ok") { const m = $("msg"); m.textContent = t; m.className = "msg " + k; m.scrollIntoView({ block: "nearest" }); setTimeout(() => (m.className = "msg"), 4500); }
async function api(method, path, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "خطأ"); return d;
}
const show = (inApp) => { $("auth").style.display = inApp ? "none" : "block"; $("account").style.display = inApp ? "block" : "none"; };
const dt = (ms) => ms ? new Date(+ms).toLocaleDateString("ar") : "—";
const money = (a, c) => `${a} ${c || ""}`;

async function loadConfig() {
  try { CFG = await api("GET", "/api/config"); } catch { CFG = null; }
  const pro = CFG?.pricing?.plans?.pro || { monthly: 29, annual: 290, lifetime: 749 };
  const cur = CFG?.pricing?.currencyLabel || "ريال";
  $("cycle").innerHTML = [
    ["monthly", `شهري — ${pro.monthly} ${cur}`], ["annual", `سنوي — ${pro.annual} ${cur}`], ["lifetime", `مدى الحياة — ${pro.lifetime} ${cur}`],
  ].map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
}

async function loadAccount() {
  try {
    const { user, entitlement } = await api("GET", "/api/me");
    $("u-email").textContent = user.email;
    $("u-plan").innerHTML = `<span class="pill ${entitlement.plan}">${entitlement.plan === "pro" ? "Pro ✦" : "مجاني"}</span>`;
    $("u-exp").textContent = dt(entitlement.expiresAt);
    if (user.licenseKey) { $("u-key").textContent = user.licenseKey; $("copy-key").style.display = "inline-flex"; }
    else { $("u-key").textContent = "—"; $("copy-key").style.display = "none"; }
    show(true); loadInvoices();
  } catch { token = ""; localStorage.removeItem(tk); show(false); }
}

async function loadInvoices() {
  try {
    const { invoices } = await api("GET", "/api/invoices/mine");
    $("invoices").innerHTML = invoices.length ? `<table class="t"><tr><th>رقم</th><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th><th>المفتاح</th></tr>` +
      invoices.map((v) => `<tr><td>${v.number}</td><td>${v.type === "renewal" ? "تجديد" : "اشتراك"}</td>
        <td>${v.plan}/${v.cycle}</td><td>${money(v.amount, v.currency)}</td>
        <td><span class="pill ${v.status === "paid" ? "fulfilled" : v.status === "canceled" ? "free" : "pending"}">${v.status === "paid" ? "مدفوعة" : v.status === "canceled" ? "ملغاة" : "معلّقة"}</span></td>
        <td>${v.issued_key ? `<code>${v.issued_key}</code>` : "—"}</td></tr>`).join("") + `</table>` : `<p class="muted small">لا فواتير بعد.</p>`;
  } catch (e) { $("invoices").innerHTML = `<p class="muted small">—</p>`; }
}

function showPay(invoice, payment) {
  const p = payment || CFG?.payment || {};
  $("pay").style.display = "block";
  $("pay").innerHTML = `<b>فاتورة ${invoice.number} — ${money(invoice.amount, invoice.currency)}</b>
    <pre style="white-space:pre-wrap;margin:8px 0;direction:rtl">${p.bankDetails || ""}</pre>
    <div class="muted small">${p.instructions || ""}</div>
    <label style="margin-top:8px">مرجع عملية التحويل</label>
    <input id="ref" placeholder="رقم الحوالة">
    <button class="btn primary sm" id="send-ref">إرسال المرجع</button>`;
  $("send-ref").onclick = async () => {
    try { await api("POST", `/api/invoices/${invoice.id}/reference`, { reference: $("ref").value.trim() }); msg("تم إرسال المرجع ✓ — سنراجع ونُصدر المفتاح"); loadInvoices(); }
    catch (e) { msg(e.message, "err"); }
  };
}

$("login").onclick = async () => { try { const d = await api("POST", "/api/auth/login", { email: $("email").value.trim(), password: $("password").value }); token = d.token; localStorage.setItem(tk, token); msg("تم الدخول ✓"); loadAccount(); } catch (e) { msg(e.message, "err"); } };
$("register").onclick = async () => { try { const d = await api("POST", "/api/auth/register", { email: $("email").value.trim(), password: $("password").value }); token = d.token; localStorage.setItem(tk, token); msg("تم إنشاء الحساب ✓"); loadAccount(); } catch (e) { msg(e.message, "err"); } };
$("logout").onclick = () => { token = ""; localStorage.removeItem(tk); show(false); };
$("copy-key").onclick = () => { navigator.clipboard.writeText($("u-key").textContent).then(() => msg("نُسخ المفتاح ✓")); };
$("activate").onclick = async () => { try { await api("POST", "/api/license/activate", { key: $("license").value.trim() }); msg("تم التفعيل ✓"); loadAccount(); } catch (e) { msg(e.message, "err"); } };
$("order").onclick = async () => { try { const d = await api("POST", "/api/orders", { cycle: $("cycle").value }); msg("أُنشئت الفاتورة — أكمل الدفع"); showPay(d.invoice, d.payment); loadInvoices(); } catch (e) { msg(e.message, "err"); } };
$("renew").onclick = async () => { try { const d = await api("POST", "/api/subscription/renew", { cycle: $("cycle").value }); msg("أُنشئت فاتورة تجديد"); showPay(d.invoice, d.payment); loadInvoices(); } catch (e) { msg(e.message, "err"); } };

loadConfig();
if (token) loadAccount(); else show(false);
