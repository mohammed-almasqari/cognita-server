# خادم Cognita — المنتج المتكامل (نشر وتشغيل)

الطبقة الخلفية + موقع المنتج لإضافة Cognita: حسابات العملاء، التراخيص (مجاني/Pro)، الدفع اليدوي وطلبات الترقية، المزامنة السحابية، **موقع كامل** (هبوط، تسعير، خصوصية، شروط، تواصل)، ولوحة تحكم احترافية. مبني على **Node + Express + PostgreSQL**.

---

## ما الذي يقدّمه

**الموقع (يخدمه الخادم):**
`/` هبوط · `/pricing` الأسعار · `/privacy` الخصوصية · `/terms` الشروط · `/contact` تواصل · `/app` لوحة التحكم.

**واجهات API:**
| الطريق | الطريقة | الوصف |
|--------|:------:|--------|
| `/api/health` · `/api/config` | GET | الصحة + إعدادات العلامة/التسعير |
| `/api/auth/register` · `/login` | POST | تسجيل العملاء |
| `/api/me` · `/api/license/validate` | GET | الحساب والصلاحية |
| `/api/license/activate` | POST | تفعيل مفتاح |
| `/api/orders` | POST | طلب ترقية (دفع يدوي) |
| `/api/sync/push` · `/pull` | POST/GET | المزامنة (Pro) |
| `/api/admin/licenses` | POST | توليد مفاتيح (`x-admin-token`) |
| `/api/admin/requests` · `/:id/fulfill` | GET/POST | إدارة الطلبات وإصدار المفاتيح |

---

## 1) التشغيل المحلي

```bash
cp .env.example .env        # املأ JWT_SECRET, ADMIN_TOKEN, PGPASSWORD
docker compose up -d --build   # يشغّل PostgreSQL + الخادم معاً
# الموقع: http://localhost:8080
```

> `docker-compose.yml` يتضمّن خدمة PostgreSQL جاهزة مع قرص دائم — لا إعداد يدوي للقاعدة.

تشغيل بدون Docker (يتطلّب Postgres محلياً):
```bash
npm install
export DATABASE_URL=postgres://USER:PASS@localhost:5432/cognita
npm start
```

---

## 2) النشر على VPS عبر Coolify ⭐ (مع PostgreSQL)

> المتطلبات: VPS عليه Coolify، ونطاق فرعي (مثل `api.yourdomain.com`) يشير للخادم.

**الخطوة 1 — أنشئ قاعدة PostgreSQL في Coolify**
- `+ New` → `Database` → **PostgreSQL** → اختر الخادم → Create.
- بعد الإنشاء، انسخ **Connection String الداخلي** (يبدأ بـ `postgres://...@<اسم-الخدمة>:5432/...`).

**الخطوة 2 — ارفع المشروع إلى Git** (GitHub/GitLab)، مجلد `cognita-server`.

**الخطوة 3 — أنشئ تطبيق الخادم**
- `+ New` → `Resource` → **Git Repository** → اختر المستودع والفرع.
- Build Pack: **Dockerfile** (يُكتشف تلقائياً).
- **Port = 8080**.

**الخطوة 4 — اربط القاعدة ومتغيّرات البيئة**
أضِف في Environment Variables:
```
DATABASE_URL=<Connection String من الخطوة 1>
JWT_SECRET=<سلسلة عشوائية طويلة>
ADMIN_TOKEN=<رمز إدارة قوي>
PORT=8080
PGSSL=false
```
> تأكّد أن تطبيق الخادم وقاعدة PostgreSQL في **نفس المشروع/الشبكة** داخل Coolify ليصل أحدهما للآخر بالاسم الداخلي.

**الخطوة 5 — النطاق وSSL**
ضع `https://api.yourdomain.com` في Domains — يُصدر Coolify شهادة Let's Encrypt تلقائياً.

**الخطوة 6 — انشر** ثم تحقّق:
- `https://api.yourdomain.com/api/health` → `{ "ok": true }`
- `https://api.yourdomain.com` → صفحة الهبوط.
- الجداول تُنشأ تلقائياً عند أول إقلاع.

---

## 3) سير الدفع اليدوي وإصدار المفاتيح

1. العميل ينشئ حساباً من `/app` ← يختار خطة ← يحوّل المبلغ ← يرسل **طلب ترقية** بمرجع العملية.
2. المشرف يفتح `/app` ← «لوحة المشرف» ← يدخل `ADMIN_TOKEN` ← «تحديث الطلبات».
3. يضغط **«إصدار مفتاح»** أمام الطلب → يتولّد مفتاح Pro → يرسله للعميل عبر البريد.
4. العميل يلصق المفتاح في «تفعيل الترخيص» → يتحوّل حسابه إلى Pro.

توليد مفاتيح يدوياً (بديل):
```bash
curl -X POST https://api.yourdomain.com/api/admin/licenses \
  -H "Content-Type: application/json" -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"tier":"pro","days":365,"count":5}'
```

---

## 4) ربط الإضافة

في الإضافة: ⚙ الإعدادات ← «الحساب والترخيص» ← ضع رابط الخادم `https://api.yourdomain.com` ← سجّل الدخول ← فعّل المفتاح.

---

## 5) التخصيص قبل الإطلاق

عدّل `config.js`:
- **BRAND:** الاسم، النطاق، البريد الرسمي، الهاتف، روابط التواصل.
- **PRICING:** الأسعار بالريال (مجاني 0 · Pro شهري 29 · سنوي 290 · مدى الحياة 749) — قابلة للتعديل.
- **PAYMENT:** بيانات الحساب البنكي/المحفظة وتعليمات الدفع.

وعدّل النصوص القانونية في `public/privacy.html` و`public/terms.html` واستشر مختصاً.

---

## الأمان والنسخ الاحتياطي

- قيم قوية لـ `JWT_SECRET` و`ADMIN_TOKEN`؛ كل المرور عبر HTTPS؛ كلمات المرور بـ bcrypt.
- النسخ الاحتياطي: فعّل النسخ الدوري لقاعدة PostgreSQL من Coolify.

© 2026 Cognita. جميع الحقوق محفوظة.
