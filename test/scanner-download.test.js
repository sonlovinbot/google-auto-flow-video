import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDownloadPath,
  normalizeDownloadSaveMode,
  sanitizeDownloadFolder,
} from "../scanner.js";

test("normalizes download save mode", () => {
  assert.equal(normalizeDownloadSaveMode("ask"), "ask");
  assert.equal(normalizeDownloadSaveMode("auto"), "auto");
  assert.equal(normalizeDownloadSaveMode("unexpected"), "auto");
});

test("sanitizes a job download folder into one safe path segment", () => {
  assert.equal(sanitizeDownloadFolder("Flow-04"), "Flow-04");
  assert.equal(sanitizeDownloadFolder("../unsafe/name"), "_unsafe_name");
  assert.equal(sanitizeDownloadFolder("   "), "Flow Downloads");
});

test("builds a relative Chrome Downloads path", () => {
  assert.equal(
    buildDownloadPath("Flow-04", "1.a. 20260727_211243.mp4"),
    "Flow-04/1.a. 20260727_211243.mp4",
  );
});
