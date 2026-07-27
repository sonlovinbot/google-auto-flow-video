import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJob } from "../settings.js";
import {
  buildFramePairs,
  countTransitions,
  framePairIndices,
} from "../prompt-parser.js";

const image = (n) => ({ name: `${n}.png`, size: n * 10, lastModified: n });
const images = (count) =>
  Array.from({ length: count }, (_, index) => image(index + 1));
const handles = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    name: `${index + 1}.png`,
    type: "image/png",
  }));

test("a job queued before frame modes existed normalises to single", () => {
  const legacy = {
    id: "1",
    mode: "image-to-video",
    images: handles(3),
    prompts: ["a", "b", "c"],
    status: "pending",
  };
  const normalized = normalizeJob(legacy, {});

  assert.equal(normalized.frameMode, "single");
  assert.equal(normalized.framePairs, null);
  // Everything else must survive untouched.
  assert.deepEqual(normalized.prompts, ["a", "b", "c"]);
  assert.equal(normalized.images.length, 3);
});

test("an unknown frameMode falls back to single rather than throwing", () => {
  const normalized = normalizeJob({ frameMode: "first-last" }, {});
  assert.equal(normalized.frameMode, "single");
});

test("a valid frame job passes through normalisation intact", () => {
  const job = {
    frameMode: "chained",
    framePairs: [
      { first: 0, last: 1 },
      { first: 1, last: 2 },
    ],
  };
  const normalized = normalizeJob(job, {});

  assert.equal(normalized.frameMode, "chained");
  assert.deepEqual(normalized.framePairs, job.framePairs);
});

test("a non-array framePairs is rejected", () => {
  assert.equal(normalizeJob({ framePairs: "oops" }, {}).framePairs, null);
  assert.equal(normalizeJob({ framePairs: {} }, {}).framePairs, null);
});

test("normalizeJob still applies the pre-existing field rules", () => {
  const normalized = normalizeJob(
    { status: "downloading", model: "bogus", duration: "9s" },
    { videoCount: "2", omniDuration: "6s", downloadSaveMode: "ask" },
  );
  assert.equal(normalized.status, "pending");
  assert.equal(normalized.model, "omni_flash");
  assert.equal(normalized.duration, "6s");
  assert.equal(normalized.repeatCount, "2");
  assert.equal(normalized.downloadSaveMode, "ask");
});

test("every framePairs index is in range for the images it was built from", () => {
  for (const mode of ["single", "chained", "discrete"]) {
    for (const count of [1, 2, 3, 6, 7, 20]) {
      const built = buildFramePairs(images(count), [], [], mode);
      const pairs = built.pairs.map((pair) => ({
        first: pair.firstIndex,
        last: pair.lastIndex,
      }));

      assert.equal(pairs.length, countTransitions(count, mode));
      for (const pair of pairs) {
        assert.ok(
          pair.first >= 0 && pair.first < count,
          `${mode}/${count}: first ${pair.first} out of range`,
        );
        if (pair.last !== null) {
          assert.ok(
            pair.last >= 0 && pair.last < count,
            `${mode}/${count}: last ${pair.last} out of range`,
          );
        }
      }
    }
  }
});

test("framePairIndices matches what buildFramePairs produces", () => {
  for (const mode of ["single", "chained", "discrete"]) {
    const built = buildFramePairs(images(6), [], [], mode);
    assert.deepEqual(
      built.pairs.map((pair) => ({
        first: pair.firstIndex,
        last: pair.lastIndex,
      })),
      framePairIndices(6, mode),
      `mismatch for ${mode}`,
    );
  }
});

test("chained mode never leaves an image unused", () => {
  for (const count of [2, 3, 4, 20]) {
    const built = buildFramePairs(images(count), [], [], "chained");
    assert.deepEqual(built.unusedImageIndices, [], `count ${count}`);
  }
});

async function buildTasks(job) {
  const { buildTaskList } = await import("../automation.js");
  const { state } = await import("../state.js");
  state.taskList = [];
  state.masterTaskList = [];
  buildTaskList(job, 1);
  return state.taskList;
}

test("a legacy image job builds one single-frame task per image", async () => {
  const tasks = await buildTasks({
    id: "j1",
    mode: "image-to-video",
    images: handles(3),
    prompts: ["a", "b", "c"],
    // no frameMode, no framePairs — the pre-feature shape
  });

  assert.equal(tasks.length, 3);
  assert.deepEqual(
    tasks.map((task) => task.item.name),
    ["1.png", "2.png", "3.png"],
  );
  assert.deepEqual(
    tasks.map((task) => task.lastFrame),
    [null, null, null],
  );
  assert.deepEqual(tasks.map((task) => task.prompt), ["a", "b", "c"]);
  assert.deepEqual(tasks.map((task) => task.index), [1, 2, 3]);
});

test("a chained job brackets consecutive images and reuses the middles", async () => {
  const tasks = await buildTasks({
    id: "j2",
    mode: "image-to-video",
    frameMode: "chained",
    images: handles(4),
    framePairs: framePairIndices(4, "chained"),
    prompts: ["a", "b", "c"],
  });

  assert.equal(tasks.length, 3);
  assert.deepEqual(
    tasks.map((task) => [task.item.name, task.lastFrame.name]),
    [
      ["1.png", "2.png"],
      ["2.png", "3.png"],
      ["3.png", "4.png"],
    ],
  );
  // The middle images are the same stored handle in both roles, so they are
  // uploaded once and deleted once.
  assert.equal(tasks[0].lastFrame.id, tasks[1].item.id);
  assert.equal(tasks[1].lastFrame.id, tasks[2].item.id);
});

test("a discrete job brackets independent pairs", async () => {
  const tasks = await buildTasks({
    id: "j3",
    mode: "image-to-video",
    frameMode: "discrete",
    images: handles(6),
    framePairs: framePairIndices(6, "discrete"),
    prompts: ["a", "b", "c"],
  });

  assert.deepEqual(
    tasks.map((task) => [task.item.name, task.lastFrame.name]),
    [
      ["1.png", "2.png"],
      ["3.png", "4.png"],
      ["5.png", "6.png"],
    ],
  );
  const usedIds = tasks.flatMap((task) => [task.item.id, task.lastFrame.id]);
  assert.equal(new Set(usedIds).size, usedIds.length, "no image reused");
});

test("task.item stays the first-frame handle so failure reporting keeps working", async () => {
  const tasks = await buildTasks({
    id: "j4",
    mode: "image-to-video",
    frameMode: "chained",
    images: handles(2),
    framePairs: framePairIndices(2, "chained"),
    prompts: ["a"],
  });

  // addFailedPrompt and buildFailureReport both read item.name.
  assert.equal(typeof tasks[0].item.name, "string");
  assert.equal(tasks[0].item.name, "1.png");
});

test("a text job is unaffected by the frame plumbing", async () => {
  const tasks = await buildTasks({
    id: "j5",
    mode: "text-to-video",
    images: [],
    prompts: ["one", "two"],
  });

  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((task) => task.item), ["one", "two"]);
  assert.deepEqual(tasks.map((task) => task.prompt), ["one", "two"]);
  assert.deepEqual(tasks.map((task) => task.lastFrame), [null, null]);
});
