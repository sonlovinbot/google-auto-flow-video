import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFramePairs,
  buildImagePromptPairs,
  countTransitions,
  framePairIndices,
  normalizeFrameMode,
  parsePrompts,
} from "../prompt-parser.js";

const image = (n) => ({ name: `${n}.png`, size: n * 10, lastModified: n });
const images = (count) =>
  Array.from({ length: count }, (_, index) => image(index + 1));
const promptsOf = (result) => result.pairs.map((pair) => pair.prompt);
const pairIndicesOf = (result) =>
  result.pairs.map((pair) => [pair.firstIndex, pair.lastIndex]);

test("parses one prompt per line", () => {
  assert.deepEqual(parsePrompts("first\nsecond\nthird"), [
    "first",
    "second",
    "third",
  ]);
});

test("preserves multi-line prompt blocks separated by blank lines", () => {
  assert.deepEqual(parsePrompts("line one\nline two\n\nnext prompt"), [
    "line one\nline two",
    "next prompt",
  ]);
});

test("normalizes CRLF input and removes empty surrounding content", () => {
  assert.deepEqual(parsePrompts("\r\n alpha \r\n\r\n beta \r\n"), [
    "alpha",
    "beta",
  ]);
});

test("pairs images and prompts by index", () => {
  const images = [
    { name: "1.png", size: 10, lastModified: 1 },
    { name: "2.png", size: 20, lastModified: 2 },
    { name: "3.png", size: 30, lastModified: 3 },
  ];
  const pairs = buildImagePromptPairs(images, ["one", "two"]);

  assert.deepEqual(
    pairs.map((pair) => pair.prompt),
    ["one", "two", ""],
  );
});

test("shares one prompt across all selected images", () => {
  const images = [
    { name: "1.png", size: 10, lastModified: 1 },
    { name: "2.png", size: 20, lastModified: 2 },
  ];
  const pairs = buildImagePromptPairs(images, ["shared prompt"]);

  assert.deepEqual(
    pairs.map((pair) => pair.prompt),
    ["shared prompt", "shared prompt"],
  );
});

test("preserves edited prompts when image order changes", () => {
  const first = { name: "1.png", size: 10, lastModified: 1 };
  const second = { name: "2.png", size: 20, lastModified: 2 };
  const initial = buildImagePromptPairs([first, second], ["one", "two"]);
  initial[0].prompt = "edited one";
  const reordered = buildImagePromptPairs([second, first], [], initial);

  assert.deepEqual(
    reordered.map((pair) => pair.prompt),
    ["two", "edited one"],
  );
});

test("normalizeFrameMode rejects anything outside the three modes", () => {
  assert.equal(normalizeFrameMode("chained"), "chained");
  assert.equal(normalizeFrameMode("discrete"), "discrete");
  assert.equal(normalizeFrameMode("single"), "single");
  assert.equal(normalizeFrameMode(undefined), "single");
  assert.equal(normalizeFrameMode("first-last"), "single");
});

test("counts videos per frame mode", () => {
  assert.equal(countTransitions(5, "single"), 5);
  assert.equal(countTransitions(20, "chained"), 19);
  assert.equal(countTransitions(2, "chained"), 1);
  assert.equal(countTransitions(1, "chained"), 0);
  assert.equal(countTransitions(0, "chained"), 0);
  assert.equal(countTransitions(6, "discrete"), 3);
  assert.equal(countTransitions(7, "discrete"), 3);
  assert.equal(countTransitions(1, "discrete"), 0);
});

test("chained mode brackets consecutive overlapping images", () => {
  assert.deepEqual(framePairIndices(4, "chained"), [
    { first: 0, last: 1 },
    { first: 1, last: 2 },
    { first: 2, last: 3 },
  ]);
});

test("discrete mode brackets independent pairs", () => {
  assert.deepEqual(framePairIndices(6, "discrete"), [
    { first: 0, last: 1 },
    { first: 2, last: 3 },
    { first: 4, last: 5 },
  ]);
});

test("chained mode pairs 20 images into 19 videos reusing the middles", () => {
  const result = buildFramePairs(images(20), [], [], "chained");

  assert.equal(result.pairs.length, 19);
  assert.deepEqual(pairIndicesOf(result)[0], [0, 1]);
  assert.deepEqual(pairIndicesOf(result)[18], [18, 19]);
  // The last image is never dropped: it is the last frame of the last video.
  assert.deepEqual(result.unusedImageIndices, []);
});

test("discrete mode leaves a trailing odd image unused", () => {
  const result = buildFramePairs(images(7), [], [], "discrete");

  assert.equal(result.pairs.length, 3);
  assert.deepEqual(result.unusedImageIndices, [6]);
});

test("assigns prompts to transitions by index", () => {
  const result = buildFramePairs(
    images(4),
    ["a", "b", "c"],
    [],
    "chained",
  );
  assert.deepEqual(promptsOf(result), ["a", "b", "c"]);
});

test("leaves transitions blank when prompts run short", () => {
  const result = buildFramePairs(images(4), ["a", "b"], [], "chained");
  assert.deepEqual(promptsOf(result), ["a", "b", ""]);
});

test("shares one prompt across every transition", () => {
  const chained = buildFramePairs(images(5), ["shared"], [], "chained");
  const discrete = buildFramePairs(images(6), ["shared"], [], "discrete");

  assert.deepEqual(promptsOf(chained), Array(4).fill("shared"));
  assert.deepEqual(promptsOf(discrete), Array(3).fill("shared"));
});

test("reports excess prompts instead of dropping them silently", () => {
  // 3 images chained = 2 transitions, but 5 prompts were supplied.
  const result = buildFramePairs(
    images(3),
    ["a", "b", "c", "d", "e"],
    [],
    "chained",
  );
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(result.excessPrompts, ["c", "d", "e"]);
});

test("a single shared prompt is never counted as excess", () => {
  const result = buildFramePairs(images(5), ["shared"], [], "chained");
  assert.deepEqual(result.excessPrompts, []);
});

test("a transition prompt follows its pair when the pair stays intact", () => {
  const files = images(4);
  const initial = buildFramePairs(files, ["a", "b", "c"], [], "chained");

  // Move the 3,4 block in front of 1,2. Both 3→4 and 1→2 survive as adjacent
  // pairs, so their prompts travel with them; only 4→1 is genuinely new.
  const moved = [files[2], files[3], files[0], files[1]];
  const result = buildFramePairs(moved, [], initial.pairs, "chained");

  assert.deepEqual(pairIndicesOf(result), [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.deepEqual(promptsOf(result), ["c", "b", "a"]);
});

test("reordering keeps prompts at their slot rather than losing them", () => {
  const files = images(4);
  const initial = buildFramePairs(files, ["a", "b", "c"], [], "chained");

  // Swap images 2 and 3 — every adjacency around them changes.
  const swapped = [files[0], files[2], files[1], files[3]];
  const result = buildFramePairs(swapped, [], initial.pairs, "chained");

  // Nothing is lost; prompts stay put and the images move underneath them.
  assert.deepEqual(promptsOf(result), ["a", "b", "c"]);
});

test("a repeated file does not smear one prompt across two transitions", () => {
  const duplicate = image(1);
  const files = [duplicate, image(2), duplicate];
  const initial = buildFramePairs(files, ["a", "b"], [], "chained");
  initial.pairs[0].prompt = "only once";

  const rebuilt = buildFramePairs(files, [], initial.pairs, "chained");
  assert.equal(rebuilt.pairs[0].prompt, "only once");
  assert.equal(rebuilt.pairs[1].prompt, "b");
});

test("single mode delegates to the original pairing untouched", () => {
  const files = images(3);
  const legacy = buildImagePromptPairs(files, ["one", "two"]);
  const framed = buildFramePairs(files, ["one", "two"], [], "single");

  assert.deepEqual(promptsOf(framed), legacy.map((pair) => pair.prompt));
  assert.deepEqual(
    framed.pairs.map((pair) => pair.key),
    legacy.map((pair) => pair.key),
  );
  assert.deepEqual(pairIndicesOf(framed), [
    [0, null],
    [1, null],
    [2, null],
  ]);
  assert.equal(countTransitions(files.length, "single"), legacy.length);
});
