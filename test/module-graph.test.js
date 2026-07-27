import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

const PANEL_MODULES = [
  "state.js",
  "i18n.js",
  "dom.js",
  "ui.js",
  "utils.js",
  "db.js",
  "chrome-errors.js",
  "prompt-parser.js",
  "settings.js",
  "language.js",
  "config.js",
  "injector.js",
  "scanner.js",
  "automation.js",
  "handlers.js",
  "sidepanel.js",
];

test("every side-panel module imports without touching chrome at load time", async () => {
  // No chrome stub on purpose: importing a module must not call extension APIs.
  const previousChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.document ??= {
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
  };
  try {
    for (const name of PANEL_MODULES) {
      await import(`../${name}`);
    }
  } finally {
    if (previousChrome) globalThis.chrome = previousChrome;
  }
});

test("panel modules resolve every file they import", () => {
  const existing = new Set(readdirSync(projectDirectory));
  for (const name of readdirSync(projectDirectory).filter((f) =>
    f.endsWith(".js"),
  )) {
    const source = readFileSync(join(projectDirectory, name), "utf8");
    for (const match of source.matchAll(/from\s+"\.\/([^"]+)"/g)) {
      assert.ok(
        existing.has(match[1]),
        `${name} imports missing file ${match[1]}`,
      );
    }
  }
});

test("scripts referenced by sidepanel.html exist", () => {
  const html = readFileSync(join(projectDirectory, "sidepanel.html"), "utf8");
  const existing = new Set(readdirSync(projectDirectory));
  const referenced = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(referenced.length > 0);
  for (const src of referenced) {
    if (src.startsWith("http")) continue;
    assert.ok(existing.has(src), `sidepanel.html references missing ${src}`);
  }
});

test("manifest entry points exist and no dead gateway is shipped", () => {
  const manifest = JSON.parse(
    readFileSync(join(projectDirectory, "manifest.json"), "utf8"),
  );
  const existing = new Set(readdirSync(projectDirectory));
  assert.ok(existing.has(manifest.background.service_worker));
  assert.ok(existing.has(manifest.side_panel.default_path));
  assert.equal(existing.has("gateway.html"), false);
  // update_url belongs to a Web Store listing and warns on "Load unpacked".
  assert.equal("update_url" in manifest, false);
});
