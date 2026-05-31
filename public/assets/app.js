// app.js — لوحة تحكم العميل (احترافية، متجاوبة، مع فاتورة PDF بهوية Cognita)
const $ = (id) => document.getElementById(id);
const tk = "cognita_token";
let token = localStorage.getItem(tk) || "";
let CFG = null, INVOICES = [], selectedCycle = "monthly", authMode = "login";

function msg(t, k = "ok") { const m = $("msg"); m.textContent = t; m.className = "msg " + k; m.scrollIntoView({ block: "nearest" }); setTimeout(() => (m.className = "msg"), 4500); }
async function api(method, path, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "خطأ"); return d;
}
const show = (inApp) => { $("auth").style.display = inApp ? "none" : "block"; $("account").style.display = inApp ? "block" : "none"; };
const dt = (ms) => ms ? new Date(+ms).toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" }) : "—";
const money = (a, c) => `${a} ${c || ""}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cycleAr = (c) => (c === "lifetime" ? "مدى الحياة" : c === "annual" ? "سنوي" : "شهري");

// ===== المصادقة (تبويب دخول/تسجيل) =====
function setAuthMode(m) {
  authMode = m;
  $("tab-login").classList.toggle("on", m === "login");
  $("tab-register").classList.toggle("on", m === "register");
  $("auth-submit").textContent = m === "login" ? "دخول" : "إنشاء حساب";
  $("password").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
}
$("tab-login").onclick = () => setAuthMode("login");
$("tab-register").onclick = () => setAuthMode("register");
$("auth-submit").onclick = async () => {
  const email = $("email").value.trim(), password = $("password").value;
  try {
    const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const d = await api("POST", path, { email, password });
    token = d.token; localStorage.setItem(tk, token);
    msg(authMode === "login" ? "تم الدخول ✓" : "تم إنشاء الحساب ✓"); loadAccount();
  } catch (e) { msg(e.message, "err"); }
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("auth-submit").click(); });

// ===== الإعدادات والباقات =====
async function loadConfig() {
  try { CFG = await api("GET", "/api/config"); } catch { CFG = null; }
  const pro = CFG?.pricing?.plans?.pro || { monthly: 29, annual: 290, lifetime: 749 };
  const cur = CFG?.pricing?.currencyLabel || "ريال";
  const opts = [
    { c: "monthly", n: "شهري", a: pro.monthly, u: cur + "/شهر" },
    { c: "annual", n: "سنوي", a: pro.annual, u: cur + "/سنة", save: CFG?.pricing?.annualNote || "" },
    { c: "lifetime", n: "مدى الحياة", a: pro.lifetime, u: cur },
  ];
  $("plan-opts").innerHTML = opts.map((o) => `
    <div class="plan-opt${o.c === selectedCycle ? " sel" : ""}" data-cycle="${o.c}">
      <div class="nm">${o.n}</div>
      <div class="amt">${o.a} <small>${o.u}</small></div>
      ${o.save ? `<span class="save">${esc(o.save)}</span>` : ""}
    </div>`).join("");
  $("plan-opts").querySelectorAll(".plan-opt").forEach((el) => el.onclick = () => {
    selectedCycle = el.dataset.cycle;
    $("plan-opts").querySelectorAll(".plan-opt").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel");
  });
}

// ===== الحساب =====
async function loadAccount() {
  try {
    const { user, entitlement } = await api("GET", "/api/me");
    $("u-email").textContent = user.email;
    const isPro = entitlement.plan === "pro" && entitlement.valid !== false;
    $("u-plan").innerHTML = `<span class="pill ${isPro ? "pro" : "free"}">${isPro ? "Pro ✦" : "مجاني"}</span>`;
    $("u-exp").textContent = dt(entitlement.expiresAt);
    // بطاقة الحالة
    const sc = $("status-card");
    if (isPro) {
      sc.className = "hero-status pro";
      sc.innerHTML = `<div class="lab">اشتراكك الحالي</div><div class="pn">Cognita Pro ✦</div>
        <div class="sub">${entitlement.expiresAt ? "يسري حتى " + dt(entitlement.expiresAt) : "اشتراك مدى الحياة — بلا انتهاء"} · كل ميزات الذكاء والمزامنة والوكلاء مفعّلة.</div>`;
    } else {
      sc.className = "hero-status free";
      sc.innerHTML = `<div class="lab" style="color:var(--muted)">باقتك الحالية</div><div class="pn">الباقة المجانية</div>
        <div class="sub muted">ترقَّ إلى Pro لفتح التحسين بالذكاء، تشغيل الوكلاء، البحث التلقائي، المزامنة السحابية، ووكيل نماذج الخادم.</div>
        <div class="cta"><button class="btn primary sm" id="go-pro">ترقَّ إلى Pro ✦</button></div>`;
      const g = $("go-pro"); if (g) g.onclick = () => $("sub-title").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // مفتاح التفعيل
    if (user.licenseKey) {
      $("u-key").textContent = user.licenseKey;
      $("u-keychip").innerHTML = `<div class="keychip"><span>${esc(user.licenseKey)}</span><button class="btn sm ghost" id="copy-key">نسخ</button></div>`;
      const ck = $("copy-key"); if (ck) ck.onclick = () => navigator.clipboard.writeText(user.licenseKey).then(() => msg("نُسخ المفتاح ✓"));
    } else { $("u-key").textContent = "—"; $("u-keychip").innerHTML = ""; }
    $("sub-title").textContent = isPro ? "تجديد اشتراك Pro" : "الاشتراك في Pro";
    show(true); loadInvoices();
  } catch { token = ""; localStorage.removeItem(tk); show(false); }
}

// ===== الفواتير (بطاقات متجاوبة) =====
const stPill = (st) => `<span class="pill ${st === "paid" ? "fulfilled" : st === "canceled" ? "free" : "pending"}">${st === "paid" ? "مدفوعة" : st === "canceled" ? "ملغاة" : "بانتظار الدفع"}</span>`;
async function loadInvoices() {
  try {
    const { invoices } = await api("GET", "/api/invoices/mine");
    INVOICES = invoices;
    if (!invoices.length) { $("invoices").innerHTML = `<div class="empty">لا فواتير بعد. أنشئ طلب اشتراك للبدء.</div>`; return; }
    $("invoices").innerHTML = `<div class="inv-list">` + invoices.map((v) => `
      <div class="inv">
        <div class="inv-top">
          <div class="inv-meta">
            <div class="num">${esc(v.number || v.id)}</div>
            <div class="d">${dt(v.created_at)} · ${v.type === "renewal" ? "تجديد" : "اشتراك"} ${esc(v.plan)}/${cycleAr(v.cycle)}</div>
          </div>
          <div class="inv-right"><div class="inv-amt">${money(esc(v.amount), esc(v.currency))}</div>${stPill(v.status)}</div>
        </div>
        <div class="inv-actions">
          <button class="btn sm ghost" data-pdf="${v.id}">⬇ فاتورة PDF</button>
          ${v.status === "unpaid" ? `<input data-ref="${v.id}" placeholder="مرجع التحويل"><button class="btn sm" data-sendref="${v.id}">إرسال المرجع</button>` : ""}
        </div>
        ${v.issued_key ? `<div class="keychip"><span>${esc(v.issued_key)}</span><button class="btn sm ghost" data-copy="${esc(v.issued_key)}">نسخ</button></div>` : ""}
      </div>`).join("") + `</div>`;
    // ربط الإجراءات
    $("invoices").querySelectorAll("[data-pdf]").forEach((b) => b.onclick = () => { const v = INVOICES.find((x) => x.id === b.dataset.pdf); if (v) printInvoice(v); });
    $("invoices").querySelectorAll("[data-sendref]").forEach((b) => b.onclick = async () => {
      const ref = $("invoices").querySelector(`[data-ref="${b.dataset.sendref}"]`).value.trim();
      if (!ref) return msg("أدخِل مرجع التحويل", "err");
      try { await api("POST", `/api/invoices/${b.dataset.sendref}/reference`, { reference: ref }); msg("تم إرسال المرجع ✓ — سنراجع ونُصدر المفتاح"); loadInvoices(); }
      catch (e) { msg(e.message, "err"); }
    });
    $("invoices").querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => msg("نُسخ المفتاح ✓")));
  } catch { $("invoices").innerHTML = `<div class="empty">تعذّر تحميل الفواتير.</div>`; }
}
$("inv-refresh").onclick = () => loadInvoices();

// طباعة/تنزيل فاتورة PDF بهوية Cognita
function printInvoice(v) {
  const b = CFG?.brand || {}, pay = CFG?.payment || {};
  const stAr = v.status === "paid" ? "مدفوعة" : v.status === "canceled" ? "ملغاة" : "بانتظار الدفع";
  const stCss = v.status === "paid" ? "#dcfce7;color:#166534" : v.status === "canceled" ? "#f3f4f6;color:#6b7280" : "#fef3c7;color:#92400e";
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) { msg("اسمح بالنوافذ المنبثقة لتنزيل الفاتورة.", "err"); return; }
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>فاتورة ${esc(v.number || v.id)}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap");
    *{box-sizing:border-box}body{font-family:"IBM Plex Sans Arabic",sans-serif;color:#1f2937;margin:0;padding:38px 42px;line-height:1.8}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6366f1;padding-bottom:18px;margin-bottom:24px}
    .logo{font-size:22px;font-weight:800;color:#6366f1}.logo small{display:block;color:#6b7280;font-size:12px;font-weight:500}
    .ttl{text-align:left}.ttl h1{margin:0;font-size:26px;color:#0f1729}.ttl .num{color:#6b7280;font-size:13px}
    .meta{display:flex;justify-content:space-between;gap:14px;margin-bottom:20px;font-size:14px}
    .meta .box{background:#f7f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 15px;flex:1}
    .meta .box b{color:#0f1729}
    table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:14px}
    th,td{border:1px solid #e5e7eb;padding:11px 13px;text-align:right}th{background:#f3f4f6;color:#374151}
    .tot{text-align:left;font-size:20px;font-weight:800;color:#0f1729;margin:8px 0}
    .st{display:inline-block;padding:5px 14px;border-radius:100px;font-size:13px;font-weight:700;background:${stCss}}
    .pay{background:#f7f8fb;border:1px dashed #cbd5e1;border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13px;color:#374151;margin-top:14px}
    .key{font-family:monospace;font-size:16px;letter-spacing:1px;background:#0b1020;color:#a5b0ff;padding:12px;border-radius:9px;text-align:center;direction:ltr;margin-top:12px}
    .ft{margin-top:30px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;color:#6b7280;font-size:12px}
    @media print{body{padding:14px}}
  </style></head><body>
    <div class="hd">
      <div class="logo">${esc(b.name || "Cognita")}<small>${esc(b.tagline || "")}</small><small>${esc(b.url || "")}</small></div>
      <div class="ttl"><h1>فاتورة</h1><div class="num">${esc(v.number || v.id)}</div></div>
    </div>
    <div class="meta">
      <div class="box"><b>العميل</b><br>${esc(v.email)}</div>
      <div class="box"><b>التاريخ</b><br>${dt(v.created_at)}${v.paid_at ? `<br><b>تاريخ الدفع</b><br>${dt(v.paid_at)}` : ""}</div>
      <div class="box"><b>الحالة</b><br><span class="st">${stAr}</span></div>
    </div>
    <table><tr><th>الوصف</th><th>الباقة</th><th>الدورة</th><th>المبلغ</th></tr>
      <tr><td>${v.type === "renewal" ? "تجديد اشتراك Cognita Pro" : "اشتراك Cognita Pro"}</td><td>${esc(v.plan)}</td><td>${cycleAr(v.cycle)}</td><td>${money(esc(v.amount), esc(v.currency))}</td></tr>
    </table>
    <div class="tot">الإجمالي: ${money(esc(v.amount), esc(v.currency))}</div>
    ${v.issued_key ? `<div><b>مفتاح التفعيل</b><div class="key">${esc(v.issued_key)}</div></div>` : ""}
    ${v.status !== "paid" && pay.bankDetails ? `<div class="pay"><b>بيانات الدفع</b>\n${esc(pay.bankDetails)}${pay.instructions ? "\n\n" + esc(pay.instructions) : ""}</div>` : ""}
    <div class="ft">${esc(b.copyright || "© Cognita")} · ${esc(b.email || "")}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script>
  </body></html>`);
  win.document.close();
}

// ===== إجراءات أخرى =====
$("logout").onclick = () => { token = ""; localStorage.removeItem(tk); show(false); };
$("activate").onclick = async () => { try { await api("POST", "/api/license/activate", { key: $("license").value.trim() }); msg("تم التفعيل ✓"); loadAccount(); } catch (e) { msg(e.message, "err"); } };
$("order").onclick = async () => { try { const d = await api("POST", "/api/orders", { cycle: selectedCycle }); msg("أُنشئت الفاتورة — أكمل الدفع"); showPay(d.invoice, d.payment); loadInvoices(); } catch (e) { msg(e.message, "err"); } };
$("renew").onclick = async () => { try { const d = await api("POST", "/api/subscription/renew", { cycle: selectedCycle }); msg("أُنشئت فاتورة تجديد"); showPay(d.invoice, d.payment); loadInvoices(); } catch (e) { msg(e.message, "err"); } };

function showPay(invoice, payment) {
  const p = payment || CFG?.payment || {};
  $("pay").style.display = "block";
  $("pay").innerHTML = `<b>فاتورة ${esc(invoice.number)} — ${money(esc(invoice.amount), esc(invoice.currency))}</b>
    <pre style="white-space:pre-wrap;margin:8px 0;direction:rtl;font-family:inherit">${esc(p.bankDetails || "")}</pre>
    <div class="muted small">${esc(p.instructions || "")}</div>
    <label style="margin-top:8px">مرجع عملية التحويل</label>
    <input id="ref" placeholder="رقم الحوالة">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn primary sm" id="send-ref">إرسال المرجع</button>
      <button class="btn ghost sm" id="pay-pdf">⬇ تنزيل الفاتورة PDF</button>
    </div>`;
  $("send-ref").onclick = async () => {
    try { await api("POST", `/api/invoices/${invoice.id}/reference`, { reference: $("ref").value.trim() }); msg("تم إرسال المرجع ✓ — سنراجع ونُصدر المفتاح"); loadInvoices(); }
    catch (e) { msg(e.message, "err"); }
  };
  $("pay-pdf").onclick = () => printInvoice(invoice);
}

loadConfig();
setAuthMode("login");
if (token) loadAccount(); else show(false);
