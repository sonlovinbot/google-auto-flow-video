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

test("frame selection explicitly confirms Add to Prompt", () => {
  // Codes and step names are composed per slot: FIRST_FRAME_* / LAST_FRAME_*.
  assert.match(injector, /\$\{codePrefix\}_CONFIRM_DISABLED/);
  assert.match(injector, /\$\{stepPrefix\}-confirm/);
  assert.match(injector, /Đã xác nhận nút “\$\{TXT\.addToPrompt\}”/);
  for (const prefix of ["FIRST_FRAME", "LAST_FRAME"]) {
    assert.match(
      injector,
      new RegExp(`codePrefix: "${prefix}"`),
      `${prefix} slot must be wired`,
    );
  }
});

test("attachment is proven by the frame count growing, never by existence", () => {
  // The original `.find()` returned the first attached frame regardless of
  // slot. With two frames it reported the Start frame as proof the End frame
  // attached, so a one-frame video would submit and report success.
  assert.doesNotMatch(injector, /const findAttachedFrame\b/);
  assert.match(injector, /const countAttachedFrames = \(\) =>/);
  assert.match(injector, /countAttachedFrames\(\) > baselineCount/);
  assert.match(injector, /finalCount <= baselineCount \|\| finalCount < ordinal/);
});

test("a slot is skipped only on positive evidence", () => {
  // Skipping wrongly ships a video with a missing frame and reports success,
  // so both the trigger being gone AND the count being high enough are needed.
  assert.match(injector, /!triggerVisible && baselineCount >= ordinal/);
  assert.match(injector, /isSlotTriggerVisible/);
});

test("nothing is submitted before every required frame is verified", () => {
  assert.match(injector, /const requiredFrames = lastFrame \? 2 : 1/);
  assert.match(injector, /attachedCount < requiredFrames/);
  assert.match(injector, /"frames-verify"/);
  // The preflight must run before the prompt is written, not after.
  assert.ok(
    injector.indexOf('"frames-verify"') <
      injector.indexOf('"PROMPT_EDITOR_MISSING"'),
    "frames-verify must precede the prompt editor step",
  );
});

test("a dialog left open by one slot is never reused by the other", () => {
  // Reusing Start's dialog for End would overwrite the first frame instead of
  // filling the second slot.
  assert.match(injector, /allowDialogReuse: countAttachedFrames\(\) === 0/);
  assert.match(injector, /allowDialogReuse: false/);
  assert.match(injector, /const closeAddToPromptDialog = async/);
  // The old trace-scanning hack read the other slot's entry; a local flag now.
  assert.match(injector, /let reusedDialog = false/);
  assert.doesNotMatch(injector, /entry\.message\.includes\("Tái sử dụng"\)/);
});

test("both frames upload sequentially before any dialog opens", () => {
  const firstUpload = injector.indexOf('role: "first" }');
  const lastUpload = injector.indexOf('role: "last" }');
  const firstAttach = injector.indexOf("const firstAttach = await attachFrame");
  assert.ok(firstUpload > 0 && lastUpload > firstUpload);
  assert.ok(
    lastUpload < firstAttach,
    "uploads must finish before the composer dialog is opened",
  );
});

test("Flow's visible labels are patchable without a rebuild", () => {
  assert.match(injector, /FRAME_TRIGGER_START_TEXT \|\| "Start"/);
  assert.match(injector, /FRAME_TRIGGER_END_TEXT \|\| "End"/);
  assert.match(injector, /ADD_TO_PROMPT_TEXT \|\| "Add to Prompt"/);
  assert.match(injector, /UPLOADS_TAB_TEXT \|\| "Uploads"/);
});

test("single-frame submissions keep their original codes and steps", () => {
  const automation = readFileSync(
    join(projectDirectory, "automation.js"),
    "utf8",
  );
  // lastFrame null must take the exact same path as before the feature.
  assert.match(injector, /lastFrame = null,/);
  assert.match(injector, /if \(lastFrame\) \{/);
  // The new last-frame codes must retry in place, like their first-frame twins.
  for (const code of [
    "LAST_FRAME_OPTION_MISSING",
    "LAST_FRAME_CONFIRM_DISABLED",
    "LAST_FRAME_NOT_ATTACHED",
    "LAST_FRAME_TRIGGER_MISSING",
  ]) {
    assert.match(automation, new RegExp(`"${code}"`), `${code} must retry`);
  }
});
