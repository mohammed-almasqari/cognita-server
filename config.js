// config.js — إعدادات المنتج (علامة، تسعير، دفع، تواصل)
// ⚠️ استبدل القيم النائبة (بين «») بقيمك الرسمية قبل الإطلاق.

export const BRAND = {
  name: "Cognita",
  tagline: "استوديو الذكاء الاصطناعي داخل متصفحك",
  domain: "cognita.dalilai.net",
  url: "https://cognita.dalilai.net",
  email: "support@dalilai.net",            // البريد الرسمي للدعم
  salesEmail: "sales@dalilai.net",
  phone: "+966 5X XXX XXXX",               // ← حدّث رقمك إن رغبت
  owner: "Mohammed Almasqari",
  company: "Mohammed Almasqari",
  social: {
    x: "https://x.com/your_handle",        // ← حدّث روابطك
    linkedin: "https://linkedin.com/in/your_handle",
  },
  copyright: "© 2026 Mohammed Almasqari — جميع الحقوق محفوظة.",
};

// التسعير بالريال السعودي (قابل للتعديل).
// ملاحظة: الإضافة تعمل بمفتاح API الخاص بالعميل، فتكلفة استهلاك النماذج عليه؛
// لذا اشتراك Pro رسم برمجي/استضافة لفتح الميزات والمزامنة والوكلاء.
export const PRICING = {
  currency: "SAR",
  currencyLabel: "ريال",
  plans: {
    free: { name: "مجاني", monthly: 0, annual: 0, lifetime: 0 },
    pro: { name: "Pro", monthly: 29, annual: 290, lifetime: 749 },
  },
  annualNote: "وفّر ~17% (شهران مجاناً)",
  trialDays: 0, // فترة تجربة Pro المجانية (0 = معطّلة) — تُضبط من لوحة الأدمن
};

// إعدادات الدفع (قابلة للتحرير من لوحة الأدمن ← إعدادات الدفع)
export const PAYMENT = {
  // التحويل البنكي اليدوي
  bankEnabled: true,
  bankDetails:
    "اسم المستفيد: «اسم المستفيد»\nالبنك: «اسم البنك»\nIBAN: SA00 0000 0000 0000 0000 0000\nمحفظة STC Pay: «الرقم»",
  instructions:
    "بعد التحويل، أدخِل مرجع العملية وأرفِق صورة الإيصال في الفاتورة بلوحة التحكم، وسنُصدر مفتاح التفعيل ونرسله لبريدك خلال 24 ساعة.",
  // PayPal (تلقائي) — تُدخَل المفاتيح من لوحة الأدمن وتبقى سرّية في القاعدة.
  // ملاحظة: PayPal قد لا يدعم الريال (SAR)، لذا تُضبط عملة PayPal ومُعامل التحويل من SAR.
  paypal: { enabled: false, clientId: "", secret: "", mode: "live", currency: "USD", rate: 1 },
};
