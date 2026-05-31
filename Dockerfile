# Dockerfile — صورة خفيفة بلا تبعيات أصلية (سهلة النشر على Coolify)
FROM node:20-alpine

WORKDIR /app

# تثبيت التبعيات أولاً للاستفادة من طبقات الكاش
COPY package.json ./
RUN npm install --omit=dev

# نسخ بقية المشروع
COPY . .

ENV PORT=8080

EXPOSE 8080

# فحص صحة يتبع المنفذ الفعلي (PORT) تلقائياً مع فترة بدء كافية
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- "http://localhost:${PORT:-8080}/api/health" || exit 1

CMD ["node", "server.js"]
