import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(testDirectory);
const html = readFileSync(join(projectDirectory, "sidepanel.html"), "utf8");
const css = readFileSync(join(projectDirectory, "sidepanel.css"), "utf8");
const domModule = readFileSync(join(projectDirectory, "dom.js"), "utf8");
const handlers = readFileSync(join(projectDirectory, "handlers.js"), "utf8");

test("new sidepanel keeps every DOM id required by the extension runtime", () => {
  const elementIdsBlock = domModule.match(
    /const ELEMENT_IDS = \{([\s\S]*?)\n\};/,
  );
  assert.ok(elementIdsBlock, "dom.js must declare an ELEMENT_IDS map");
  const requiredIds = [
    ...elementIdsBlock[1].matchAll(/:\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(requiredIds.length > 30, "expected the full element id map");

  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(
    (match) => match[1],
  );

  const missing = [...new Set(requiredIds)].filter(
    (id) => !htmlIds.includes(id),
  );
  const duplicates = htmlIds.filter(
    (id, index) => htmlIds.indexOf(id) !== index,
  );

  assert.deepEqual(missing, []);
  assert.deepEqual(duplicates, []);
});

test("new sidepanel exposes four real work tabs and their panes", () => {
  for (const tab of ["control", "queue", "history", "settings"]) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
  }
  for (const paneId of [
    "content-control",
    "queueModalOverlay",
    "content-history",
    "content-settings",
  ]) {
    assert.match(html, new RegExp(`id="${paneId}"[^>]*tab-pane`));
  }
  assert.match(handlers, /function activateTab\(tabName\)/);
  assert.match(handlers, /tabName === "queue"/);
});

test("image prompt rows include a replaceable thumbnail without losing prompt UI", () => {
  assert.match(handlers, /image-prompt-media/);
  assert.match(handlers, /replacementInput\.addEventListener\("change"/);
  assert.match(handlers, /prompt: currentPrompt/);
  assert.match(handlers, /row\.append\(rowIndex, imagePicker, copy/);
  assert.match(css, /\.image-prompt-media img/);
});

test("design stays compact and responsive for Chrome side panels", () => {
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(html, /\sstyle="/);
});

test("history action copies the full log report and error details", () => {
  assert.match(html, /Sao chép toàn bộ nhật ký và lỗi/);
  assert.match(handlers, /logDisplay\?\.innerText/);
  assert.match(handlers, /i18n\("report_all_logs_header"\)/);
  assert.match(handlers, /i18n\("report_failures_header"/);
  assert.match(handlers, /failure\.reason/);
});

test("report strings are translated rather than hardcoded", async () => {
  const { translations } = await import("../i18n.js");
  const reportKeys = [
    "report_all_logs_header",
    "report_failures_header",
    "report_task_line",
    "report_reason_line",
    "report_no_failures",
    "status_copy_success",
  ];
  for (const key of reportKeys) {
    assert.equal(typeof translations.vi[key], "string", `vi is missing ${key}`);
    assert.equal(typeof translations.en[key], "string", `en is missing ${key}`);
  }
  assert.match(translations.vi.report_all_logs_header, /TOÀN BỘ NHẬT KÝ/);
});
