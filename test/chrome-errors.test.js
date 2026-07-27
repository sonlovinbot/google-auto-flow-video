import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isTabGoneError,
  isTransientInjectionError,
} from "../chrome-errors.js";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

test("recognises Chrome's English-only runtime errors", () => {
  assert.equal(isTabGoneError("No tab with id: 42"), true);
  assert.equal(isTabGoneError(new Error("Receiving end does not exist.")), true);
  assert.equal(isTabGoneError("Something else entirely"), false);

  assert.equal(
    isTransientInjectionError("Could not establish connection."),
    true,
  );
  assert.equal(
    isTransientInjectionError("Target page, context or frame has been closed"),
    true,
  );
  assert.equal(isTransientInjectionError("Unexpected boom"), false);
});

test("handles null, undefined and Error objects without throwing", () => {
  assert.equal(isTabGoneError(null), false);
  assert.equal(isTabGoneError(undefined), false);
  assert.equal(isTransientInjectionError({}), false);
});

test("error matching never depends on the UI language", async () => {
  const { translations } = await import("../i18n.js");
  const { state } = await import("../state.js");

  // Previously these sentinels came from i18n(), so a locale that translated
  // them silently stopped matching and flooded the log with noise.
  for (const language of Object.keys(translations)) {
    state.currentLang = language;
    assert.equal(
      isTabGoneError("No tab with id: 7"),
      true,
      `tab-gone matching broke for ${language}`,
    );
  }
  state.currentLang = "vi";
});

test("no module resolves Chrome error sentinels through i18n", () => {
  for (const file of ["injector.js", "scanner.js"]) {
    const source = readFileSync(join(projectDirectory, file), "utf8");
    assert.doesNotMatch(
      source,
      /i18n\("log_(connection|no_tab|receiving_end|target_page)_error"\)/,
      `${file} must use chrome-errors.js sentinels`,
    );
  }
});
