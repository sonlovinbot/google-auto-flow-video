import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImagePromptPairs,
  parsePrompts,
} from "../prompt-parser.js";

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
