// admin.js — لوحة الأدمن الاحترافية (شريط جانبي + رسوم + بحث + فواتير PDF)
const $ = (id) => document.getElementById(id);
const tk = "cognita_admin_token";
let token = localStorage.getItem(tk) || "";
let CFG = null;            // /api/config (علامة/أسعار/دفع) — لطباعة الفواتير
let CUSTOMERS = [];        // ذاكرة مؤقتة لفلترة البحث
let INVOICES = [];
const charts = {};         // مراجع رسوم Chart.js لإتلافها قبل إعادة الرسم

function msg(t, k = "ok") { const m = $("msg"); m.textContent = t; m.className = "msg " + k; setTimeout(() => (m.className = "msg"), 4500); }
async function api(method, path, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "خطأ");
  return d;
}
const show = (inApp) => { $("app").style.display = inApp ? "flex" : "none"; $("login").style.display = inApp ? "none" : "block"; };
const money = (a, c) => `${a} ${c || ""}`;
const dt = (ms) => ms ? new Date(+ms).toLocaleDateString("ar") : "—";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

$("btn-login").onclick = async () => {
  try {
    const d = await api("POST", "/api/admin/login", { email: $("email").value.trim(), password: $("password").value });
    if (!d.user?.isAdmin) return msg("هذا الحساب ليس مشرفاً.", "err");
    token = d.token; localStorage.setItem(tk, token); boot();
  } catch (e) { msg(e.message, "err"); }
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-login").click(); });

// ===== التنقّل (الشريط الجانبي) =====
const TITLES = { dashboard: "لوحة المعلومات", customers: "العملاء", invoices: "الفواتير", settings: "الباقات والمحتوى", payment: "إعدادات الدفع", proxy: "وكيل النماذج", keys: "توليد مفاتيح" };
function closeDrawer() { $("side").classList.remove("open"); $("scrim").classList.remove("show"); }
document.querySelectorAll(".navlink[data-p]").forEach((b) => (b.onclick = () => {
  const p = b.dataset.p;
  document.querySelectorAll(".navlink[data-p]").forEach((x) => x.classList.remove("on"));
  document.querySelectorAll(".panel").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); $("p-" + p).classList.add("on");
  $("page-title").textContent = TITLES[p] || "";
  closeDrawer();
}));
$("burger").onclick = () => { $("side").classList.toggle("open"); $("scrim").classList.toggle("show"); };
$("scrim").onclick = closeDrawer;
$("logout").onclick = () => { token = ""; localStorage.removeItem(tk); location.reload(); };

// ===== لوحة المعلومات =====
async function loadStats() {
  const s = await api("GET", "/api/admin/stats");
  $("stats").innerHTML = [
    ["العملاء", s.customers], ["اشتراكات فعّالة", s.activeSubs],
    ["فواتير معلّقة", s.invoicesUnpaid], ["الإيراد المؤكَّد", money(s.revenue, CFG?.pricing?.currencyLabel || "")],
  ].map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
  const ml = s.mailer || {};
  $("mailer-status").innerHTML = ml.configured
    ? `✉️ إشعارات البريد مُفعّلة عبر <code>${esc(ml.host)}</code> — تُرسل الفواتير ومفاتيح التفعيل تلقائياً.`
    : `✉️ إشعارات البريد غير مُهيّأة. لتفعيلها أضِف متغيّرات SMTP_HOST و SMTP_USER و SMTP_PASS (و SMTP_FROM) في بيئة الخادم.`;
}

const chartFont = "IBM Plex Sans Arabic, sans-serif";
function mkChart(id, cfg) {
  if (typeof Chart === "undefined") return;
  if (charts[id]) charts[id].destroy();
  const ctx = $(id); if (!ctx) return;
  Chart.defaults.color = "#9aa6c4"; Chart.defaults.font.family = chartFont;
  charts[id] = new Chart(ctx, cfg);
}
const grid = { color: "rgba(255,255,255,.06)" };
async function loadAnalytics() {
  let a; try { a = await api("GET", "/api/admin/analytics"); } catch { return; }
  const cur = CFG?.pricing?.currencyLabel || "";
  mkChart("ch-rev", {
    type: "bar",
    data: { labels: a.months, datasets: [{ label: `الإيراد (${cur})`, data: a.revenue, backgroundColor: "#6366f1", borderRadius: 7, maxBarThickness: 42 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid }, x: { grid: { display: false } } } },
  });
  mkChart("ch-plan", {
    type: "doughnut",
    data: { labels: ["مجاني", "Pro"], datasets: [{ data: [a.planSplit.free, a.planSplit.pro], backgroundColor: ["#3a4566", "#a855f7"], borderColor: "#141d36", borderWidth: 3 }] },
    options: { plugins: { legend: { position: "bottom" } }, cutout: "62%" },
  });
  mkChart("ch-sign", {
    type: "bar",
    data: { labels: a.months, datasets: [{ label: "عملاء جدد", data: a.signups, backgroundColor: "#10b981", borderRadius: 7, maxBarThickness: 42 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });
  mkChart("ch-usage", {
    type: "line",
    data: { labels: a.months, datasets: [{ label: "طلبات", data: a.usage, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.18)", fill: true, tension: .35, pointRadius: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });
}

// ===== العملاء =====
function renderCustomers(list) {
  $("customers").innerHTML = `<table class="t"><tr><th>البريد</th><th>الخطة</th><th>تنتهي</th><th>إجراءات</th></tr>` +
    list.map((c) => `<tr>
      <td data-label="البريد">${esc(c.email)}${c.is_admin ? ' <span class="pill pro">admin</span>' : ""}</td>
      <td data-label="الخطة"><span class="pill ${c.plan === "pro" ? "pro" : "free"}">${esc(c.plan)}</span></td>
      <td data-label="تنتهي">${dt(c.expires_at)}</td>
      <td data-label="إجراءات" style="white-space:nowrap">
        <button class="btn sm" data-pro="${c.id}">منح Pro سنة</button>
        <button class="btn sm ghost" data-free="${c.id}">تنزيل لمجاني</button>
      </td></tr>`).join("") + `</table>` + (list.length ? "" : `<p class="muted small">لا نتائج.</p>`);
  $("customers").querySelectorAll("[data-pro]").forEach((b) => b.onclick = async () => {
    try { await api("POST", "/api/admin/customers/" + b.dataset.pro, { plan: "pro", expiresAt: Date.now() + 365 * 864e5 }); msg("تم المنح"); loadCustomers(); loadStats(); loadAnalytics(); } catch (e) { msg(e.message, "err"); }
  });
  $("customers").querySelectorAll("[data-free]").forEach((b) => b.onclick = async () => {
    try { await api("POST", "/api/admin/customers/" + b.dataset.free, { plan: "free", expiresAt: 0 }); msg("تم التنزيل"); loadCustomers(); loadStats(); loadAnalytics(); } catch (e) { msg(e.message, "err"); }
  });
}
async function loadCustomers() {
  const { customers } = await api("GET", "/api/admin/customers");
  CUSTOMERS = customers; applyCustomerSearch();
}
function applyCustomerSearch() {
  const term = ($("cust-search").value || "").trim().toLowerCase();
  renderCustomers(term ? CUSTOMERS.filter((c) => (c.email || "").toLowerCase().includes(term)) : CUSTOMERS);
}
$("cust-search").oninput = applyCustomerSearch;
$("cust-refresh").onclick = () => loadCustomers().catch((e) => msg(e.message, "err"));

// ===== الفواتير =====
const invStatusPill = (st) => `<span class="pill ${st === "paid" ? "fulfilled" : st === "canceled" ? "free" : "pending"}">${st === "paid" ? "مدفوعة" : st === "canceled" ? "ملغاة" : "معلّقة"}</span>`;
function renderInvoices(list) {
  $("invoices").innerHTML = list.length ? `<table class="t"><tr><th>رقم</th><th>العميل</th><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>المرجع</th><th>الحالة</th><th>إجراء</th></tr>` +
    list.map((v) => `<tr>
      <td data-label="رقم">${esc(v.number || "-")}</td><td data-label="العميل">${esc(v.email)}</td><td data-label="النوع">${v.type === "renewal" ? "تجديد" : "اشتراك"}</td>
      <td data-label="الباقة">${esc(v.plan)}/${esc(v.cycle)}</td><td data-label="المبلغ">${money(esc(v.amount), esc(v.currency))}</td><td data-label="المرجع">${esc(v.reference || "-")}</td>
      <td data-label="الحالة">${invStatusPill(v.status)}</td>
      <td data-label="إجراء" style="white-space:nowrap">
        ${v.status === "unpaid" ? `<button class="btn sm" data-pay="${v.id}">تأكيد الدفع</button> <button class="btn sm ghost" data-cancel="${v.id}">إلغاء</button> ` : v.issued_key ? `<code>${esc(v.issued_key)}</code> ` : ""}
        ${v.has_receipt ? `<button class="btn sm ghost" data-receipt="${v.id}">عرض الإيصال</button> ` : ""}
        <button class="btn sm ghost" data-pdf="${v.id}">PDF</button>
      </td>
    </tr>`).join("") + `</table>` : `<p class="muted small">لا فواتير.</p>`;
  $("invoices").querySelectorAll("[data-pay]").forEach((b) => b.onclick = async () => {
    try { const r = await api("POST", `/api/admin/invoices/${b.dataset.pay}/pay`, {}); msg("تم تأكيد الدفع وإصدار المفتاح: " + r.key); loadInvoices(); loadStats(); loadAnalytics(); } catch (e) { msg(e.message, "err"); }
  });
  $("invoices").querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
    try { await api("POST", `/api/admin/invoices/${b.dataset.cancel}/cancel`, {}); msg("أُلغيت"); loadInvoices(); loadStats(); } catch (e) { msg(e.message, "err"); }
  });
  $("invoices").querySelectorAll("[data-pdf]").forEach((b) => b.onclick = () => {
    const inv = INVOICES.find((x) => x.id === b.dataset.pdf); if (inv) printInvoice(inv);
  });
  $("invoices").querySelectorAll("[data-receipt]").forEach((b) => b.onclick = async () => {
    try {
      const r = await fetch(`/api/admin/invoices/${b.dataset.receipt}/receipt`, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error("لا إيصال");
      window.open(URL.createObjectURL(await r.blob()), "_blank");
    } catch { msg("تعذّر عرض الإيصال", "err"); }
  });
}
async function loadInvoices() {
  const { invoices } = await api("GET", "/api/admin/invoices");
  INVOICES = invoices; applyInvoiceFilter();
}
function applyInvoiceFilter() {
  const f = $("inv-filter").value;
  renderInvoices(f ? INVOICES.filter((v) => v.status === f) : INVOICES);
}
$("inv-filter").onchange = applyInvoiceFilter;
$("inv-refresh").onclick = () => loadInvoices().catch((e) => msg(e.message, "err"));

// طباعة فاتورة PDF (عبر نافذة طباعة المتصفح → حفظ كـ PDF)
function printInvoice(v) {
  const b = CFG?.brand || {}, pay = CFG?.payment || {};
  const cycleAr = v.cycle === "lifetime" ? "مدى الحياة" : v.cycle === "annual" ? "سنوي" : "شهري";
  const stAr = v.status === "paid" ? "مدفوعة" : v.status === "canceled" ? "ملغاة" : "بانتظار الدفع";
  const stCss = v.status === "paid" ? "#dcfce7;color:#166534" : v.status === "canceled" ? "#f3f4f6;color:#6b7280" : "#fef3c7;color:#92400e";
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) { msg("اسمح بالنوافذ المنبثقة لطباعة الفاتورة.", "err"); return; }
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فاتورة ${esc(v.number || v.id)}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap");
    *{box-sizing:border-box}body{font-family:"IBM Plex Sans Arabic",sans-serif;color:#1f2937;margin:0;padding:38px 42px;line-height:1.8}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6366f1;padding-bottom:18px;margin-bottom:24px}
    .logo{font-size:22px;font-weight:800;color:#6366f1}.logo small{display:block;color:#6b7280;font-size:12px;font-weight:500}
    .ttl{text-align:left}.ttl h1{margin:0;font-size:26px;color:#0f1729}.ttl .num{color:#6b7280;font-size:13px}
    .meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px;font-size:14px}
    .meta .box{background:#f7f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 15px;flex:1}
    .meta .box b{color:#0f1729}
    table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:14px}
    th,td{border:1px solid #e5e7eb;padding:11px 13px;text-align:right}th{background:#f3f4f6;color:#374151}
    .tot{text-align:left;font-size:20px;font-weight:800;color:#0f1729;margin:8px 0}
    .st{display:inline-block;padding:5px 14px;border-radius:100px;font-size:13px;font-weight:700;background:${stCss}}
    .pay{background:#f7f8fb;border:1px dashed #cbd5e1;border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13px;color:#374151;margin-top:14px}
    .ft{margin-top:30px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;color:#6b7280;font-size:12px}
    .key{font-family:monospace;font-size:16px;letter-spacing:1px;background:#0b1020;color:#a5b0ff;padding:12px;border-radius:9px;text-align:center;direction:ltr;margin-top:12px}
    @media print{body{padding:14px}}
  </style></head><body>
    <div class="hd">
      <div class="logo">${esc(b.name || "Cognita")}<small>${esc(b.tagline || "")}</small><small>${esc(b.url || "")}</small></div>
      <div class="ttl"><h1>فاتورة</h1><div class="num">${esc(v.number || v.id)}</div></div>
    </div>
    <div class="meta">
      <div class="box"><b>إلى العميل</b><br>${esc(v.email)}</div>
      <div class="box"><b>التاريخ</b><br>${dt(v.created_at)}${v.paid_at ? `<br><b>تاريخ الدفع</b><br>${dt(v.paid_at)}` : ""}</div>
      <div class="box"><b>الحالة</b><br><span class="st">${stAr}</span></div>
    </div>
    <table><tr><th>الوصف</th><th>الباقة</th><th>الدورة</th><th>المبلغ</th></tr>
      <tr><td>${v.type === "renewal" ? "تجديد اشتراك Cognita Pro" : "اشتراك Cognita Pro"}</td><td>${esc(v.plan)}</td><td>${cycleAr}</td><td>${money(esc(v.amount), esc(v.currency))}</td></tr>
    </table>
    <div class="tot">الإجمالي: ${money(esc(v.amount), esc(v.currency))}</div>
    ${v.issued_key ? `<div><b>مفتاح التفعيل</b><div class="key">${esc(v.issued_key)}</div></div>` : ""}
    ${v.status !== "paid" && pay.bankDetails ? `<div class="pay"><b>بيانات الدفع</b>\n${esc(pay.bankDetails)}${pay.instructions ? "\n\n" + esc(pay.instructions) : ""}</div>` : ""}
    <div class="ft">${esc(b.copyright || "© Cognita")} · ${esc(b.email || "")}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script>
  </body></html>`);
  win.document.close();
}

// ===== الإعدادات (المحتوى + الأسعار + الوكيل) =====
async function loadSettings() {
  const c = await api("GET", "/api/admin/settings");
  $("s-name").value = c.brand.name || ""; $("s-tagline").value = c.brand.tagline || "";
  $("s-domain").value = c.brand.domain || ""; $("s-email").value = c.brand.email || ""; $("s-phone").value = c.brand.phone || "";
  $("s-currency").value = c.pricing.currencyLabel || "ريال";
  const pro = c.pricing.plans?.pro || {};
  $("s-monthly").value = pro.monthly ?? ""; $("s-annual").value = pro.annual ?? ""; $("s-lifetime").value = pro.lifetime ?? "";
  // إعدادات الدفع
  const pay = c.payment || {};
  $("pay-bank-enabled").checked = pay.bankEnabled !== false;
  $("pay-bank").value = pay.bankDetails || ""; $("pay-instructions").value = pay.instructions || "";
  const pp = pay.paypal || {};
  $("pp-enabled").checked = !!pp.enabled;
  $("pp-mode").value = pp.mode === "sandbox" ? "sandbox" : "live";
  $("pp-currency").value = pp.currency || "USD";
  $("pp-client").value = pp.clientId || "";
  $("pp-rate").value = pp.rate ?? 1;
  $("pp-secret").value = pp.secret || "";
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
        d.users.map((u) => `<tr><td data-label="العميل">${esc(u.email)}</td><td data-label="الطلبات">${u.count}</td></tr>`).join("") + `</table>`
      : `<p class="muted small">لا استخدام بعد هذا الشهر.</p>`;
  } catch (e) { msg(e.message, "err"); }
};
$("save-settings").onclick = async () => {
  try {
    await api("POST", "/api/admin/settings", {
      brand: { name: $("s-name").value, tagline: $("s-tagline").value, domain: $("s-domain").value, email: $("s-email").value, phone: $("s-phone").value },
      pricing: { currencyLabel: $("s-currency").value, plans: { free: { name: "مجاني", monthly: 0, annual: 0, lifetime: 0 }, pro: { name: "Pro", monthly: +$("s-monthly").value || 0, annual: +$("s-annual").value || 0, lifetime: +$("s-lifetime").value || 0 } } },
    });
    msg("تم حفظ المحتوى والأسعار ✓"); CFG = await api("GET", "/api/config").catch(() => CFG);
  } catch (e) { msg(e.message, "err"); }
};

$("pay-save").onclick = async () => {
  try {
    await api("POST", "/api/admin/settings", { payment: {
      bankEnabled: $("pay-bank-enabled").checked,
      bankDetails: $("pay-bank").value, instructions: $("pay-instructions").value,
      paypal: {
        enabled: $("pp-enabled").checked, mode: $("pp-mode").value,
        currency: $("pp-currency").value.trim() || "USD", clientId: $("pp-client").value.trim(),
        rate: +$("pp-rate").value || 1, secret: $("pp-secret").value,
      },
    }});
    msg("تم حفظ إعدادات الدفع ✓"); loadSettings(); CFG = await api("GET", "/api/config").catch(() => CFG);
  } catch (e) { msg(e.message, "err"); }
};

$("gen").onclick = async () => {
  try { const d = await api("POST", "/api/admin/licenses", { tier: "pro", days: +$("g-days").value || 365, count: +$("g-count").value || 1 });
    $("keys").style.display = "block"; $("keys").textContent = d.keys.join("\n"); msg(`تم توليد ${d.keys.length} مفتاح`);
  } catch (e) { msg(e.message, "err"); }
};

async function boot() {
  try {
    CFG = await api("GET", "/api/config").catch(() => null);
    $("clock").textContent = new Date().toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    await loadStats(); await loadCustomers(); await loadInvoices(); await loadSettings();
    show(true); loadAnalytics();
  } catch { token = ""; localStorage.removeItem(tk); show(false); }
}
if (token) boot(); else show(false);
