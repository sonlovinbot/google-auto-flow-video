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

test("current Flow count labels and compact settings button are configurable", () => {
  assert.equal(
    bundled.selectors.OUTPUT_COUNT_FORMATS_TEXT,
    "x{count}|{count}x",
  );
  assert.match(bundled.selectors.SETTINGS_BUTTON_XPATH, /crop_9_16/);
  assert.match(bundled.selectors.SETTINGS_BUTTON_XPATH, /aria-haspopup='menu'/);
  assert.doesNotMatch(bundled.selectors.SETTINGS_BUTTON_XPATH, /Video/);
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

test("a user override wins over the bundled file", async () => {
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

test("a single-key override is merged, not swapped in", async () => {
  // Fixing one broken label must not require hand-copying every other key.
  stubChrome({
    selectorOverride: { selectors: { FRAME_TRIGGER_END_TEXT: "Jump to" } },
  });
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  assert.equal(state.selectors.FRAME_TRIGGER_END_TEXT, "Jump to");
  // Everything the user did not mention still comes from the bundled file.
  assert.equal(
    state.selectors.GENERATE_BUTTON_XPATH,
    bundled.selectors.GENERATE_BUTTON_XPATH,
  );
  assert.equal(
    state.selectors.SETTINGS_BUTTON_XPATH,
    bundled.selectors.SETTINGS_BUTTON_XPATH,
  );
});

test("a bare override object without a selectors wrapper also works", async () => {
  stubChrome({ selectorOverride: { FRAME_TRIGGER_END_TEXT: "Finish" } });
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  assert.equal(state.selectors.FRAME_TRIGGER_END_TEXT, "Finish");
});

test("empty or non-string override values are ignored", async () => {
  stubChrome({
    selectorOverride: {
      selectors: {
        FRAME_TRIGGER_END_TEXT: "   ",
        UPLOADS_TAB_TEXT: null,
        ADD_TO_PROMPT_TEXT: "Attach",
      },
    },
  });
  stubFetch(bundled);
  state.selectors = {};

  assert.equal(await loadLocalConfig(), true);
  assert.equal(state.selectors.FRAME_TRIGGER_END_TEXT, "End");
  assert.equal(state.selectors.UPLOADS_TAB_TEXT, "Uploads");
  assert.equal(state.selectors.ADD_TO_PROMPT_TEXT, "Attach");
});

test("the new frame label keys are not required, so old overrides survive", async () => {
  const REQUIRED = readFileSync(join(projectDirectory, "config.js"), "utf8");
  for (const key of [
    "FRAME_TRIGGER_START_TEXT",
    "FRAME_TRIGGER_END_TEXT",
    "ADD_TO_PROMPT_TEXT",
    "UPLOADS_TAB_TEXT",
    "ATTACHED_FRAME_IMG_SELECTOR",
  ]) {
    const required = REQUIRED.slice(
      REQUIRED.indexOf("REQUIRED_SELECTORS = ["),
      REQUIRED.indexOf("];", REQUIRED.indexOf("REQUIRED_SELECTORS = [")),
    );
    assert.doesNotMatch(
      required,
      new RegExp(key),
      `${key} must stay optional or every saved override breaks`,
    );
  }
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
