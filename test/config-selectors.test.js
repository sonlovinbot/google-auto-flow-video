import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadLocalConfig } from "../config.js";
import { state } from "../state.js";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const selectorsPath = join(projectDirectory, "flow-selectors.json");
const bundled = JSON.parse(readFileSync(selectorsPath, "utf8"));

function stubChrome(localStore = {}) {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (file) => `stub://${file}`,
    },
    storage: {
      local: {
        get: (keys, callback) => {
          const result = {};
          for (const key of keys) {
            if (key in localStore) result[key] = localStore[key];
          }
          callback(result);
        },
      },
    },
  };
}

function stubFetch(payload, ok = true) {
  globalThis.fetch = async () => ({
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? "OK" : "Not Found",
    json: async () => payload,
  });
}

test("the bundled selector file is versioned and complete", () => {
  assert.equal(typeof bundled.version, "number");
  assert.equal(typeof bundled.targetFlowUI, "string");
  const values = Object.values(bundled.selectors);
  assert.ok(values.length >= 18);
  for (const [name, value] of Object.entries(bundled.selectors)) {
    assert.equal(typeof value, "string", `${name} must be a string`);
    assert.notEqual(value.trim(), "", `${name} must not be empty`);
  }
});

test("selectors no longer live inside config.js", () => {
  const source = readFileSync(join(projectDirectory, "config.js"), "utf8");
  assert.doesNotMatch(source, /data-slate-editor/);
  assert.match(source, /flow-selectors\.json/);
});

test("loads the bundled selectors when there is no override", async () => {
  stubChrome({});
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  assert.equal(
    state.selectors.PROMPT_TEXTAREA_ID,
    bundled.selectors.PROMPT_TEXTAREA_ID,
  );
});

test("a complete user override wins over the bundled file", async () => {
  const override = {
    selectors: {
      ...bundled.selectors,
      GENERATE_BUTTON_XPATH: "//button[@id='patched-by-user']",
    },
  };
  stubChrome({ selectorOverride: override });
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  assert.equal(
    state.selectors.GENERATE_BUTTON_XPATH,
    "//button[@id='patched-by-user']",
  );
});

test("an incomplete override is ignored instead of half-applied", async () => {
  stubChrome({
    selectorOverride: { selectors: { GENERATE_BUTTON_XPATH: "//button" } },
  });
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  // Falls back to the complete bundled set rather than running with one key.
  assert.equal(
    state.selectors.GENERATE_BUTTON_XPATH,
    bundled.selectors.GENERATE_BUTTON_XPATH,
  );
  assert.equal(
    state.selectors.SETTINGS_BUTTON_XPATH,
    bundled.selectors.SETTINGS_BUTTON_XPATH,
  );
});

test("a truncated selector file fails startup loudly", async () => {
  stubChrome({});
  stubFetch({ version: 9, selectors: { PROMPT_TEXTAREA_ID: "div" } });
  state.selectors = {};

  assert.equal(await loadLocalConfig(), false);
});

test("an unreadable selector file fails startup loudly", async () => {
  stubChrome({});
  stubFetch(null, false);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), false);
});
