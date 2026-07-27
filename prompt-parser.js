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
