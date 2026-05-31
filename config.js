// config.js — إعدادات المنتج (علامة، تسعير، دفع، تواصل)
// ⚠️ استبدل القيم النائبة (بين «») بقيمك الرسمية قبل الإطلاق.

export const BRAND = {
  name: "Cognita",
  tagline: "استوديو الذكاء الاصطناعي داخل متصفحك",
  domain: "cognita.example.com",          // ← نطاقك
  email: "support@cognita.example.com",    // ← بريدك الرسمي
  salesEmail: "sales@cognita.example.com",
  phone: "+966 5X XXX XXXX",               // ← رقم التواصل
  company: "«اسم الشركة / المؤسسة»",       // ← الكيان القانوني
  social: {
    x: "https://x.com/your_handle",
    linkedin: "https://linkedin.com/company/your_company",
  },
  copyright: "© 2026 Cognita. جميع الحقوق محفوظة.",
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
};

// تعليمات الدفع اليدوي / التحويل (قابلة للتحرير من لوحة الأدمن)
export const PAYMENT = {
  bankDetails:
    "اسم المستفيد: «اسم المستفيد»\nالبنك: «اسم البنك»\nIBAN: SA00 0000 0000 0000 0000 0000\nمحفظة STC Pay: «الرقم»",
  instructions:
    "بعد التحويل، أدخِل مرجع العملية في «طلب ترقية» بلوحة التحكم، وسنُصدر مفتاح التفعيل ونرسله لبريدك خلال 24 ساعة.",
};
