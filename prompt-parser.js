/**
 * Parse prompts from the textarea or an imported text file.
 *
 * A blank line separates multi-line prompt blocks. When there are no blank
 * lines, every non-empty line is treated as a separate prompt.
 */
export function parsePrompts(value) {
  const input = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!input) return [];

  const separator = /\n[ \t]*\n/.test(input) ? /\n[ \t]*\n+/ : /\n+/;
  return input
    .split(separator)
    .map((prompt) => prompt.trim())
    .filter(Boolean);
}

export function getImageFileKey(file) {
  return [
    file?.name || "",
    Number(file?.size) || 0,
    Number(file?.lastModified) || 0,
  ].join(":");
}

/**
 * Build explicit image/prompt rows without silently cycling a short prompt
 * list. A single prompt is intentionally shared by all images; two or more
 * prompts are paired by index and missing rows stay empty for the user to fill.
 */
export function buildImagePromptPairs(images, prompts, existingPairs = []) {
  const files = Array.from(images || []);
  const promptList = Array.from(prompts || []).map((prompt) =>
    String(prompt || "").trim(),
  );
  const existingByKey = new Map(
    Array.from(existingPairs || []).map((pair) => [pair.key, pair.prompt]),
  );

  return files.map((file, index) => {
    const key = getImageFileKey(file);
    let prompt = existingByKey.get(key);
    if (prompt === undefined) {
      prompt =
        promptList.length === 1
          ? promptList[0]
          : promptList[index] === undefined
            ? ""
            : promptList[index];
    }
    return { key, file, prompt };
  });
}

/**
 * How many images bracket one generated video.
 *
 * - `single`   — one image per video (the original behaviour).
 * - `chained`  — overlapping pairs 1→2, 2→3, 3→4; middle images are reused as
 *                the last frame of one video and the first frame of the next.
 * - `discrete` — independent pairs 1→2, 3→4, 5→6; every image is used once.
 */
export const FRAME_MODES = ["single", "chained", "discrete"];

export function normalizeFrameMode(value) {
  return FRAME_MODES.includes(value) ? value : "single";
}

export function isFramePairMode(frameMode) {
  return normalizeFrameMode(frameMode) !== "single";
}

/** Number of videos produced by `imageCount` images in the given mode. */
export function countTransitions(imageCount, frameMode) {
  const count = Math.max(0, Math.floor(Number(imageCount) || 0));
  switch (normalizeFrameMode(frameMode)) {
    case "chained":
      return Math.max(0, count - 1);
    case "discrete":
      return Math.floor(count / 2);
    default:
      return count;
  }
}

/** Which image indices bracket each video. `last` is null in single mode. */
export function framePairIndices(imageCount, frameMode) {
  const mode = normalizeFrameMode(frameMode);
  const total = countTransitions(imageCount, mode);
  return Array.from({ length: total }, (_, index) => {
    if (mode === "chained") return { first: index, last: index + 1 };
    if (mode === "discrete") return { first: index * 2, last: index * 2 + 1 };
    return { first: index, last: null };
  });
}

function transitionKey(first, last) {
  const firstKey = getImageFileKey(first);
  return last ? `${firstKey}»${getImageFileKey(last)}` : firstKey;
}

/**
 * Recover the prompt a user already typed for a transition.
 *
 * Identity is the slot index; the composite file key is only a hint. Keying
 * purely by file pair would look tidier, but a single A–Z re-sort breaks nearly
 * every adjacency and would silently discard every prompt the user wrote. So:
 * an intact pair keeps its prompt wherever it moved, and otherwise the prompt
 * stays at its slot and the images move underneath it — visible and fixable.
 *
 * Each existing entry is consumed at most once so a repeated file cannot smear
 * one prompt across two slots.
 */
function recoverPrompt(existing, consumed, key, index) {
  const take = (predicate) => {
    const position = existing.findIndex(
      (entry, at) => !consumed.has(at) && entry && predicate(entry),
    );
    if (position === -1) return undefined;
    consumed.add(position);
    return existing[position].prompt;
  };

  const byKey = take((entry) => entry.key === key);
  if (byKey !== undefined) return byKey;
  return take((entry) => entry.index === index);
}

function promptForSlot(promptList, index) {
  if (promptList.length === 1) return promptList[0];
  return promptList[index] === undefined ? "" : promptList[index];
}

/**
 * Build the editable rows for every frame mode.
 *
 * Returns `{ frameMode, pairs, excessPrompts, unusedImageIndices }` where each
 * pair carries `file === first` so the single-image row renderer keeps working
 * unchanged. `excessPrompts` lets the UI warn about prompts that will not be
 * used instead of dropping them silently.
 */
export function buildFramePairs(
  images,
  prompts,
  existingPairs = [],
  frameMode = "single",
) {
  const mode = normalizeFrameMode(frameMode);
  const files = Array.from(images || []);
  const promptList = Array.from(prompts || []).map((prompt) =>
    String(prompt || "").trim(),
  );

  // Single mode delegates so its behaviour cannot drift from the original.
  if (mode === "single") {
    const pairs = buildImagePromptPairs(files, prompts, existingPairs).map(
      (pair, index) => ({
        ...pair,
        index,
        first: pair.file,
        firstIndex: index,
        last: null,
        lastIndex: null,
      }),
    );
    return {
      frameMode: mode,
      pairs,
      excessPrompts:
        promptList.length > 1 && promptList.length > pairs.length
          ? promptList.slice(pairs.length)
          : [],
      unusedImageIndices: [],
    };
  }

  const existing = Array.from(existingPairs || []);
  const consumed = new Set();

  const pairs = framePairIndices(files.length, mode).map(
    ({ first, last }, index) => {
      const firstFile = files[first];
      const lastFile = last === null ? null : files[last];
      const key = transitionKey(firstFile, lastFile);
      const recovered = recoverPrompt(existing, consumed, key, index);
      return {
        key,
        index,
        file: firstFile,
        first: firstFile,
        firstIndex: first,
        last: lastFile,
        lastIndex: last,
        prompt:
          recovered === undefined ? promptForSlot(promptList, index) : recovered,
      };
    },
  );

  // A single prompt is deliberately shared by every row, so it is never excess.
  const excessPrompts =
    promptList.length > 1 && promptList.length > pairs.length
      ? promptList.slice(pairs.length)
      : [];

  const usedImages = new Set();
  for (const pair of pairs) {
    usedImages.add(pair.firstIndex);
    if (pair.lastIndex !== null) usedImages.add(pair.lastIndex);
  }
  const unusedImageIndices = files
    .map((_, index) => index)
    .filter((index) => !usedImages.has(index));

  return { frameMode: mode, pairs, excessPrompts, unusedImageIndices };
}
