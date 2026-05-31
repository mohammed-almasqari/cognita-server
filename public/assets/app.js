// app.js — منطق لوحة التحكم
const $ = (id) => document.getElementById(id);
const tk = "cognita_token";
let token = localStorage.getItem(tk) || "";
let CFG = null;

function msg(t, kind = "ok") {
  const m = $("msg"); m.textContent = t; m.className = "msg " + kind;
  m.scrollIntoView({ block: "nearest" });
  setTimeout(() => (m.className = "msg"), 4500);
}
async function jget(p) {
  const r = await fetch(p, { headers: token ? { Authorization: "Bearer " + token } : {} });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "حدث خطأ");
  return d;
}
async function jpost(p, body, admin) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  if (admin) h["x-admin-token"] = $("admin-token").value;
  const r = await fetch(p, { method: "POST", headers: h, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "حدث خطأ");
  return d;
}
const show = (loggedIn) => {
  $("auth").style.display = loggedIn ? "none" : "block";
  $("account").style.display = loggedIn ? "block" : "none";
};

async function loadConfig() {
  try { CFG = await jget("/api/config"); } catch { CFG = null; }
  renderPayBox();
}
function renderPayBox() {
  const box = $("pay-instructions");
  if (!CFG) { box.textContent = "تواصل معنا لتعليمات الدفع."; return; }
  const m = (CFG.payment.methods || []).map(
    (x) => `<div style="margin-bottom:8px"><b>${x.title}</b><br>${(x.details || []).join("<br>")}</div>`
  ).join("");
  box.innerHTML = m + `<div class="muted small" style="margin-top:6px">${CFG.payment.instructions || ""}</div>`;
}
function amountFor(cycle) {
  const p = CFG?.pricing?.plans?.pro || { monthly: 29, annual: 290, lifetime: 749 };
  const cur = CFG?.pricing?.currencyLabel || "ريال";
  const v = p[cycle] ?? p.monthly;
  return `${v} ${cur}`;
}

async function loadAccount() {
  try {
    const { user, entitlement } = await jget("/api/me");
    $("u-email").textContent = user.email;
    $("u-plan").innerHTML = `<span class="pill ${entitlement.plan}">${entitlement.plan === "pro" ? "Pro ✦" : "مجاني"}</span>`;
    $("u-exp").textContent = entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString("ar") : "—";
    show(true);
  } catch {
    token = ""; localStorage.removeItem(tk); show(false);
  }
}

// مصادقة
$("login").onclick = async () => {
  try { const d = await jpost("/api/auth/login", { email: $("email").value.trim(), password: $("password").value });
    token = d.token; localStorage.setItem(tk, token); msg("تم تسجيل الدخول ✓"); loadAccount();
  } catch (e) { msg(e.message, "err"); }
};
$("register").onclick = async () => {
  try { const d = await jpost("/api/auth/register", { email: $("email").value.trim(), password: $("password").value });
    token = d.token; localStorage.setItem(tk, token); msg("تم إنشاء الحساب ✓"); loadAccount();
  } catch (e) { msg(e.message, "err"); }
};
$("logout").onclick = () => { token = ""; localStorage.removeItem(tk); show(false); };

// ترخيص
$("activate").onclick = async () => {
  try { await jpost("/api/license/activate", { key: $("license").value.trim() });
    msg("تم تفعيل الترخيص ✓ — مرحباً بك في Pro"); loadAccount();
  } catch (e) { msg(e.message, "err"); }
};

// طلب ترقية
$("cycle").onchange = () => {};
$("order").onclick = async () => {
  try {
    const cycle = $("cycle").value;
    await jpost("/api/orders", { plan: "pro", cycle, amount: amountFor(cycle), reference: $("ref").value.trim(), note: $("note").value.trim() });
    msg("تم إرسال طلب الترقية ✓ — سنُصدر مفتاحك خلال 24 ساعة");
    $("ref").value = ""; $("note").value = "";
  } catch (e) { msg(e.message, "err"); }
};

// المشرف
$("gen").onclick = async () => {
  try { const d = await jpost("/api/admin/licenses", { tier: "pro", days: Number($("g-days").value) || 365, count: Number($("g-count").value) || 1 }, true);
    $("keys").style.display = "block"; $("keys").textContent = d.keys.join("\n"); msg(`تم توليد ${d.keys.length} مفتاح`);
  } catch (e) { msg(e.message, "err"); }
};
$("load-reqs").onclick = async () => {
  try {
    const r = await fetch("/api/admin/requests", { headers: { "x-admin-token": $("admin-token").value } });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "خطأ");
    const rows = (d.requests || []).map((x) => `<tr>
      <td>${x.email || "-"}</td><td>${x.cycle || "-"}</td><td>${x.amount || "-"}</td>
      <td>${x.reference || "-"}</td>
      <td><span class="pill ${x.status}">${x.status === "fulfilled" ? "مُنفّذ" : "معلّق"}</span></td>
      <td>${x.issued_key ? `<code>${x.issued_key}</code>` : `<button class="btn sm" data-fid="${x.id}">إصدار مفتاح</button>`}</td>
    </tr>`).join("");
    $("reqs").innerHTML = rows
      ? `<table class="t"><tr><th>البريد</th><th>الخطة</th><th>المبلغ</th><th>المرجع</th><th>الحالة</th><th>إجراء</th></tr>${rows}</table>`
      : `<p class="muted small">لا طلبات.</p>`;
    document.querySelectorAll("[data-fid]").forEach((b) => (b.onclick = async () => {
      try { const f = await jpost(`/api/admin/requests/${b.dataset.fid}/fulfill`, { days: 365 }, true);
        msg(`تم إصدار المفتاح ${f.key} — أرسله للعميل`); $("load-reqs").click();
      } catch (e) { msg(e.message, "err"); }
    }));
  } catch (e) { msg(e.message, "err"); }
};

// إقلاع
loadConfig();
if (token) loadAccount(); else show(false);
