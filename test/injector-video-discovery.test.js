import test from "node:test";
import assert from "node:assert/strict";

import {
  findAndGroupNewVideos,
  getFlowVideoCardSource,
  scanExistingVideos,
} from "../injector.js";

function withVideoCard(videoConfig, callback) {
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const video = {
    readyState: videoConfig.readyState,
    currentSrc: videoConfig.url,
    getAttribute(name) {
      return name === "src" ? videoConfig.url : null;
    },
  };
  const tile = {
    getAttribute(name) {
      return name === "data-tile-id" ? videoConfig.cardId : null;
    },
  };
  const card = {
    textContent: videoConfig.prompt || "",
    querySelector(selector) {
      if (selector === "video") return video;
      if (selector === "[data-tile-id]") return tile;
      return null;
    },
  };
  globalThis.location = { href: "https://labs.google/fx/tools/flow/project/test" };
  globalThis.document = {
    querySelectorAll(selector) {
      if (
        selector ===
        '[role="button"][aria-roledescription="draggable"]'
      ) {
        return [card];
      }
      return [];
    },
  };

  try {
    return callback();
  } finally {
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
  }
}

test("discovers a ready Flow video card by stable tile id", () => {
  const mediaUrl =
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=new-video";
  const groups = withVideoCard(
    {
      cardId: "tile-new-video",
      url: mediaUrl,
      readyState: 4,
      prompt: "play_circle Animate this frame Video progress",
    },
    () => findAndGroupNewVideos(["tile-old-video"]),
  );

  assert.deepEqual(groups, [
    { prompt: "Animate this frame", videos: ["tile-new-video"] },
  ]);
});

test("discovers a new card as soon as its real video URL exists", () => {
  const groups = withVideoCard(
    {
      cardId: "tile-pending",
      url: "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=pending",
      readyState: 0,
      prompt: "Early output",
    },
    () => findAndGroupNewVideos([]),
  );

  assert.deepEqual(groups, [
    { prompt: "Early output", videos: ["tile-pending"] },
  ]);
});

test("baseline scan records video card ids instead of thumbnail URLs", () => {
  const existing = withVideoCard(
    {
      cardId: "tile-existing",
      url:
        "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect" +
        "?name=thumb&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL",
      readyState: 4,
    },
    () => scanExistingVideos(),
  );

  assert.deepEqual(existing, ["tile-existing"]);
});

test("extracts the real video URL from the exact ready card", () => {
  const mediaUrl =
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=real-video";
  const source = withVideoCard(
    {
      cardId: "tile-real-video",
      url: mediaUrl,
      readyState: 4,
    },
    () => getFlowVideoCardSource("tile-real-video"),
  );

  assert.equal(source.ok, true);
  assert.equal(source.url, mediaUrl);
  assert.equal(source.cardId, "tile-real-video");
});

test("extracts the real video URL before the video element buffers", () => {
  const mediaUrl =
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=early-video";
  const source = withVideoCard(
    {
      cardId: "tile-early-video",
      url: mediaUrl,
      readyState: 0,
    },
    () => getFlowVideoCardSource("tile-early-video"),
  );

  assert.equal(source.ok, true);
  assert.equal(source.url, mediaUrl);
  assert.equal(source.earlyDetection, true);
});

test("refuses a thumbnail URL even when it is inside a video element", () => {
  const source = withVideoCard(
    {
      cardId: "tile-thumbnail",
      url:
        "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect" +
        "?name=thumb&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL",
      readyState: 4,
    },
    () => getFlowVideoCardSource("tile-thumbnail"),
  );

  assert.equal(source.ok, false);
  assert.equal(source.step, "video-source");
});
