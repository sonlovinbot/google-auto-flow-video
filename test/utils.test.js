import test from "node:test";
import assert from "node:assert/strict";
import {
  getProjectIdFromUrl,
  getRandomWait,
  naturalSortCollator,
} from "../utils.js";

test("extracts a Flow project id", () => {
  assert.equal(
    getProjectIdFromUrl(
      "https://labs.google/fx/tools/flow/project/f893a182-8f8f-46e1",
    ),
    "f893a182-8f8f-46e1",
  );
  assert.equal(getProjectIdFromUrl("https://labs.google/fx/tools/flow"), null);
});

test("uses the fast 3-6 second pacing window", () => {
  for (let index = 0; index < 100; index += 1) {
    const wait = getRandomWait("3", "6");
    assert.ok(wait >= 3000);
    assert.ok(wait <= 6000);
    assert.equal(wait % 1000, 0);
  }
});

test("sorts image names naturally", () => {
  const names = ["10.png", "2.png", "1.png"];
  names.sort(naturalSortCollator.compare);
  assert.deepEqual(names, ["1.png", "2.png", "10.png"]);
});
