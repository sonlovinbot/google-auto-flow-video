import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Minimal chrome stub. `sessionStore` is deliberately shared across "worker
 * restarts" because chrome.storage.session outlives the service worker.
 */
function createChromeStub(sessionStore = new Map()) {
  const listeners = {};
  const downloads = [];
  let nextDownloadId = 100;

  const chrome = {
    _sessionStore: sessionStore,
    _downloads: downloads,
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener: (fn) => {
          listeners.message = fn;
        },
      },
    },
    action: { onClicked: { addListener: () => {} } },
    tabs: { create: () => {} },
    storage: {
      session: {
        get: async (key) =>
          sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {},
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
        },
        remove: async (key) => {
          sessionStore.delete(key);
        },
      },
    },
    downloads: {
      onDeterminingFilename: {
        addListener: (fn) => {
          listeners.determiningFilename = fn;
        },
      },
      download: (options, callback) => {
        const id = nextDownloadId++;
        downloads.push({ id, ...options, state: "in_progress" });
        callback(id);
      },
      search: ({ id }, callback) => {
        callback(downloads.filter((item) => item.id === id));
      },
    },
  };
  return { chrome, listeners };
}

async function loadBackground(chrome, cacheKey) {
  globalThis.chrome = chrome;
  globalThis.crypto ??= { randomUUID: () => "token-fixed" };
  await import(`../background.js?restart=${cacheKey}`);
}

function sendMessage(listeners, message) {
  return new Promise((resolve) => {
    listeners.message(message, {}, resolve);
  });
}

test("background.js keeps no armed capture in module scope", () => {
  const source = readFileSync(join(projectDirectory, "background.js"), "utf8");
  // A module-level `let armed = ...` is lost whenever MV3 stops the worker.
  assert.doesNotMatch(source, /^let\s+armedFlowDownload/m);
  assert.match(source, /chrome\.storage\.session/);
});

test("an armed capture survives a service worker restart", async () => {
  const sessionStore = new Map();
  const first = createChromeStub(sessionStore);
  await loadBackground(first.chrome, "a1");

  const armed = await sendMessage(first.listeners, {
    type: "downloadFlowVideo",
    url: "https://labs.google/fx/video/real.mp4",
    filename: "Project-01/1.a. video.mp4",
  });
  assert.equal(armed.success, true);
  assert.ok(armed.token);

  // Simulate MV3 tearing the worker down and starting it again: fresh module
  // scope, same chrome.storage.session contents.
  const second = createChromeStub(sessionStore);
  second.chrome._downloads.push(
    ...first.chrome._downloads.map((item) => ({ ...item, state: "complete", mime: "video/mp4" })),
  );
  await loadBackground(second.chrome, "a2");

  const status = await sendMessage(second.listeners, {
    type: "getFlowDownloadCapture",
    token: armed.token,
  });
  assert.equal(status.success, true, JSON.stringify(status));
  assert.equal(status.state, "complete");
  assert.equal(status.mime, "video/mp4");
});

test("thumbnail and non-Google URLs are refused before any download starts", async () => {
  const { chrome, listeners } = createChromeStub();
  await loadBackground(chrome, "b1");

  for (const url of [
    "https://labs.google/fx/video/x.mp4?mediaUrlType=THUMBNAIL",
    "https://evil.example.com/x.mp4",
    "http://labs.google/fx/video/x.mp4",
    "https://labs.google/fx/thumbnail/x.jpg",
  ]) {
    const result = await sendMessage(listeners, {
      type: "downloadFlowVideo",
      url,
      filename: "out.mp4",
    });
    assert.equal(result.success, false, `should refuse ${url}`);
  }
  assert.equal(chrome._downloads.length, 0);
});

test("an image download never consumes the armed video capture", async () => {
  const sessionStore = new Map();
  const { chrome, listeners } = createChromeStub(sessionStore);
  await loadBackground(chrome, "c1");

  const armed = await sendMessage(listeners, {
    type: "downloadFlowVideo",
    url: "https://lh3.googleusercontent.com/real.mp4",
    filename: "Project-01/1.a. video.mp4",
  });

  // Clear the id the download callback stamped, so the filename listener is
  // the one deciding — this is the thumbnail-arrives-first ordering.
  const stored = sessionStore.get("armedFlowDownload");
  stored.downloadId = null;
  sessionStore.set("armedFlowDownload", stored);

  const suggestions = [];
  await new Promise((resolve) => {
    listeners.determiningFilename(
      { id: 999, filename: "thumb.png", mime: "image/png" },
      (suggestion) => {
        suggestions.push(suggestion);
        resolve();
      },
    );
  });

  assert.deepEqual(suggestions, [undefined], "image must pass through unnamed");
  const after = sessionStore.get("armedFlowDownload");
  assert.equal(after.token, armed.token, "capture must stay armed");
  assert.equal(after.downloadId, null, "image must not claim the capture");
  assert.equal(after.rejectedDownloads, 1);
});
