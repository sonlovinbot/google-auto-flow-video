import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { i18n, translations } from "../i18n.js";
import { state } from "../state.js";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles() {
  return readdirSync(projectDirectory)
    .filter((name) => /\.(js|html)$/.test(name) && name !== "i18n.js")
    .map((name) => readFileSync(join(projectDirectory, name), "utf8"));
}

const source = sourceFiles().join("\n");

function referencedKeys() {
  const keys = new Set();
  for (const match of source.matchAll(/i18n\(\s*"([a-z0-9_]+)"/gi)) {
    keys.add(match[1]);
  }
  for (const match of source.matchAll(
    /data-lang(?:-key|-placeholder|-title)="([a-z0-9_]+)"/gi,
  )) {
    keys.add(match[1]);
  }
  return keys;
}

test("every referenced translation key exists in English", () => {
  const missing = [...referencedKeys()].filter(
    (key) => translations.en[key] === undefined,
  );
  assert.deepEqual(missing, []);
});

test("Vietnamese and English define exactly the same keys", () => {
  const viOnly = Object.keys(translations.vi).filter(
    (key) => translations.en[key] === undefined,
  );
  const enOnly = Object.keys(translations.en).filter(
    (key) => translations.vi[key] === undefined,
  );
  assert.deepEqual(viOnly, []);
  assert.deepEqual(enOnly, []);
});

test("no dead translation keys are shipped", () => {
  const referenced = referencedKeys();
  // Keys picked dynamically, e.g. i18n(cond ? "a" : "b", ...).
  for (const match of source.matchAll(
    /\?\s*"([a-z0-9_]+)"\s*\n?\s*:\s*"([a-z0-9_]+)"/gi,
  )) {
    if (translations.en[match[1]]) referenced.add(match[1]);
    if (translations.en[match[2]]) referenced.add(match[2]);
  }
  const unused = Object.keys(translations.en).filter(
    (key) => !referenced.has(key),
  );
  assert.deepEqual(unused, []);
});

test("a locale missing a key falls back to English, not a raw placeholder", () => {
  const originalLanguage = state.currentLang;
  try {
    // hi/th/ur/bn/es are not authored for the newer keys.
    state.currentLang = "hi";
    const text = i18n("report_no_failures");
    assert.equal(text, translations.en.report_no_failures);
    assert.doesNotMatch(text, /^\[.*\]$/);
  } finally {
    state.currentLang = originalLanguage;
  }
});

test("unknown keys are still reported as placeholders", () => {
  assert.equal(i18n("definitely_not_a_key"), "[definitely_not_a_key]");
});

test("placeholders are replaced everywhere they appear", () => {
  const originalLanguage = state.currentLang;
  try {
    state.currentLang = "en";
    // replace() only substituted the first occurrence.
    assert.equal(
      i18n("report_failures_header", { count: 3 }),
      "=== FAILED TASKS (3) ===",
    );
    assert.equal(
      i18n("log_download_failed", {
        path: "a/b.mp4",
        attempt: 2,
        reason: "boom",
      }),
      'Downloading "a/b.mp4" failed (2/3): boom',
    );
  } finally {
    state.currentLang = originalLanguage;
  }
});

test("no user-facing module hardcodes Vietnamese outside i18n.js", () => {
  const vietnameseOnly = /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  for (const name of [
    "handlers.js",
    "scanner.js",
    "ui.js",
    "config.js",
    "automation.js",
    "design-ui.js",
    "sidepanel.js",
    "language.js",
  ]) {
    const text = readFileSync(join(projectDirectory, name), "utf8");
    const offending = text
      .split("\n")
      .filter((line) => vietnameseOnly.test(line));
    assert.deepEqual(offending, [], `${name} still hardcodes Vietnamese`);
  }
});
