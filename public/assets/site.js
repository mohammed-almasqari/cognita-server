// site.js — يحقن الترويسة والتذييل المشتركين في كل صفحات الموقع
const DEFAULTS = {
  name: "Cognita",
  tagline: "استوديو الذكاء الاصطناعي داخل متصفحك",
  email: "support@cognita.example.com",
  domain: "cognita.example.com",
  copyright: "© 2026 Cognita. جميع الحقوق محفوظة.",
  x: "#", linkedin: "#",
};

function navHTML(b) {
  return `<div class="nav"><div class="wrap row">
    <a class="brand" href="/"><img src="/assets/icon.png" alt=""> ${b.name}</a>
    <div class="nav-links">
      <a href="/#features">المميزات</a>
      <a href="/pricing">الأسعار</a>
      <a href="/#how">كيف يعمل</a>
      <a href="/contact">تواصل</a>
    </div>
    <a class="btn primary sm" href="/app">تسجيل الدخول</a>
  </div></div>`;
}
function footerHTML(b) {
  return `<div class="footer"><div class="wrap">
    <div class="cols">
      <div style="max-width:300px">
        <div class="brand"><img src="/assets/icon.png" style="width:30px;height:30px;border-radius:8px" alt=""> ${b.name}</div>
        <p class="muted" style="margin-top:10px">${b.tagline}</p>
      </div>
      <div><h4>المنتج</h4><a href="/#features">المميزات</a><a href="/pricing">الأسعار</a><a href="/app">لوحة التحكم</a><a href="/docs">توثيق API</a></div>
      <div><h4>قانوني</h4><a href="/privacy">سياسة الخصوصية</a><a href="/terms">الشروط والأحكام</a></div>
      <div><h4>تواصل</h4>
        <a href="mailto:${b.email}">${b.email}</a>
        <a href="${b.x}" target="_blank" rel="noopener noreferrer">X / تويتر</a>
        <a href="${b.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
      </div>
    </div>
    <div class="copy">${b.copyright}</div>
    <p class="disc">الأسماء التجارية للنماذج (GPT وClaude وGemini وغيرها) ملك لأصحابها. Cognita أداة مستقلة تتصل بها عبر مفاتيحك الخاصة.</p>
  </div></div>`;
}

(async function () {
  let b = { ...DEFAULTS };
  try {
    const r = await fetch("/api/config");
    if (r.ok) {
      const c = await r.json();
      b = {
        ...b, name: c.brand.name, tagline: c.brand.tagline, email: c.brand.email,
        domain: c.brand.domain, copyright: c.brand.copyright,
        x: c.brand.social?.x || "#", linkedin: c.brand.social?.linkedin || "#",
      };
    }
  } catch {}
  const nav = document.getElementById("site-nav");
  const foot = document.getElementById("site-footer");
  if (nav) nav.innerHTML = navHTML(b);
  if (foot) foot.innerHTML = footerHTML(b);
})();
