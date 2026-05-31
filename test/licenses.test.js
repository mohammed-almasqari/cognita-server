// test/licenses.test.js — اختبارات منطق الترخيص الحرج (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { genKey, featuresFor, entitlementFor, FEATURES } from "../licenses.js";

test("genKey: ينتج مفتاحاً بصيغة COG-XXXX-XXXX-XXXX", () => {
  const k = genKey();
  assert.match(k, /^COG-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test("genKey: مفاتيح فريدة", () => {
  const set = new Set(Array.from({ length: 200 }, () => genKey()));
  assert.equal(set.size, 200);
});

test("featuresFor: pro يفتح كل الميزات، free يقفلها", () => {
  assert.deepEqual(featuresFor("pro"), FEATURES.pro);
  assert.deepEqual(featuresFor("free"), FEATURES.free);
  assert.equal(featuresFor("pro").cloudSync, true);
  assert.equal(featuresFor("free").cloudSync, false);
  assert.deepEqual(featuresFor("unknown"), FEATURES.free); // افتراضي آمن
});

test("entitlementFor: اشتراك Pro سارٍ", () => {
  const e = entitlementFor({ plan: "pro", expiresAt: Date.now() + 864e5 });
  assert.equal(e.plan, "pro");
  assert.equal(e.valid, true);
  assert.equal(e.features.agentRun, true);
});

test("entitlementFor: Pro منتهٍ يسقط إلى free", () => {
  const e = entitlementFor({ plan: "pro", expiresAt: Date.now() - 1000 });
  assert.equal(e.plan, "free");
  assert.equal(e.valid, false);
  assert.equal(e.features.aiOptimize, false);
});

test("entitlementFor: Pro مدى الحياة (بلا انتهاء) سارٍ", () => {
  const e = entitlementFor({ plan: "pro", expiresAt: null });
  assert.equal(e.plan, "pro");
  assert.equal(e.valid, true);
});

test("entitlementFor: مجاني افتراضاً", () => {
  const e = entitlementFor({ plan: "free", expiresAt: null });
  assert.equal(e.plan, "free");
  assert.equal(e.valid, true);
});
