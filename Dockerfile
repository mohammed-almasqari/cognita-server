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

# فحص صحة بسيط
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
