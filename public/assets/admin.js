// admin.js — لوحة الأدمن
const $ = (id) => document.getElementById(id);
const tk = "cognita_admin_token";
let token = localStorage.getItem(tk) || "";

function msg(t, k = "ok") { const m = $("msg"); m.textContent = t; m.className = "msg " + k; setTimeout(() => (m.className = "msg"), 4500); }
async function api(method, path, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "خطأ");
  return d;
}
const show = (inApp) => { $("app").style.display = inApp ? "block" : "none"; $("login").style.display = inApp ? "none" : "block"; };
const money = (a, c) => `${a} ${c || ""}`;
const dt = (ms) => ms ? new Date(+ms).toLocaleDateString("ar") : "—";

$("btn-login").onclick = async () => {
  try {
    const d = await api("POST", "/api/admin/login", { email: $("email").value.trim(), password: $("password").value });
    if (!d.user?.isAdmin) return msg("هذا الحساب ليس مشرفاً.", "err");
    token = d.token; localStorage.setItem(tk, token); boot();
  } catch (e) { msg(e.message, "err"); }
};

// التنقّل بين الأقسام
document.querySelectorAll("#seg button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("#seg button").forEach((x) => x.classList.remove("on"));
  document.querySelectorAll(".panel").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); $("p-" + b.dataset.p).classList.add("on");
}));

async function loadStats() {
  const s = await api("GET", "/api/admin/stats");
  $("stats").innerHTML = [
    ["العملاء", s.customers], ["اشتراكات فعّالة", s.activeSubs],
    ["فواتير معلّقة", s.invoicesUnpaid], ["الإيراد", money(s.revenue, "")],
  ].map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}

async function loadCustomers() {
  const { customers } = await api("GET", "/api/admin/customers");
  $("customers").innerHTML = `<table class="t"><tr><th>البريد</th><th>الخطة</th><th>تنتهي</th><th>إجراءات</th></tr>` +
    customers.map((c) => `<tr>
      <td>${c.email}${c.is_admin ? ' <span class="pill pro">admin</span>' : ""}</td>
      <td><span class="pill ${c.plan === "pro" ? "pro" : "free"}">${c.plan}</span></td>
      <td>${dt(c.expires_at)}</td>
      <td>
        <button class="btn sm" data-pro="${c.id}">منح Pro سنة</button>
        <button class="btn sm ghost" data-free="${c.id}">تنزيل لمجاني</button>
      </td></tr>`).join("") + `</table>`;
  $("customers").querySelectorAll("[data-pro]").forEach((b) => b.onclick = async () => {
    try { await api("POST", "/api/admin/customers/" + b.dataset.pro, { plan: "pro", expiresAt: Date.now() + 365 * 864e5 }); msg("تم المنح"); loadCustomers(); loadStats(); } catch (e) { msg(e.message, "err"); }
  });
  $("customers").querySelectorAll("[data-free]").forEach((b) => b.onclick = async () => {
    try { await api("POST", "/api/admin/customers/" + b.dataset.free, { plan: "free", expiresAt: 0 }); msg("تم التنزيل"); loadCustomers(); loadStats(); } catch (e) { msg(e.message, "err"); }
  });
}

async function loadInvoices() {
  const { invoices } = await api("GET", "/api/admin/invoices");
  $("invoices").innerHTML = invoices.length ? `<table class="t"><tr><th>رقم</th><th>العميل</th><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>المرجع</th><th>الحالة</th><th>إجراء</th></tr>` +
    invoices.map((v) => `<tr>
      <td>${v.number || "-"}</td><td>${v.email}</td><td>${v.type === "renewal" ? "تجديد" : "اشتراك"}</td>
      <td>${v.plan}/${v.cycle}</td><td>${money(v.amount, v.currency)}</td><td>${v.reference || "-"}</td>
      <td><span class="pill ${v.status === "paid" ? "fulfilled" : v.status === "canceled" ? "free" : "pending"}">${v.status === "paid" ? "مدفوعة" : v.status === "canceled" ? "ملغاة" : "معلّقة"}</span></td>
      <td>${v.status === "unpaid" ? `<button class="btn sm" data-pay="${v.id}">تأكيد الدفع</button> <button class="btn sm ghost" data-cancel="${v.id}">إلغاء</button>` : v.issued_key ? `<code>${v.issued_key}</code>` : "-"}</td>
    </tr>`).join("") + `</table>` : `<p class="muted small">لا فواتير.</p>`;
  $("invoices").querySelectorAll("[data-pay]").forEach((b) => b.onclick = async () => {
    try { const r = await api("POST", `/api/admin/invoices/${b.dataset.pay}/pay`, {}); msg("تم تأكيد الدفع وإصدار المفتاح: " + r.key); loadInvoices(); loadStats(); } catch (e) { msg(e.message, "err"); }
  });
  $("invoices").querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
    try { await api("POST", `/api/admin/invoices/${b.dataset.cancel}/cancel`, {}); msg("أُلغيت"); loadInvoices(); } catch (e) { msg(e.message, "err"); }
  });
}

async function loadSettings() {
  const c = await api("GET", "/api/admin/settings");
  $("s-name").value = c.brand.name || ""; $("s-tagline").value = c.brand.tagline || "";
  $("s-domain").value = c.brand.domain || ""; $("s-email").value = c.brand.email || ""; $("s-phone").value = c.brand.phone || "";
  $("s-currency").value = c.pricing.currencyLabel || "ريال";
  const pro = c.pricing.plans?.pro || {};
  $("s-monthly").value = pro.monthly ?? ""; $("s-annual").value = pro.annual ?? ""; $("s-lifetime").value = pro.lifetime ?? "";
  $("s-bank").value = c.payment.bankDetails || ""; $("s-instructions").value = c.payment.instructions || "";
  // وكيل النماذج
  const px = c.proxy || {};
  $("px-enabled").checked = px.enabled !== false;
  $("px-default").value = px.defaultProvider || "openai";
  $("px-limit-pro").value = px.limits?.pro ?? 1000;
  $("px-key-openai").value = px.providerKeys?.openai || "";
  $("px-key-anthropic").value = px.providerKeys?.anthropic || "";
  $("px-key-gemini").value = px.providerKeys?.gemini || "";
}
$("px-save").onclick = async () => {
  try {
    await api("POST", "/api/admin/settings", { proxy: {
      enabled: $("px-enabled").checked,
      defaultProvider: $("px-default").value,
      limits: { pro: +$("px-limit-pro").value || 0 },
      providerKeys: { openai: $("px-key-openai").value, anthropic: $("px-key-anthropic").value, gemini: $("px-key-gemini").value },
    }});
    msg("تم حفظ إعدادات الوكيل ✓"); loadSettings();
  } catch (e) { msg(e.message, "err"); }
};
$("px-usage-load").onclick = async () => {
  try {
    const d = await api("GET", "/api/admin/usage");
    $("px-usage").innerHTML = d.users.length
      ? `<div class="muted small">إجمالي ${d.total} طلب في ${d.ym}</div><table class="t"><tr><th>العميل</th><th>الطلبات</th></tr>` +
        d.users.map((u) => `<tr><td>${u.email}</td><td>${u.count}</td></tr>`).join("") + `</table>`
      : `<p class="muted small">لا استخدام بعد هذا الشهر.</p>`;
  } catch (e) { msg(e.message, "err"); }
};
$("save-settings").onclick = async () => {
  try {
    await api("POST", "/api/admin/settings", {
      brand: { name: $("s-name").value, tagline: $("s-tagline").value, domain: $("s-domain").value, email: $("s-email").value, phone: $("s-phone").value },
      pricing: { currencyLabel: $("s-currency").value, plans: { free: { name: "مجاني", monthly: 0, annual: 0, lifetime: 0 }, pro: { name: "Pro", monthly: +$("s-monthly").value || 0, annual: +$("s-annual").value || 0, lifetime: +$("s-lifetime").value || 0 } } },
      payment: { bankDetails: $("s-bank").value, instructions: $("s-instructions").value },
    });
    msg("تم حفظ المحتوى والأسعار ✓");
  } catch (e) { msg(e.message, "err"); }
};

$("gen").onclick = async () => {
  try { const d = await api("POST", "/api/admin/licenses", { tier: "pro", days: +$("g-days").value || 365, count: +$("g-count").value || 1 });
    $("keys").style.display = "block"; $("keys").textContent = d.keys.join("\n"); msg(`تم توليد ${d.keys.length} مفتاح`);
  } catch (e) { msg(e.message, "err"); }
};

async function boot() {
  try { await loadStats(); await loadCustomers(); await loadInvoices(); await loadSettings(); show(true); }
  catch { token = ""; localStorage.removeItem(tk); show(false); }
}
if (token) boot(); else show(false);
