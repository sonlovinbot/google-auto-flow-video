import test from "node:test";
import assert from "node:assert/strict";

/**
 * Minimal DOM good enough to run the filmstrip renderer headlessly.
 * The panel code has no framework, so this catches the errors that source-text
 * assertions cannot: typos in element APIs, undefined identifiers, and rows
 * that silently fail to build.
 */
function createStubDom() {
  const listeners = [];
  const make = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      dataset: {},
      style: {},
      classList: {
        _set: new Set(),
        add(...names) {
          names.forEach((name) => this._set.add(name));
        },
        remove(name) {
          this._set.delete(name);
        },
        contains(name) {
          return this._set.has(name);
        },
        toggle(name, force) {
          if (force) this._set.add(name);
          else this._set.delete(name);
        },
      },
      attributes: {},
      textContent: "",
      value: "",
      hidden: false,
      disabled: false,
      set className(value) {
        this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
      },
      get className() {
        return [...this.classList._set].join(" ");
      },
      set innerHTML(value) {
        if (value === "") this.children = [];
        this._html = value;
      },
      get innerHTML() {
        return this._html || "";
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      append(...kids) {
        kids.forEach((kid) => this.children.push(kid));
      },
      addEventListener(type, handler) {
        listeners.push({ node: this, type, handler });
      },
      click() {},
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    };
    return node;
  };

  const walk = (node, out = []) => {
    out.push(node);
    for (const child of node.children || []) walk(child, out);
    return out;
  };

  return {
    make,
    listeners,
    walk,
    document: {
      createElement: make,
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
      getElementById() {
        return null;
      },
    },
  };
}

async function renderWith(frameMode, imageCount) {
  const stub = createStubDom();
  globalThis.document = stub.document;
  globalThis.URL = { createObjectURL: () => "blob:stub" };
  const storage = {};
  globalThis.chrome = {
    storage: {
      local: {
        set(items) {
          Object.assign(storage, items);
        },
        get(_keys, cb) {
          cb?.({});
        },
      },
    },
    runtime: { lastError: undefined, getManifest: () => ({ version: "test" }) },
  };

  const { dom } = await import("../dom.js");
  const { state } = await import("../state.js");
  const handlers = await import("../handlers.js");

  const container = stub.make("div");
  dom.imagePromptPairsContainer = container;
  dom.modeSelector = { value: "image-to-video" };
  dom.frameModeSelector = { value: frameMode };
  dom.promptsTextarea = { value: "" };
  dom.logDisplay = null;

  state.imageFileList = Array.from({ length: imageCount }, (_, index) => ({
    name: `${index + 1}.png`,
    size: (index + 1) * 10,
    lastModified: index + 1,
  }));
  state.imagePromptPairs = [];

  handlers.renderImagePromptPairs(false);
  return { container, storage, state, nodes: stub.walk(container) };
}

test("chained mode renders every image once with prompts between them", async () => {
  const { container, nodes, state } = await renderWith("chained", 4);

  const frames = nodes.filter((node) =>
    node.classList.contains("filmstrip-frame"),
  );
  const links = nodes.filter((node) =>
    node.classList.contains("filmstrip-link"),
  );

  assert.equal(frames.length, 4, "one card per image, each shown once");
  assert.equal(links.length, 3, "N-1 transitions for N images");
  assert.equal(state.imagePromptPairs.length, 3);
  assert.equal(container.dataset.frameMode, "chained");

  const summary = nodes.find((node) =>
    node.classList.contains("filmstrip-summary"),
  );
  assert.ok(summary, "summary line is rendered");
  assert.match(summary.textContent, /4/);
});

test("discrete mode renders gaps between pairs and flags the odd image", async () => {
  const { nodes } = await renderWith("discrete", 7);

  const links = nodes.filter((node) =>
    node.classList.contains("filmstrip-link"),
  );
  const gaps = nodes.filter((node) => node.classList.contains("filmstrip-gap"));
  const unused = nodes.filter((node) =>
    node.classList.contains("filmstrip-frame-unused"),
  );
  const warnings = nodes.filter((node) =>
    node.classList.contains("filmstrip-warning"),
  );

  assert.equal(links.length, 3, "floor(7/2) transitions");
  assert.equal(gaps.length, 2, "a divider between independent pairs");
  assert.equal(unused.length, 1, "the trailing odd image is dimmed");
  assert.ok(warnings.length >= 1, "and is warned about");
});

test("single mode renders the original row with no reorder column", async () => {
  const { nodes, state } = await renderWith("single", 3);

  const frames = nodes.filter((node) =>
    node.classList.contains("filmstrip-frame"),
  );
  const links = nodes.filter((node) =>
    node.classList.contains("filmstrip-link"),
  );
  const moves = nodes.filter((node) =>
    node.classList.contains("filmstrip-move"),
  );
  const inputs = nodes.filter((node) =>
    node.classList.contains("image-prompt-input"),
  );

  assert.equal(frames.length, 3);
  assert.equal(links.length, 0, "no connectors in single mode");
  assert.equal(moves.length, 0, "no reorder column in single mode");
  assert.equal(inputs.length, 3, "the prompt stays inside each row");
  assert.equal(state.imagePromptPairs.length, 3);
});

test("frame modes show the reorder column with the ends disabled", async () => {
  const { nodes } = await renderWith("chained", 3);

  const moves = nodes.filter((node) =>
    node.classList.contains("filmstrip-move"),
  );
  assert.equal(moves.length, 3, "one control group per image");

  const ups = nodes.filter((node) =>
    node.classList.contains("filmstrip-move-up"),
  );
  const downs = nodes.filter((node) =>
    node.classList.contains("filmstrip-move-down"),
  );
  assert.equal(ups[0].disabled, true, "first image cannot move up");
  assert.equal(downs[downs.length - 1].disabled, true, "last cannot move down");
  assert.equal(ups[1].disabled, false);
});

test("frame-mode prompts persist to framePrompts, not the textarea mirror", async () => {
  const { nodes, storage, state } = await renderWith("chained", 3);

  const input = nodes.find((node) =>
    node.classList.contains("image-prompt-input"),
  );
  assert.ok(input, "a transition prompt box exists");
  assert.equal(input.dataset.pairIndex, "0");

  // Simulate typing into the first transition.
  input.value = "máy quay lia sang phải";
  state.imagePromptPairs[0].prompt = input.value;

  const { dom } = await import("../dom.js");
  assert.equal(
    dom.promptsTextarea.value,
    "",
    "the lossy textarea mirror is not written in frame modes",
  );
  assert.equal(storage.prompts, undefined);
});

test("an empty image list clears the strip without throwing", async () => {
  const { container, state } = await renderWith("chained", 0);
  assert.equal(container.style.display, "none");
  assert.deepEqual(state.imagePromptPairs, []);
});
