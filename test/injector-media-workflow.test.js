import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(testDirectory);
const injector = readFileSync(
  join(projectDirectory, "injector.js"),
  "utf8",
);

test("Flow upload is dispatched once and observed through the silent window", () => {
  assert.match(injector, /upload-menu-option/);
  assert.match(injector, /accepted-hidden/);
  assert.match(injector, /105000/);
  assert.doesNotMatch(injector, /upload-drop-fallback/);
});

test("stale global Failed cards do not fail a new image upload", () => {
  assert.match(injector, /getCurrentFileFailureCount/);
  assert.match(
    injector,
    /currentFileFailureCount > knownCurrentFileFailureCount/,
  );
  assert.doesNotMatch(injector, /texts\.includes\("Failed"\)/);
});

test("same-page retries guard an in-flight file from duplicate upload", () => {
  assert.match(injector, /__coachioUploadAttempts/);
  assert.match(injector, /upload-dedupe-wait/);
  assert.match(injector, /remainingGuardMs/);
});

test("First frame selection explicitly confirms Add to Prompt", () => {
  assert.match(injector, /FIRST_FRAME_CONFIRM_DISABLED/);
  assert.match(injector, /first-frame-confirm/);
  assert.match(injector, /Đã xác nhận nút “Add to Prompt”/);
});
