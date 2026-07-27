import { state } from "./state.js";
import { logMessage } from "./ui.js";
import { i18n } from "./i18n.js";
import { isTransientInjectionError } from "./chrome-errors.js";

export async function injectScript(func, args = []) {
  let tabId = state.flowTabId;

  if (!tabId) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.url?.includes("/tools/flow")) {
        logMessage(i18n("log_critical_error"), "error");
        return;
      }
      tabId = tab.id;
      state.flowTabId = tab.id;
    } catch {
      logMessage(i18n("log_critical_error"), "error");
      return;
    }
  }

  try {
    await chrome.tabs.get(tabId);
  } catch (error) {
    throw error;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args: [...args, state.selectors],
      world: "MAIN",
    });

    if (chrome.runtime.lastError) {
      const message =
        chrome.runtime.lastError.message || i18n("log_unknown_runtime_error");
      if (!state.stopRequested && !isTransientInjectionError(message)) {
        logMessage(
          i18n("log_scripting_error", {
            error: i18n("log_runtime_error", { error: message }),
          }),
          "error",
        );
      }
      return;
    }

    if (results?.[0]?.error) {
      logMessage(
        i18n("log_scripting_error", {
          error: i18n("log_injected_script_error", {
            error: results[0].error.message || results[0].error,
          }),
        }),
        "error",
      );
      return;
    }

    return results?.[0]?.result;
  } catch (error) {
    const message = error.message || String(error);
    if (!state.stopRequested && !isTransientInjectionError(message)) {
      logMessage(i18n("log_scan_inject_failed", { error: message }), "error");
    }
  }
}

export function clickElementByXPath(xpath) {
  if (!xpath) return;
  try {
    const element = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!element) return;
    element.click();
    return true;
  } catch {
    return false;
  }
}

export async function clickNewProjectButton(selectors) {
  const xpath = selectors?.NEW_PROJECT_BUTTON_XPATH;
  if (!xpath) return false;

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const button = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue;
      if (button) {
        button.click();
        return true;
      }
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export async function scanForQueueFullPopup(selectors) {
  try {
    return Boolean(
      document.evaluate(
        selectors.QUEUE_FULL_POPUP_XPATH,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue,
    );
  } catch {
    return false;
  }
}

export async function processPromptOnPage(
  prompt,
  promptSelector,
  generateButtonXPath,
  selectors,
) {
  const waitFor = async (find, timeout = 15000, interval = 100) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = find();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  };
  const byXPath = (xpath, root = document) => {
    if (!xpath) return null;
    try {
      return document.evaluate(
        xpath,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue;
    } catch {
      return null;
    }
  };
  const getEditorText = (editor) =>
    Array.from(editor.querySelectorAll("[data-slate-string]"))
      .map((node) => node.textContent || "")
      .join("");
  const writeSlate = async (editor, value) => {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    const slateStrings = Array.from(
      editor.querySelectorAll("[data-slate-string]"),
    );
    if (slateStrings.length > 0) {
      const first = slateStrings[0];
      const last = slateStrings[slateStrings.length - 1];
      range.setStart(first.firstChild || first, 0);
      range.setEnd(
        last.firstChild || last,
        (last.firstChild?.textContent || last.textContent || "").length,
      );
    } else {
      const zeroWidth = editor.querySelector("[data-slate-zero-width]");
      const textNode = zeroWidth?.firstChild;
      if (!textNode) return false;
      // Slate represents an empty leaf with a zero-width marker. Placing the
      // caret after that marker lets the browser emit one native beforeinput
      // transaction without deleting Slate's placeholder DOM.
      range.setStart(textNode, textNode.textContent?.length || 0);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);

    if (!document.execCommand("insertText", false, value)) {
      return false;
    }

    const synced = await waitFor(
      () => getEditorText(editor).trim() === value.trim(),
      3000,
      50,
    );
    return Boolean(synced);
  };
  const detectError = () => {
    const pageText = document.body?.innerText?.toLowerCase() || "";
    if (
      pageText.includes("queue is full") ||
      pageText.includes("too many generations")
    ) {
      return "QUEUE_FULL";
    }
    const toastText = Array.from(
      document.querySelectorAll("[data-sonner-toast]"),
    )
      .map((node) => node.textContent || "")
      .join(" ")
      .toLowerCase();
    if (toastText.includes("policy") || toastText.includes("not allowed")) {
      return "POLICY_PROMPT";
    }
    return null;
  };

  let editor = null;
  if (promptSelector?.startsWith("//")) {
    editor = byXPath(promptSelector);
  } else if (promptSelector) {
    editor = document.querySelector(promptSelector);
  }
  editor ||= document.querySelector(
    'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
  );
  if (!editor) return false;

  if (!(await writeSlate(editor, prompt))) return false;

  const existingResults = new Set(
    Array.from(document.querySelectorAll('a[href*="/edit/"]')).map(
      (link) => link.href,
    ),
  );
  const button = await waitFor(() => {
    const candidate = byXPath(generateButtonXPath);
    if (
      candidate &&
      !candidate.disabled &&
      candidate.getAttribute("aria-disabled") !== "true"
    ) {
      return candidate;
    }
    return null;
  }, 8000);
  if (!button) return false;

  button.click();

  const accepted = await waitFor(() => {
    const error = detectError();
    if (error) return error;

    const hasNewResult = Array.from(
      document.querySelectorAll('a[href*="/edit/"]'),
    ).some((link) => !existingResults.has(link.href));
    if (hasNewResult) return "SUBMITTED";

    const currentEditor = document.querySelector(
      'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
    );
    if (currentEditor && getEditorText(currentEditor).trim() === "") {
      return "SUBMITTED";
    }
    return null;
  }, 10000);

  if (accepted === "QUEUE_FULL" || accepted === "POLICY_PROMPT") {
    return accepted;
  }
  return accepted === "SUBMITTED";
}

export async function selectImageMode(selectors) {
  const editor = document.querySelector(
    'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
  );
  if (editor) return true;

  try {
    const dropdown = document.evaluate(
      selectors.MODE_DROPDOWN_XPATH,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!dropdown) return false;
    dropdown.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const option = document.evaluate(
      selectors.IMAGE_TO_VIDEO_MODE_XPATH,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!option) return false;
    option.click();
    return true;
  } catch {
    return false;
  }
}

export async function selectTextMode(selectors) {
  const editor = document.querySelector(
    'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
  );
  if (editor) return true;

  try {
    const dropdown = document.evaluate(
      selectors.MODE_DROPDOWN_XPATH,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!dropdown) return false;
    dropdown.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const option = document.evaluate(
      selectors.TEXT_TO_VIDEO_MODE_XPATH,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!option) return false;
    option.click();
    return true;
  } catch {
    return false;
  }
}

export async function setInitialSettings(
  outputCount,
  model,
  aspectRatio,
  duration,
  selectors,
) {
  const startedAt = Date.now();
  const trace = [];
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const elapsed = () => Date.now() - startedAt;
  const record = (step, message, details = undefined) => {
    trace.push({
      step,
      message,
      elapsedMs: elapsed(),
      ...(details === undefined ? {} : { details }),
    });
  };
  const diagnostics = () => ({
    url: location.href,
    readyState: document.readyState,
    composerPresent: Boolean(
      document.querySelector(
        'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      ),
    ),
    buttons: Array.from(document.querySelectorAll("button"))
      .map((button) => normalize(button.textContent))
      .filter(Boolean)
      .filter(
        (text) =>
          text.includes("Video") ||
          text.includes("Omni") ||
          text.includes("Veo") ||
          text.includes("Create"),
      )
      .slice(0, 15),
    tabs: Array.from(document.querySelectorAll('[role="tab"]'))
      .map((tab) => ({
        text: normalize(tab.textContent),
        selected: tab.getAttribute("aria-selected"),
      }))
      .slice(0, 20),
    menus: Array.from(document.querySelectorAll('[role="menu"]'))
      .map((menu) => normalize(menu.textContent).slice(0, 500))
      .slice(0, 5),
  });
  const fail = (step, message, details = undefined) => {
    record(step, message, details);
    return {
      ok: false,
      step,
      message,
      elapsedMs: elapsed(),
      trace,
      diagnostics: diagnostics(),
    };
  };
  const waitFor = async (find, timeout = 10000, interval = 80) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = find();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  };
  const textMatchesLabel = (elementText, label) => {
    const text = normalize(elementText);
    return text === label || text.endsWith(` ${label}`) || text.endsWith(label);
  };
  const findByText = (selector, text, root = document) =>
    Array.from(root.querySelectorAll(selector)).find((element) =>
      textMatchesLabel(element.textContent, text),
    );
  const activate = (element) => {
    if (!element) return null;
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.focus?.({ preventScroll: true });
    const rect = element.getBoundingClientRect();
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const events = [];
    const dispatch = (type, EventType, extra = {}) => {
      const event = new EventType(type, { ...common, ...extra });
      const accepted = element.dispatchEvent(event);
      events.push({
        type,
        accepted,
        defaultPrevented: event.defaultPrevented,
      });
    };

    // Google Flow's Radix menu triggers toggle on pointerdown. Calling
    // HTMLElement.click() alone skips that event and leaves the menu closed.
    if (typeof window.PointerEvent === "function") {
      dispatch("pointerdown", window.PointerEvent, {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      });
    }
    dispatch("mousedown", window.MouseEvent);
    if (typeof window.PointerEvent === "function") {
      dispatch("pointerup", window.PointerEvent, {
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      });
    }
    dispatch("mouseup", window.MouseEvent, { buttons: 0 });
    dispatch("click", window.MouseEvent, { buttons: 0 });

    return {
      tag: element.tagName,
      text: normalize(element.textContent).slice(0, 160),
      id: element.id || null,
      role: element.getAttribute("role"),
      ariaHaspopup: element.getAttribute("aria-haspopup"),
      ariaExpanded: element.getAttribute("aria-expanded"),
      events,
    };
  };
  const clickTab = async (text, root = document) => {
    const step = `tab:${text}`;
    const tab = await waitFor(
      () => findByText('[role="tab"]', text, root),
      5000,
    );
    if (!tab) {
      return fail(
        step,
        `Không tìm thấy tab "${text}" trong 5 giây.`,
        diagnostics().tabs,
      );
    }
    record(step, `Đã tìm thấy "${normalize(tab.textContent)}".`);
    if (tab.getAttribute("aria-selected") !== "true") {
      const activation = activate(tab);
      record(step, `Đã kích hoạt tab "${text}", đang chờ selected.`, {
        activation,
      });
      const selected = await waitFor(
        () => tab.getAttribute("aria-selected") === "true",
        3000,
      );
      if (!selected) {
        return fail(
          step,
          `Tab "${text}" không chuyển sang aria-selected=true.`,
          {
            observedText: normalize(tab.textContent),
            ariaSelected: tab.getAttribute("aria-selected"),
          },
        );
      }
    }
    record(step, `Tab "${text}" đã selected.`);
    return { ok: true };
  };

  const modelSetupProfiles = {
    omni_flash: {
      modelLabel: "Omni Flash",
      durationMode: "select",
      preferredDuration: "4s",
    },
    default: {
      modelLabel: "Omni Flash",
      durationMode: "select",
      preferredDuration: "4s",
    },
    veo3_lite: {
      modelLabel: "Veo 3.1 - Lite",
      durationMode: "model-default",
      preferredDuration: null,
    },
    veo3_fast: {
      modelLabel: "Veo 3.1 - Fast",
      durationMode: "model-default",
      preferredDuration: null,
    },
    veo3_quality: {
      modelLabel: "Veo 3.1 - Quality",
      durationMode: "model-default",
      preferredDuration: null,
    },
  };
  const setupProfile = {
    ...(modelSetupProfiles[model] || modelSetupProfiles.omni_flash),
  };
  if (setupProfile.durationMode === "select") {
    setupProfile.preferredDuration = duration === "6s" ? "6s" : "4s";
  }

  record("start", "Bắt đầu áp dụng cài đặt Flow.", {
    outputCount: String(outputCount),
    model,
    aspectRatio,
    duration: setupProfile.preferredDuration,
  });
  record("profile", `Đã chọn profile setup "${setupProfile.modelLabel}".`, {
    durationMode: setupProfile.durationMode,
    preferredDuration: setupProfile.preferredDuration,
  });
  const settingsButton = await waitFor(() =>
    Array.from(document.querySelectorAll("button")).find((button) => {
      const text = normalize(button.textContent);
      return (
        button.getAttribute("aria-haspopup") === "menu" &&
        text.startsWith("Video") &&
        (text.includes("crop_9_16") || text.includes("crop_16_9"))
      );
    }),
  );
  if (!settingsButton) {
    return fail(
      "settings-button",
      "Không tìm thấy nút cấu hình Video có tỷ lệ khung hình trong 10 giây.",
    );
  }
  record(
    "settings-button",
    `Đã tìm thấy nút "${normalize(settingsButton.textContent)}".`,
  );

  const settingsActivation = activate(settingsButton);
  record(
    "settings-menu",
    "Đã phát pointer/mouse events vào nút cấu hình, đang chờ menu.",
    { activation: settingsActivation },
  );
  const menu = await waitFor(() =>
    Array.from(document.querySelectorAll('[role="menu"]')).find((candidate) =>
      normalize(candidate.textContent).includes("Frames"),
    ),
  );
  if (!menu) {
    return fail(
      "settings-menu",
      "Đã kích hoạt nút cấu hình nhưng menu chứa “Frames” không xuất hiện trong 10 giây.",
      { activation: settingsActivation },
    );
  }
  record("settings-menu", "Menu cấu hình đã mở.");

  const videoResult = await clickTab("Video", menu);
  if (!videoResult.ok) return videoResult;
  const framesResult = await clickTab("Frames", menu);
  if (!framesResult.ok) return framesResult;
  const ratioLabel = aspectRatio === "portrait" ? "9:16" : "16:9";
  const ratioResult = await clickTab(ratioLabel, menu);
  if (!ratioResult.ok) {
    return ratioResult;
  }

  const countLabel =
    String(outputCount) === "1" ? "1x" : `x${String(outputCount)}`;
  const countResult = await clickTab(countLabel, menu);
  if (!countResult.ok) return countResult;

  const desiredModel = setupProfile.modelLabel;
  const modelButton = await waitFor(() =>
    Array.from(menu.querySelectorAll("button")).find((button) => {
      const text = normalize(button.textContent);
      return text.includes("Omni Flash") || text.includes("Veo 3.1");
    }),
  );
  if (!modelButton) {
    return fail(
      "model-button",
      `Không tìm thấy nút model. Model cần chọn: "${desiredModel}".`,
    );
  }
  record(
    "model-button",
    `Model hiện tại: "${normalize(modelButton.textContent)}"; yêu cầu: "${desiredModel}".`,
  );

  if (!normalize(modelButton.textContent).includes(desiredModel)) {
    const modelActivation = activate(modelButton);
    record("model-menu", "Đã kích hoạt menu model.", {
      activation: modelActivation,
    });
    const modelItem = await waitFor(() =>
      Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) =>
        normalize(item.textContent).includes(desiredModel),
      ),
    );
    if (!modelItem) {
      return fail(
        "model-option",
        `Không tìm thấy option model "${desiredModel}" trong 10 giây.`,
      );
    }
    const target = modelItem.querySelector("button") || modelItem;
    const optionActivation = activate(target);
    record("model-option", `Đã kích hoạt model "${desiredModel}".`, {
      activation: optionActivation,
    });
    const modelSelected = await waitFor(
      () => normalize(modelButton.textContent).includes(desiredModel),
      3000,
    );
    if (!modelSelected) {
      return fail(
        "model-option",
        `Sau khi click, nút model không hiển thị "${desiredModel}".`,
        { observed: normalize(modelButton.textContent) },
      );
    }
  }

  const getDurationTabs = () =>
    Array.from(menu.querySelectorAll('[role="tab"]'))
      .map((tab) => ({
        element: tab,
        text: normalize(tab.textContent),
        selected: tab.getAttribute("aria-selected"),
      }))
      .filter((tab) => /^\d+s$/.test(tab.text));
  let selectedDuration = "model-default";
  if (setupProfile.durationMode === "select") {
    const durationTabsReady = await waitFor(
      () => getDurationTabs().length > 0,
      3000,
    );
    if (!durationTabsReady) {
      return fail(
        "duration",
        `Model "${desiredModel}" yêu cầu chọn thời lượng nhưng không có tab duration sau 3 giây.`,
        { availableTabs: diagnostics().tabs },
      );
    }
    const durationResult = await clickTab(setupProfile.preferredDuration, menu);
    if (!durationResult.ok) return durationResult;
    selectedDuration = setupProfile.preferredDuration;
  } else {
    const durationTabsCleared = await waitFor(
      () => (getDurationTabs().length === 0 ? true : null),
      3000,
    );
    if (!durationTabsCleared) {
      return fail(
        "duration:model-default",
        `Model "${desiredModel}" vẫn hiển thị tab duration ngoài profile dự kiến.`,
        { durationTabs: getDurationTabs().map((tab) => tab.text) },
      );
    }
    record(
      "duration:model-default",
      `Model "${desiredModel}" không cung cấp tab duration; dùng thời lượng mặc định do Flow quản lý.`,
    );
  }

  const closeActivation = activate(settingsButton);
  record("settings-close", "Đã kích hoạt đóng menu cấu hình.", {
    activation: closeActivation,
  });
  const closed = await waitFor(
    () =>
      !Array.from(document.querySelectorAll('[role="menu"]')).some(
        (candidate) => normalize(candidate.textContent).includes("Frames"),
      ),
    3000,
  );
  if (!closed) {
    return fail("settings-close", "Menu cấu hình không đóng sau 3 giây.");
  }

  record("complete", "Đã áp dụng đầy đủ cài đặt Flow.");
  return {
    ok: true,
    elapsedMs: elapsed(),
    trace,
    selected: {
      outputCount: countLabel,
      model: desiredModel,
      aspectRatio: ratioLabel,
      duration: selectedDuration,
      mode: "Frames",
    },
  };
}

export async function processImageAndPromptOnPage(
  dataUrl,
  fileName,
  mimeType,
  prompt,
  aspectRatio,
  selectors,
) {
  const startedAt = Date.now();
  const trace = [];
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const elapsed = () => Date.now() - startedAt;
  const record = (step, message, details = undefined) => {
    trace.push({
      step,
      message,
      elapsedMs: elapsed(),
      ...(details === undefined ? {} : { details }),
    });
  };
  const waitFor = async (find, timeout = 15000, interval = 100) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = find();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  };
  const diagnostics = () => ({
    url: location.href,
    readyState: document.readyState,
    fileName,
    mimeType,
    promptLength: String(prompt || "").length,
    fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map(
      (input) => ({
        accept: input.accept,
        multiple: input.multiple,
        disabled: input.disabled,
        files: Array.from(input.files || []).map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      }),
    ),
    mediaCards: Array.from(
      document.querySelectorAll('button, [role="button"], [role="option"]'),
    )
      .map((element) => normalize(element.textContent))
      .filter(Boolean)
      .filter(
        (text) =>
          text.includes(fileName) ||
          text.includes("Failed") ||
          /(?:^|\s)\d+%(?:\s|$)/.test(text),
      )
      .slice(0, 20),
    imageAlts: Array.from(document.querySelectorAll("img"))
      .map((image) => image.alt)
      .filter(Boolean)
      .slice(0, 30),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
      .map((dialog) => normalize(dialog.textContent).slice(0, 500))
      .slice(0, 5),
    editorPresent: Boolean(
      document.querySelector(
        'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      ),
    ),
    editorText: (() => {
      const editor = document.querySelector(
        'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      );
      return editor
        ? Array.from(editor.querySelectorAll("[data-slate-string]"))
            .map((node) => node.textContent || "")
            .join("")
            .slice(0, 300)
        : null;
    })(),
    toasts: Array.from(document.querySelectorAll("[data-sonner-toast]"))
      .map((toast) => normalize(toast.textContent).slice(0, 500))
      .slice(0, 10),
  });
  const finish = (ok, code, step, message, details = undefined) => {
    record(step, message, details);
    return {
      ok,
      code,
      step,
      message,
      elapsedMs: elapsed(),
      trace,
      ...(ok ? {} : { diagnostics: diagnostics() }),
    };
  };
  const fail = (code, step, message, details = undefined) =>
    finish(false, code, step, message, details);
  const activate = (element) => {
    if (!element) return null;
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.focus?.({ preventScroll: true });
    const rect = element.getBoundingClientRect();
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const events = [];
    const dispatch = (type, EventType, extra = {}) => {
      const event = new EventType(type, { ...common, ...extra });
      const accepted = element.dispatchEvent(event);
      events.push({
        type,
        accepted,
        defaultPrevented: event.defaultPrevented,
      });
    };
    if (typeof window.PointerEvent === "function") {
      dispatch("pointerdown", window.PointerEvent, {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      });
    }
    dispatch("mousedown", window.MouseEvent);
    if (typeof window.PointerEvent === "function") {
      dispatch("pointerup", window.PointerEvent, {
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      });
    }
    dispatch("mouseup", window.MouseEvent, { buttons: 0 });
    dispatch("click", window.MouseEvent, { buttons: 0 });
    return {
      tag: element.tagName,
      text: normalize(element.textContent).slice(0, 160),
      role: element.getAttribute("role"),
      ariaExpanded: element.getAttribute("aria-expanded"),
      events,
    };
  };
  const findExactText = (text, root = document) =>
    Array.from(root.querySelectorAll("div,span,p")).find(
      (element) =>
        element.children.length === 0 &&
        normalize(element.textContent) === text,
    );
  const findAsset = () =>
    Array.from(
      document.querySelectorAll('button, [role="button"], [role="option"]'),
    ).find((element) => {
      const text = normalize(element.textContent);
      return (
        text.includes(fileName) &&
        !text.toLowerCase().includes("failed")
      );
    }) ||
    Array.from(document.querySelectorAll("img")).find(
      (image) => normalize(image.alt) === fileName,
    );
  const getFailedIndicatorCount = () =>
    Array.from(
      document.querySelectorAll(
        '[role="status"], [role="alert"], div, span, p',
      ),
    ).filter(
      (element) =>
        element.children.length === 0 &&
        normalize(element.textContent).toLowerCase() === "failed",
    ).length;
  const getCurrentFileFailureCount = () =>
    Array.from(
      document.querySelectorAll(
        'button, [role="button"], [role="status"], [role="alert"]',
      ),
    ).filter((element) => {
      const text = normalize(element.textContent).toLowerCase();
      return (
        text.includes(fileName.toLowerCase()) && text.includes("failed")
      );
    }).length;
  const getUploadState = (knownCurrentFileFailureCount = 0) => {
    const asset = findAsset();
    if (asset) return { status: "ready", asset };
    const texts = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [role="status"], [role="alert"], div, span',
      ),
    )
      .map((element) => normalize(element.textContent))
      .filter(
        (text) =>
          /^\d+%$/.test(text) ||
          text.toLowerCase().includes("uploading"),
      );
    if (texts.some((text) => /^\d+%$/.test(text))) {
      return {
        status: "uploading",
        progress: texts.find((text) => /^\d+%$/.test(text)),
      };
    }
    const failedIndicatorCount = getFailedIndicatorCount();
    const currentFileFailureCount = getCurrentFileFailureCount();
    if (currentFileFailureCount > knownCurrentFileFailureCount) {
      return {
        status: "failed-visible",
        failedIndicatorCount,
        currentFileFailureCount,
        knownCurrentFileFailureCount,
      };
    }
    return null;
  };
  const getEditorText = (editor) =>
    Array.from(editor.querySelectorAll("[data-slate-string]"))
      .map((node) => node.textContent || "")
      .join("");
  const getCreateButton = () =>
    Array.from(document.querySelectorAll("button")).find((button) => {
      const text = normalize(button.textContent);
      return text.includes("arrow_forward") && text.includes("Create");
    });
  const isCreateEnabled = () => {
    const button = getCreateButton();
    return Boolean(
      button &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true",
    );
  };
  const verifySlateValue = async (editor, value, timeout = 3000) =>
    Boolean(
      await waitFor(
        () =>
          getEditorText(editor).trim() === value.trim() && isCreateEnabled(),
        timeout,
        50,
      ),
    );
  const setSlateSelection = async (editor) => {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    const slateStrings = Array.from(
      editor.querySelectorAll("[data-slate-string]"),
    );
    if (slateStrings.length > 0) {
      const first = slateStrings[0];
      const last = slateStrings[slateStrings.length - 1];
      const firstNode = first.firstChild || first;
      const lastNode = last.firstChild || last;
      range.setStart(firstNode, 0);
      range.setEnd(
        lastNode,
        (lastNode.textContent || last.textContent || "").length,
      );
    } else {
      const zeroWidth = editor.querySelector("[data-slate-zero-width]");
      const textNode = zeroWidth?.firstChild;
      if (!textNode) return { ok: false, reason: "zero-width-missing" };
      // Slate expects a collapsed caret inside its zero-width text node.
      // Selecting the whole editor mutates the DOM but leaves editor.selection
      // null, which is why Create remained disabled in v8.3.3.
      const offset = Math.min(1, textNode.textContent?.length || 0);
      range.setStart(textNode, offset);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(
      new Event("selectionchange", { bubbles: true, composed: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    return {
      ok: true,
      activeElementIsEditor: document.activeElement === editor,
      collapsed: selection.isCollapsed,
      anchorNode: selection.anchorNode?.parentElement?.getAttribute(
        "data-slate-zero-width",
      )
        ? "slate-zero-width"
        : selection.anchorNode?.parentElement?.getAttribute("data-slate-string")
          ? "slate-string"
          : selection.anchorNode?.nodeName || null,
      anchorOffset: selection.anchorOffset,
    };
  };
  const getReactEventProps = (editor) => {
    const key = Reflect.ownKeys(editor).find((candidate) =>
      String(candidate).startsWith("__reactProps$"),
    );
    return key ? editor[key] : null;
  };
  const writeSlate = async (editor, value) => {
    const attempts = [];
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    clipboardData.setData("text", value);

    let selection = await setSlateSelection(editor);
    attempts.push({ method: "selection", ...selection });
    if (!selection.ok) {
      return {
        ok: false,
        method: "selection",
        attempts,
        observedText: getEditorText(editor).slice(0, 300),
      };
    }

    let pasteEvent;
    try {
      pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData,
      });
    } catch {
      pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
    }
    if (!pasteEvent.clipboardData) {
      Object.defineProperty(pasteEvent, "clipboardData", {
        configurable: true,
        value: clipboardData,
      });
    }
    const pasteAccepted = editor.dispatchEvent(pasteEvent);
    attempts.push({
      method: "paste",
      accepted: pasteAccepted,
      defaultPrevented: pasteEvent.defaultPrevented,
    });
    if (await verifySlateValue(editor, value, 2500)) {
      return {
        ok: true,
        method: "paste",
        attempts,
        createEnabled: true,
      };
    }

    selection = await setSlateSelection(editor);
    let insertFromPaste;
    try {
      insertFromPaste = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: value,
        inputType: "insertFromPaste",
      });
      Object.defineProperty(insertFromPaste, "dataTransfer", {
        configurable: true,
        value: clipboardData,
      });
    } catch {
      insertFromPaste = new Event("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperties(insertFromPaste, {
        data: { configurable: true, value },
        dataTransfer: { configurable: true, value: clipboardData },
        inputType: { configurable: true, value: "insertFromPaste" },
      });
    }
    const insertFromPasteAccepted = editor.dispatchEvent(insertFromPaste);
    attempts.push({
      method: "insertFromPaste",
      accepted: insertFromPasteAccepted,
      defaultPrevented: insertFromPaste.defaultPrevented,
      selection,
    });
    if (await verifySlateValue(editor, value, 2500)) {
      return {
        ok: true,
        method: "insertFromPaste",
        attempts,
        createEnabled: true,
      };
    }

    // MAIN-world execution can see React's DOM event props. Calling onPaste
    // directly is a fallback for builds where delegated synthetic events are
    // filtered before Slate receives them.
    const reactProps = getReactEventProps(editor);
    const reactHandlerNames = reactProps
      ? Object.keys(reactProps).filter(
          (key) =>
            key.startsWith("on") && typeof reactProps[key] === "function",
        )
      : [];
    if (typeof reactProps?.onPaste === "function") {
      let prevented = false;
      let stopped = false;
      const reactPasteEvent = {
        clipboardData,
        currentTarget: editor,
        target: editor,
        nativeEvent: pasteEvent,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        isDefaultPrevented: () => prevented,
        isPropagationStopped: () => stopped,
        persist() {},
      };
      try {
        selection = await setSlateSelection(editor);
        reactProps.onPaste(reactPasteEvent);
        attempts.push({
          method: "react-onPaste",
          prevented,
          stopped,
          selection,
        });
      } catch (error) {
        attempts.push({
          method: "react-onPaste",
          error: error?.message || String(error),
        });
      }
      if (await verifySlateValue(editor, value, 2500)) {
        return {
          ok: true,
          method: "react-onPaste",
          attempts,
          createEnabled: true,
          reactHandlerNames,
        };
      }
    }

    selection = await setSlateSelection(editor);
    const execCommandAccepted = document.execCommand(
      "insertText",
      false,
      value,
    );
    const inputEvent = new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      composed: true,
      data: value,
      inputType: "insertText",
    });
    const inputAccepted = editor.dispatchEvent(inputEvent);
    attempts.push({
      method: "execCommand+input",
      execCommandAccepted,
      inputAccepted,
      selection,
    });
    const written = await verifySlateValue(editor, value, 3000);
    return {
      ok: written,
      method: "execCommand+input",
      attempts,
      createEnabled: isCreateEnabled(),
      execCommandAccepted,
      observedText: getEditorText(editor).slice(0, 300),
      reactHandlerNames,
      zeroWidthText: Array.from(
        editor.querySelectorAll("[data-slate-zero-width]"),
      )
        .map((node) => (node.textContent || "").replace(/\uFEFF/g, ""))
        .join("")
        .slice(0, 300),
    };
  };
  const detectError = () => {
    const toastText = Array.from(
      document.querySelectorAll("[data-sonner-toast]"),
    )
      .map((node) => node.textContent || "")
      .join(" ")
      .toLowerCase();
    if (
      toastText.includes("queue") ||
      toastText.includes("too many generations")
    ) {
      return "QUEUE_FULL";
    }
    if (toastText.includes("policy") || toastText.includes("not allowed")) {
      return "POLICY_PROMPT";
    }
    return null;
  };

  try {
    record("start", "Bắt đầu nạp First frame và prompt.", {
      fileName,
      mimeType,
      promptLength: String(prompt || "").length,
      aspectRatio,
    });
    const fileResponse = await fetch(dataUrl);
    const blob = await fileResponse.blob();
    const resolvedMimeType = mimeType || blob.type || "image/png";
    const file = new File([blob], fileName, { type: resolvedMimeType });
    record("file", "Đã dựng File từ dữ liệu extension.", {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    let assetReady = Boolean(findAsset());
    const uploadAttemptKey = `${fileName}:${file.size}:${file.type}`;
    const uploadAttemptRegistry =
      window.__coachioUploadAttempts ||
      (window.__coachioUploadAttempts = Object.create(null));
    const previousUploadAt = Number(
      uploadAttemptRegistry[uploadAttemptKey] || 0,
    );
    const uploadAttemptAge = Date.now() - previousUploadAt;
    if (
      !assetReady &&
      previousUploadAt > 0 &&
      uploadAttemptAge < 120000
    ) {
      const remainingGuardMs = 120000 - uploadAttemptAge;
      record(
        "upload-dedupe-wait",
        `File "${fileName}" đã được gửi trong phiên này; chờ media cũ hoàn tất thay vì upload lại.`,
        { uploadAttemptAge, remainingGuardMs },
      );
      assetReady = Boolean(
        await waitFor(findAsset, remainingGuardMs, 250),
      );
      if (assetReady) {
        record(
          "upload-dedupe-ready",
          `Media "${fileName}" xuất hiện từ lượt upload trước; bỏ qua upload lặp.`,
        );
      }
    }
    record(
      "asset-check",
      assetReady
        ? `Media "${fileName}" đã có trong project; bỏ qua upload.`
        : `Chưa có media "${fileName}"; bắt đầu upload.`,
    );

    if (!assetReady) {
      let uploadMenu = null;
      const addMediaButton = Array.from(
        document.querySelectorAll("button"),
      ).find((button) => {
        const text = normalize(button.textContent);
        return text.includes("add") && text.includes("Add Media");
      });
      if (addMediaButton) {
        const addMediaActivation = activate(addMediaButton);
        uploadMenu = await waitFor(
          () =>
            Array.from(document.querySelectorAll('[role="menu"]')).find(
              (menu) => normalize(menu.textContent).includes("Upload media"),
            ),
          3000,
          80,
        );
        record(
          "upload-menu",
          uploadMenu
            ? "Đã mở menu Add Media."
            : "Không thấy menu Add Media; vẫn thử input file trực tiếp.",
          { activation: addMediaActivation },
        );
      }

      if (uploadMenu) {
        const uploadMediaTarget = Array.from(
          uploadMenu.querySelectorAll(
            '[role="menuitem"], [role="option"], button, [role="button"]',
          ),
        ).find((element) =>
          normalize(element.textContent).includes("Upload media"),
        );
        if (uploadMediaTarget) {
          const uploadMediaActivation = activate(uploadMediaTarget);
          record(
            "upload-menu-option",
            "Đã kích hoạt mục “Upload media” trước khi gán file.",
            { activation: uploadMediaActivation },
          );
          await new Promise((resolve) => setTimeout(resolve, 120));
        } else {
          record(
            "upload-menu-option",
            "Menu Add Media đã mở nhưng không tìm thấy mục “Upload media”; thử input hiện có.",
          );
        }
      }

      const input = await waitFor(() => {
        const inputs = Array.from(
          document.querySelectorAll('input[type="file"]'),
        );
        return (
          inputs.find((candidate) =>
            (candidate.accept || "").includes("image"),
          ) || inputs[inputs.length - 1]
        );
      });
      if (!input) {
        return fail(
          "UPLOAD_INPUT_MISSING",
          "upload-input",
          "Không tìm thấy input[type=file] nhận image trong 15 giây.",
        );
      }

      const transfer = new DataTransfer();
      transfer.items.add(file);
      const knownFailedIndicatorCount = getFailedIndicatorCount();
      const knownCurrentFileFailureCount =
        getCurrentFileFailureCount();
      const filesSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      )?.set;
      if (filesSetter) filesSetter.call(input, transfer.files);
      else input.files = transfer.files;
      const inputAccepted = input.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      const changeAccepted = input.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );
      uploadAttemptRegistry[uploadAttemptKey] = Date.now();
      record("upload-dispatch", "Đã gán file và phát input/change events.", {
        inputAccepted,
        changeAccepted,
        files: Array.from(input.files || []).map((item) => ({
          name: item.name,
          size: item.size,
          type: item.type,
        })),
        knownFailedIndicatorCount,
        knownCurrentFileFailureCount,
      });

      // Large source images can take tens of seconds before Flow renders a
      // progress label or media card. Re-dispatching change/drop during that
      // silent window creates duplicate uploads, so one file is submitted
      // exactly once and then observed until it becomes visible.
      let uploadState = await waitFor(() => {
        const visibleState = getUploadState(
          knownCurrentFileFailureCount,
        );
        if (visibleState) return visibleState;
        if ((input.files?.length || 0) === 0) {
          return { status: "accepted-hidden" };
        }
        return null;
      }, 15000, 150);
      if (uploadState?.status === "accepted-hidden") {
        record(
          "upload-accepted",
          "Flow đã tiêu thụ file; đang chờ media xuất hiện, không phát lại upload.",
        );
        uploadState = await waitFor(
          () => getUploadState(knownCurrentFileFailureCount),
          105000,
          250,
        );
      } else if (!uploadState) {
        record(
          "upload-wait",
          "Chưa có progress sau 15 giây; tiếp tục chờ upload gốc để tránh tạo media trùng.",
          {
            retainedFiles: Array.from(input.files || []).map(
              (item) => item.name,
            ),
          },
        );
        uploadState = await waitFor(
          () => getUploadState(knownCurrentFileFailureCount),
          105000,
          250,
        );
      }
      if (!uploadState) {
        return fail(
          "UPLOAD_NOT_STARTED",
          "upload-start",
          "Đã gửi file đúng một lần nhưng Flow không xuất hiện progress hoặc media mới sau 120 giây.",
        );
      }
      if (uploadState.status === "failed-visible") {
        const failedState = uploadState;
        const recoveredAsset = await waitFor(findAsset, 10000, 200);
        if (recoveredAsset) {
          uploadState = { status: "ready", asset: recoveredAsset };
          record(
            "upload-recovered",
            `Flow từng hiện Failed nhưng media "${fileName}" vẫn xuất hiện; bỏ qua lỗi trung gian.`,
            {
              failedIndicatorCount: failedState.failedIndicatorCount,
              knownFailedIndicatorCount,
              currentFileFailureCount:
                failedState.currentFileFailureCount,
              knownCurrentFileFailureCount,
            },
          );
        }
      }
      if (uploadState.status === "failed-visible") {
        return fail(
          "UPLOAD_FAILED",
          "upload-start",
          `Flow xuất hiện lỗi Failed mới gắn với lượt upload "${fileName}".`,
          {
            failedIndicatorCount: uploadState.failedIndicatorCount,
            knownFailedIndicatorCount,
            currentFileFailureCount:
              uploadState.currentFileFailureCount,
            knownCurrentFileFailureCount,
          },
        );
      }
      record("upload-start", "Flow đã nhận tín hiệu upload.", {
        status: uploadState.status,
        progress: uploadState.progress || null,
      });

      assetReady =
        uploadState.status === "ready" ||
        Boolean(
          await waitFor(
            () => {
              const state = getUploadState(
                knownCurrentFileFailureCount,
              );
              return state?.status === "ready" ? state : null;
            },
            90000,
            200,
          ),
        );
      if (!assetReady) {
        return fail(
          "UPLOAD_TIMEOUT",
          "upload-ready",
          "Flow đã bắt đầu nhận file nhưng media chưa sẵn sàng sau 90 giây.",
        );
      }
      record("upload-ready", `Media "${fileName}" đã sẵn sàng.`);
    }

    const findAttachedFrame = () =>
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.querySelector(
          'img[alt*="piece of media"], img[alt*="uploaded by you"]',
        ),
      );
    const existingFrame = findAttachedFrame();
    if (!existingFrame) {
      let dialog = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).find((element) =>
        normalize(element.textContent).includes("Add to Prompt"),
      );
      if (dialog) {
        record(
          "first-frame-dialog",
          "Tái sử dụng dialog Add to Prompt đang mở từ lượt thử trước.",
        );
      } else {
        const start = await waitFor(() => findExactText("Start"));
        if (!start) {
          return fail(
            "FIRST_FRAME_TRIGGER_MISSING",
            "first-frame-trigger",
            "Media đã sẵn sàng nhưng không tìm thấy trigger “Start”.",
          );
        }
        const startActivation = activate(start);
        record("first-frame-trigger", "Đã kích hoạt trigger Start.", {
          activation: startActivation,
        });

        dialog = await waitFor(() =>
          Array.from(document.querySelectorAll('[role="dialog"]')).find(
            (element) =>
              normalize(element.textContent).includes("Add to Prompt"),
          ),
        );
      }
      if (!dialog) {
        return fail(
          "FIRST_FRAME_DIALOG_MISSING",
          "first-frame-dialog",
          "Đã kích hoạt Start nhưng dialog “Add to Prompt” không xuất hiện.",
        );
      }
      if (
        !trace.some(
          (entry) =>
            entry.step === "first-frame-dialog" &&
            entry.message.includes("Tái sử dụng"),
        )
      ) {
        record("first-frame-dialog", "Dialog Add to Prompt đã mở.");
      }

      const findDialogOption = () =>
        Array.from(
          dialog.querySelectorAll('[role="option"], button, [role="button"]'),
        ).find(
          (element) =>
            normalize(element.textContent).includes(fileName) ||
            normalize(element.querySelector("img")?.alt) === fileName,
        );
      let option = await waitFor(findDialogOption, 3000, 100);
      if (!option) {
        const uploadsLabel =
          Array.from(
            dialog.querySelectorAll(
              '[role="tab"], button, [role="button"], div, span, p',
            ),
          ).find(
            (element) =>
              element.children.length === 0 &&
              normalize(element.textContent) === "Uploads",
          ) || findExactText("Uploads", dialog);
        const uploadsTarget =
          uploadsLabel?.closest?.('[role="tab"], button, [role="button"]') ||
          uploadsLabel;
        if (uploadsTarget) {
          const uploadsActivation = activate(uploadsTarget);
          record(
            "first-frame-source",
            "Media chưa có trong Recent; đã chuyển dialog sang nguồn Uploads.",
            { activation: uploadsActivation },
          );
        } else {
          record(
            "first-frame-source",
            "Không tìm thấy tab Uploads trong dialog; tiếp tục chờ nguồn hiện tại.",
          );
        }
        option = await waitFor(findDialogOption, 20000, 150);
      }
      if (!option) {
        return fail(
          "FIRST_FRAME_OPTION_MISSING",
          "first-frame-option",
          `Dialog mở nhưng không tìm thấy media "${fileName}" trong 20 giây.`,
          {
            options: Array.from(
              dialog.querySelectorAll(
                '[role="option"], button, [role="button"]',
              ),
            ).map((element) => normalize(element.textContent).slice(0, 160)),
          },
        );
      }
      const optionActivation = activate(option);
      record("first-frame-option", `Đã chọn "${fileName}" làm First frame.`, {
        activation: optionActivation,
        selected: {
          ariaSelected: option.getAttribute("aria-selected"),
          dataState: option.getAttribute("data-state"),
        },
      });

      let attachedAfterSelection = await waitFor(findAttachedFrame, 1200, 80);
      if (!attachedAfterSelection) {
        const confirmButton = await waitFor(() => {
          const currentDialog = Array.from(
            document.querySelectorAll('[role="dialog"]'),
          ).find((element) =>
            normalize(element.textContent).includes("Add to Prompt"),
          );
          if (!currentDialog) return null;
          return Array.from(
            currentDialog.querySelectorAll('button, [role="button"]'),
          ).find((button) => {
            const text = normalize(button.textContent);
            return (
              text.includes("Add to Prompt") &&
              !button.disabled &&
              button.getAttribute("aria-disabled") !== "true"
            );
          });
        }, 4000, 80);
        if (!confirmButton) {
          return fail(
            "FIRST_FRAME_CONFIRM_DISABLED",
            "first-frame-confirm",
            `Đã chọn "${fileName}" nhưng nút “Add to Prompt” không được bật sau 4 giây.`,
            {
              option: {
                ariaSelected: option.getAttribute("aria-selected"),
                dataState: option.getAttribute("data-state"),
              },
            },
          );
        }
        const confirmActivation = activate(confirmButton);
        record(
          "first-frame-confirm",
          "Đã xác nhận nút “Add to Prompt”.",
          { activation: confirmActivation },
        );
        attachedAfterSelection = await waitFor(
          findAttachedFrame,
          10000,
          100,
        );
      } else {
        record(
          "first-frame-confirm",
          "Flow đã tự gắn ảnh ngay sau khi chọn; không cần nút xác nhận.",
        );
      }
    } else {
      record("first-frame-option", "First frame đã được gắn sẵn; bỏ qua.");
    }

    const frameAttached = await waitFor(findAttachedFrame, 10000, 100);
    if (!frameAttached) {
      return fail(
        "FIRST_FRAME_NOT_ATTACHED",
        "first-frame-attached",
        `Đã chọn "${fileName}" nhưng First frame không xuất hiện trong composer.`,
      );
    }
    record("first-frame-attached", "First frame đã xuất hiện trong composer.");

    const editor = await waitFor(() =>
      document.querySelector(
        'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      ),
    );
    if (!editor) {
      return fail(
        "PROMPT_EDITOR_MISSING",
        "prompt-editor",
        "Không tìm thấy Slate prompt editor.",
      );
    }
    const promptWrite = await writeSlate(editor, prompt);
    record("prompt-write", "Đã thực hiện thao tác nạp prompt.", promptWrite);
    if (!promptWrite.ok) {
      return fail(
        "PROMPT_WRITE_FAILED",
        "prompt-verify",
        "Đã thử paste/insertFromPaste/React onPaste nhưng Slate state hoặc nút Create chưa hợp lệ.",
        promptWrite,
      );
    }
    record("prompt-verify", "Prompt trong Slate đã khớp dữ liệu đầu vào.");

    const existingResults = new Set(
      Array.from(document.querySelectorAll('a[href*="/edit/"]')).map(
        (link) => link.href,
      ),
    );
    const createButton = await waitFor(() =>
      Array.from(document.querySelectorAll("button")).find((button) => {
        const text = normalize(button.textContent);
        return (
          text.includes("arrow_forward") &&
          text.includes("Create") &&
          !button.disabled &&
          button.getAttribute("aria-disabled") !== "true"
        );
      }),
    );
    if (!createButton) {
      return fail(
        "CREATE_BUTTON_DISABLED",
        "create-button",
        "First frame và prompt đã nạp nhưng nút Create vẫn disabled hoặc không xuất hiện.",
      );
    }
    const createActivation = activate(createButton);
    record("create-button", "Đã kích hoạt nút Create.", {
      activation: createActivation,
    });

    const accepted = await waitFor(() => {
      const error = detectError();
      if (error) return error;
      const hasNewResult = Array.from(
        document.querySelectorAll('a[href*="/edit/"]'),
      ).some((link) => !existingResults.has(link.href));
      if (hasNewResult) return "SUBMITTED";
      const currentEditor = document.querySelector(
        'div[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      );
      if (currentEditor && getEditorText(currentEditor).trim() === "") {
        return "SUBMITTED";
      }
      return null;
    }, 12000);

    if (accepted === "QUEUE_FULL" || accepted === "POLICY_PROMPT") {
      return finish(
        false,
        accepted,
        "submission",
        accepted === "QUEUE_FULL"
          ? "Flow báo hàng đợi đã đầy."
          : "Flow từ chối prompt theo policy.",
      );
    }
    if (accepted !== "SUBMITTED") {
      return fail(
        "SUBMISSION_NOT_CONFIRMED",
        "submission",
        "Đã click Create nhưng không thấy tín hiệu submit trong 12 giây.",
      );
    }
    return finish(
      true,
      "SUBMITTED",
      "complete",
      "Đã nạp First frame, prompt và gửi Create thành công.",
    );
  } catch (error) {
    return fail(
      "UNEXPECTED_ERROR",
      "exception",
      `${error?.name || "Error"}: ${error?.message || String(error)}`,
      { stack: String(error?.stack || "").slice(0, 1200) },
    );
  }
}

export function findAndGroupNewVideos(existingCardIds, selectors) {
  const knownCardIds = new Set(existingCardIds || []);
  const groups = [];
  const seen = new Set();
  const readCardId = (card) => {
    const tileId = card.querySelector("[data-tile-id]")?.getAttribute(
      "data-tile-id",
    );
    if (tileId) return tileId;
    const editHref = card.querySelector('a[href*="/edit/"]')?.getAttribute(
      "href",
    );
    if (editHref) return editHref;
    const mediaName = (() => {
      try {
        const src =
          card.querySelector("video")?.currentSrc ||
          card.querySelector("video")?.getAttribute("src") ||
          "";
        return new URL(src, location.href).searchParams.get("name");
      } catch {
        return null;
      }
    })();
    return mediaName ? `media:${mediaName}` : null;
  };

  try {
    const videoCards = Array.from(
      document.querySelectorAll(
        '[role="button"][aria-roledescription="draggable"]',
      ),
    ).filter((card) => card.querySelector("video"));
    for (const card of videoCards) {
      const video = card.querySelector("video");
      if (!video) continue;
      const source =
        video.currentSrc || video.getAttribute("src") || "";
      if (!source) continue;
      try {
        const parsedSource = new URL(source, location.href);
        const isThumbnail =
          parsedSource.searchParams
            .get("mediaUrlType")
            ?.toUpperCase()
            .includes("THUMBNAIL") ||
          /thumbnail/i.test(parsedSource.pathname);
        if (isThumbnail) continue;
      } catch {
        continue;
      }
      const cardId = readCardId(card);
      if (!cardId || knownCardIds.has(cardId) || seen.has(cardId)) continue;
      seen.add(cardId);

      const rawText = (card.textContent || "")
        .replace(
          /Video thumbnail|Video progress|play_circle|favorite|Favorite|redo|Reuse prompt|more_vert|\bMore\b/gi,
          " ",
        )
        .replace(/\b\d+%\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const prompt = rawText || "";
      const existingGroup = groups.find((group) => group.prompt === prompt);
      if (existingGroup) existingGroup.videos.push(cardId);
      else groups.push({ prompt, videos: [cardId] });
    }
  } catch {
    return [];
  }

  return groups;
}

export function scanExistingVideos() {
  const cardIds = new Set();
  const readCardId = (card) => {
    const tileId = card.querySelector("[data-tile-id]")?.getAttribute(
      "data-tile-id",
    );
    if (tileId) return tileId;
    const editHref = card.querySelector('a[href*="/edit/"]')?.getAttribute(
      "href",
    );
    if (editHref) return editHref;
    try {
      const src =
        card.querySelector("video")?.currentSrc ||
        card.querySelector("video")?.getAttribute("src") ||
        "";
      const mediaName = new URL(src, location.href).searchParams.get("name");
      return mediaName ? `media:${mediaName}` : null;
    } catch {
      return null;
    }
  };
  try {
    Array.from(
      document.querySelectorAll(
        '[role="button"][aria-roledescription="draggable"]',
      ),
    )
      .filter((card) => card.querySelector("video"))
      .forEach((card) => {
        const cardId = readCardId(card);
        if (cardId) cardIds.add(cardId);
      });
  } catch {
    // Ignore transient Flow rendering errors.
  }
  return Array.from(cardIds);
}

export function getFlowVideoCardSource(cardId) {
  try {
    const card = Array.from(
      document.querySelectorAll(
        '[role="button"][aria-roledescription="draggable"]',
      ),
    ).find((candidate) => {
      const tileId = candidate
        .querySelector("[data-tile-id]")
        ?.getAttribute("data-tile-id");
      const editHref = candidate
        .querySelector('a[href*="/edit/"]')
        ?.getAttribute("href");
      let mediaFallback = null;
      try {
        const src =
          candidate.querySelector("video")?.currentSrc ||
          candidate.querySelector("video")?.getAttribute("src") ||
          "";
        const mediaName = new URL(src, location.href).searchParams.get("name");
        mediaFallback = mediaName ? `media:${mediaName}` : null;
      } catch {
        mediaFallback = null;
      }
      return [tileId, editHref, mediaFallback].includes(cardId);
    });
    if (!card) {
      return {
        ok: false,
        step: "video-card",
        message: `Không còn tìm thấy card video "${cardId}".`,
      };
    }

    const video = card.querySelector("video");
    if (!video) {
      return {
        ok: false,
        step: "video-ready",
        message: "Card đúng nhưng chưa có phần tử video để tải.",
      };
    }

    const source = video.currentSrc || video.getAttribute("src") || "";
    const parsed = new URL(source, location.href);
    const hostAllowed =
      parsed.hostname === "labs.google" ||
      parsed.hostname.endsWith(".googleusercontent.com");
    const isThumbnail =
      parsed.searchParams
        .get("mediaUrlType")
        ?.toUpperCase()
        .includes("THUMBNAIL") ||
      /thumbnail/i.test(parsed.pathname);
    if (
      parsed.protocol !== "https:" ||
      !hostAllowed ||
      isThumbnail ||
      !parsed.href
    ) {
      return {
        ok: false,
        step: "video-source",
        message:
          "Nguồn media của card không phải URL video Google hợp lệ; từ chối tải để tránh lưu nhầm ảnh.",
        source: parsed.href || source,
      };
    }

    return {
      ok: true,
      step: "video-source",
      message: "Đã lấy URL video thật từ đúng card.",
      cardId,
      url: parsed.href,
      readyState: video.readyState,
      earlyDetection: video.readyState < 2,
    };
  } catch (error) {
    return {
      ok: false,
      step: "video-source",
      message: `${error?.name || "Error"}: ${error?.message || String(error)}`,
    };
  }
}

export async function triggerFlowVideoCardDownload(cardId) {
  const wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  const activate = (element) => {
    if (!element) return false;
    try {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
      const pointerOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      };
      const mouseOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
      };
      if (typeof PointerEvent === "function") {
        element.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
      }
      element.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
      if (typeof PointerEvent === "function") {
        element.dispatchEvent(
          new PointerEvent("pointerup", { ...pointerOptions, buttons: 0 }),
        );
      }
      element.dispatchEvent(
        new MouseEvent("mouseup", { ...mouseOptions, buttons: 0 }),
      );
      element.dispatchEvent(
        new MouseEvent("click", { ...mouseOptions, buttons: 0 }),
      );
      return true;
    } catch {
      return false;
    }
  };
  const exposeToolbar = (card) => {
    try {
      card.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
      card.focus({ preventScroll: true });
      const hoverEvents = ["pointerover", "mouseover", "mouseenter", "mousemove"];
      for (const type of hoverEvents) {
        const EventClass =
          type.startsWith("pointer") && typeof PointerEvent === "function"
            ? PointerEvent
            : MouseEvent;
        card.dispatchEvent(
          new EventClass(type, {
            bubbles: type !== "mouseenter",
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
      }
    } catch {
      // The bounded wait below will report a precise toolbar failure.
    }
  };
  const waitFor = async (predicate, timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = predicate();
      if (result) return result;
      await wait(80);
    }
    return null;
  };

  try {
    const card = Array.from(
      document.querySelectorAll(
        '[role="button"][aria-roledescription="draggable"]',
      ),
    ).find((candidate) => {
      const tileId = candidate
        .querySelector("[data-tile-id]")
        ?.getAttribute("data-tile-id");
      const editHref = candidate
        .querySelector('a[href*="/edit/"]')
        ?.getAttribute("href");
      let mediaFallback = null;
      try {
        const src =
          candidate.querySelector("video")?.currentSrc ||
          candidate.querySelector("video")?.getAttribute("src") ||
          "";
        const mediaName = new URL(src, location.href).searchParams.get("name");
        mediaFallback = mediaName ? `media:${mediaName}` : null;
      } catch {
        mediaFallback = null;
      }
      return [tileId, editHref, mediaFallback].includes(cardId);
    });
    if (!card) {
      return {
        ok: false,
        step: "video-card",
        message: `Không còn tìm thấy card video "${cardId}".`,
      };
    }
    const video = card.querySelector("video");
    if (!video || video.readyState < 2) {
      return {
        ok: false,
        step: "video-ready",
        message: "Card đúng nhưng video chưa sẵn sàng để tải.",
      };
    }

    exposeToolbar(card);
    const menuButton = await waitFor(
      () => card.querySelector('button[aria-haspopup="menu"]'),
      2500,
    );
    if (!menuButton) {
      return {
        ok: false,
        step: "card-toolbar",
        message: "Đã hover/focus card nhưng nút ba chấm không xuất hiện.",
      };
    }
    if (!activate(menuButton)) {
      return {
        ok: false,
        step: "card-menu",
        message: "Không thể kích hoạt nút ba chấm của card video.",
      };
    }

    const downloadItem = await waitFor(
      () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).find(
          (item) => {
            const icon = (item.querySelector("i")?.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            const text = (item.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            return icon === "download" && text.endsWith("download");
          },
        ),
      2500,
    );
    if (!downloadItem) {
      return {
        ok: false,
        step: "download-menuitem",
        message: 'Menu đã mở nhưng không có mục "Download".',
      };
    }
    if (!activate(downloadItem)) {
      return {
        ok: false,
        step: "download-click",
        message: 'Không thể kích hoạt mục "Download".',
      };
    }
    return {
      ok: true,
      step: "download-click",
      message: "Đã chọn Download từ menu của đúng card video.",
      cardId,
    };
  } catch (error) {
    return {
      ok: false,
      step: "exception",
      message: `${error?.name || "Error"}: ${error?.message || String(error)}`,
    };
  }
}

export function inspectVideoDiscovery() {
  try {
    const videos = Array.from(document.querySelectorAll("video"));
    const videoCards = Array.from(
      document.querySelectorAll(
        '[role="button"][aria-roledescription="draggable"]',
      ),
    ).filter((card) => card.querySelector("video"));
    const downloadControls = Array.from(
      document.querySelectorAll('a[href], button[aria-label]'),
    ).filter((element) =>
      /download/i.test(
        `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`,
      ),
    );
    return {
      videoCount: videos.length,
      videoCardCount: videoCards.length,
      videoCards: videoCards.slice(0, 8).map((card) => ({
        tileId:
          card
            .querySelector("[data-tile-id]")
            ?.getAttribute("data-tile-id") || "",
        editHref:
          card.querySelector('a[href*="/edit/"]')?.getAttribute("href") || "",
        prompt: (card.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160),
        readyState: card.querySelector("video")?.readyState ?? -1,
        menuPresent: Boolean(
          card.querySelector('button[aria-haspopup="menu"]'),
        ),
      })),
      videos: videos.slice(0, 8).map((video) => ({
        currentSrc: video.currentSrc || "",
        src: video.getAttribute("src") || "",
        source: video.querySelector("source")?.getAttribute("src") || "",
        readyState: video.readyState,
      })),
      downloadControlCount: downloadControls.length,
      downloadControls: downloadControls.slice(0, 8).map((element) => ({
        tag: element.tagName,
        href: element.getAttribute("href") || "",
        label: (
          element.getAttribute("aria-label") ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
      })),
      videoResources:
        typeof performance?.getEntriesByType === "function"
          ? performance
              .getEntriesByType("resource")
              .map((entry) => entry?.name || "")
              .filter((url) =>
                /(?:\.mp4(?:$|\?)|videoplayback|googlevideo\.com|media\.getMediaUrlRedirect)/i.test(
                  url,
                ),
              )
              .slice(-8)
          : [],
    };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

export function scanForPolicyError(selectors) {
  try {
    return Boolean(
      document.evaluate(
        selectors.PROMPT_POLICY_ERROR_POPUP_XPATH,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue,
    );
  } catch {
    return false;
  }
}
