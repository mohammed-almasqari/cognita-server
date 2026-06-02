// models.js — استدعاء نماذج الذكاء من الخادم (Model Proxy) بمفاتيح الخادم
// يعمل على Node 18+ (fetch مدمج). يُستخدم لمشتركي Pro عبر /api/model/proxy.

export const PROVIDERS = {
  openai: { label: "OpenAI", defaultModel: "gpt-4o-mini" },
  anthropic: { label: "Anthropic", defaultModel: "claude-3-5-haiku-latest" },
  gemini: { label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
};

export async function callModel({ provider, model, system, user, temperature = 0.5, key }) {
  if (!key) throw new Error(`لم يُضبط مفتاح ${PROVIDERS[provider]?.label || provider} في الخادم.`);
  if (provider === "openai") return openai({ key, model, system, user, temperature });
  if (provider === "anthropic") return anthropic({ key, model, system, user, temperature });
  if (provider === "gemini") return gemini({ key, model, system, user, temperature });
  throw new Error("مزوّد غير معروف: " + provider);
}

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data?.error?.message || data?.message || `${res.status}`;
    const e = new Error(m); e.status = res.status; throw e;
  }
  return data;
}

async function openai({ key, model, system, user, temperature }) {
  const d = await jfetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model || PROVIDERS.openai.defaultModel, temperature,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }],
    }),
  });
  return d.choices?.[0]?.message?.content?.trim() || "";
}

async function anthropic({ key, model, system, user, temperature }) {
  const d = await jfetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model || PROVIDERS.anthropic.defaultModel, max_tokens: 2048, temperature,
      ...(system ? { system } : {}), messages: [{ role: "user", content: user }],
    }),
  });
  return (d.content || []).map((b) => b.text || "").join("").trim();
}

async function gemini({ key, model, system, user, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || PROVIDERS.gemini.defaultModel}:generateContent?key=${encodeURIComponent(key)}`;
  const d = await jfetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature },
    }),
  });
  return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}
