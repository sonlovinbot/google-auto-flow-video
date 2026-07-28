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
  // Replacing an image must carry the row's existing prompt across.
  assert.match(handlers, /\.\.\.pair,/);
  assert.match(handlers, /renderImagePromptPairs\(true\)/);
  assert.match(handlers, /row\.append\(rowIndex, imagePicker, copy/);
  assert.match(css, /\.image-prompt-media img/);
});

test("filmstrip renders each image once with prompts between them", () => {
  assert.match(handlers, /function createImageRow\(/);
  assert.match(handlers, /function createTransitionLink\(/);
  assert.match(handlers, /filmstrip-link/);
  assert.match(handlers, /filmstrip-summary/);
  assert.match(css, /\.filmstrip-link \{/);
  assert.match(css, /\.filmstrip-link-body \{/);
  assert.match(css, /\.filmstrip-gap \{/);
});

test("reorder buttons move images and re-render preserving prompts", () => {
  assert.match(handlers, /filmstrip-move-/);
  assert.match(handlers, /function swapImages\(/);
  // `false` here would rebuild prompts from the stale textarea and lose them.
  assert.match(handlers, /renderImagePromptPairs\(true\);\n\s*if \(isFramePairMode/);
  assert.match(css, /\.filmstrip-move \{/);
});

test("frame mode switch mirrors the mode-switch pattern without colliding", () => {
  assert.match(html, /id="frameModeSelector"[^>]*class="visually-hidden"/);
  assert.match(html, /data-frame-mode="chained"/);
  assert.match(html, /data-frame-mode="discrete"/);
  // Reusing .mode-option would make design-ui.js write the main mode selector.
  assert.doesNotMatch(html, /class="mode-option"[^>]*data-frame-mode/);
  assert.match(css, /\.mode-switch-triple \{/);
  assert.match(css, /\.frame-option \{/);
});

test("single mode keeps its original three-track row and full prompt width", () => {
  // The reorder column only earns its width where order defines the pairing.
  assert.match(handlers, /if \(reorderable\) row\.appendChild\(createMoveControls/);
  assert.match(handlers, /reorderable: pairMode/);
  for (const block of [css, css.slice(css.indexOf("@media (max-width: 400px)"))]) {
    assert.match(
      block,
      /#imagePromptPairs\[data-frame-mode="single"\] \.image-prompt-pair \{\s*\n\s*grid-template-columns: \d+px \d+px minmax\(0, 1fr\);/,
    );
  }
});

test("the 400px breakpoint mirrors the four-track row grid", () => {
  const narrow = css.slice(css.indexOf("@media (max-width: 400px)"));
  assert.match(
    narrow,
    /\.image-prompt-pair,\s*\n\s*\.filmstrip-link \{\s*\n\s*grid-template-columns: 22px 58px minmax\(0, 1fr\) 26px;/,
  );
  // The connector rail is dropped so the prompt keeps usable width at 340px.
  assert.match(narrow, /\.filmstrip-link-rail \{\s*\n\s*display: none;/);
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
