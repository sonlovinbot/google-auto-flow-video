import { dom } from "./dom.js";
import { state } from "./state.js";
import {
  updateMainButton,
  updateLiveStatus,
  updateButtonStates,
  updateInterfaceVisibility,
  updateUIAfterModeChange,
  logMessage,
  updateQueueModal,
  updateModelSpecificSettings,
} from "./ui.js";
import { i18n } from "./i18n.js";
import { setLanguage } from "./language.js";
import { startQueue, resetState } from "./automation.js";
import { stopScanner } from "./scanner.js";
import { sortImageFiles } from "./utils.js";
import { saveImage, clearAllImages, deleteImage } from "./db.js";
import {
  buildFramePairs,
  countTransitions,
  getImageFileKey,
  isFramePairMode,
  normalizeFrameMode,
  parsePrompts,
} from "./prompt-parser.js";

const imagePreviewUrls = new WeakMap();

/** The frame mode the Create tab is currently set to. */
function currentFrameMode() {
  return normalizeFrameMode(dom.frameModeSelector?.value);
}

function getImagePreviewUrl(file) {
  if (!file) return "";
  let url = imagePreviewUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    imagePreviewUrls.set(file, url);
  }
  return url;
}

function renderImagePromptPairs(preserveExisting = true) {
  if (!dom.imagePromptPairsContainer) return;
  if (
    dom.modeSelector?.value !== "image-to-video" ||
    state.imageFileList.length === 0
  ) {
    dom.imagePromptPairsContainer.innerHTML = "";
    dom.imagePromptPairsContainer.style.display = "none";
    state.imagePromptPairs = [];
    return;
  }

  const prompts = parsePrompts(dom.promptsTextarea.value);
  const built = buildFramePairs(
    state.imageFileList,
    prompts,
    preserveExisting ? state.imagePromptPairs : [],
    currentFrameMode(),
  );
  state.imagePromptPairs = built.pairs;
  state.framePairsMeta = built;
  dom.imagePromptPairsContainer.innerHTML = "";

  state.imagePromptPairs.forEach((pair, index) => {
    const row = document.createElement("div");
    row.className = "image-prompt-pair";

    const rowIndex = document.createElement("div");
    rowIndex.className = "image-prompt-index";
    rowIndex.textContent = String(index + 1).padStart(2, "0");

    const imagePicker = document.createElement("button");
    imagePicker.type = "button";
    imagePicker.className = "image-prompt-media";
    imagePicker.setAttribute(
      "aria-label",
      i18n("image_row_replace_aria", { filename: pair.file.name }),
    );

    const preview = document.createElement("img");
    preview.src = getImagePreviewUrl(pair.file);
    preview.alt = pair.file.name;
    imagePicker.appendChild(preview);

    const replacementInput = document.createElement("input");
    replacementInput.type = "file";
    replacementInput.accept = "image/*";
    replacementInput.hidden = true;
    imagePicker.addEventListener("click", () => replacementInput.click());
    replacementInput.addEventListener("change", () => {
      const replacement = replacementInput.files?.[0];
      if (!replacement) return;
      // Replacing the image must never discard the prompt edited for this row.
      const currentPrompt = pair.prompt;
      state.imageFileList[index] = replacement;
      state.imagePromptPairs[index] = {
        key: getImageFileKey(replacement),
        file: replacement,
        prompt: currentPrompt,
      };
      renderImagePromptPairs(true);
      logMessage(
        i18n("log_image_row_replaced", {
          index: index + 1,
          filename: replacement.name,
        }),
        "info",
      );
    });

    const copy = document.createElement("div");
    copy.className = "image-prompt-copy";

    const filename = document.createElement("div");
    filename.className = "image-prompt-file";
    filename.textContent = pair.file.name;
    filename.title = pair.file.name;

    const promptInput = document.createElement("textarea");
    promptInput.className = "image-prompt-input";
    promptInput.value = pair.prompt;
    promptInput.placeholder = i18n("image_row_prompt_placeholder", {
      filename: pair.file.name,
    });
    promptInput.dataset.pairKey = pair.key;
    promptInput.addEventListener("input", () => {
      const draft = state.imagePromptPairs.find(
        (candidate) => candidate.key === promptInput.dataset.pairKey,
      );
      if (!draft) return;
      draft.prompt = promptInput.value;
      dom.promptsTextarea.value = state.imagePromptPairs
        .map((candidate) => candidate.prompt.trim())
        .join("\n\n");
      chrome.storage.local.set({ prompts: dom.promptsTextarea.value });
    });

    copy.append(filename, promptInput);
    row.append(rowIndex, imagePicker, copy, replacementInput);
    dom.imagePromptPairsContainer.appendChild(row);
  });
  dom.imagePromptPairsContainer.style.display = "block";
}

function activateTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.getAttribute("data-tab") === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document
    .querySelectorAll(".tab-pane.active")
    .forEach((pane) => pane.classList.remove("active"));
  const pane =
    tabName === "queue"
      ? dom.queueModalOverlay
      : document.getElementById(`content-${tabName}`);
  pane?.classList.add("active");
  if (tabName === "queue") updateQueueModal();
}

/**
 * The main button is start / pause / resume depending on run state. When idle
 * it does not start directly — it reveals the new-project vs current-project
 * choice, and those buttons call startWithProjectChoice().
 */
function handleMainAction() {
  if (
    !dom.mainActionButton ||
    !dom.startNewProjectButton ||
    !dom.startCurrentProjectButton
  ) {
    return;
  }

  const hasPendingJob = state.masterQueue.some(
    (job) => job.status === "pending",
  );
  if (!((state.masterQueue.length !== 0 && hasPendingJob) || state.isRunning)) {
    return;
  }

  if (!state.isRunning) {
    dom.mainActionButton.style.display = "none";
    dom.startNewProjectButton.style.display = "flex";
    dom.startCurrentProjectButton.style.display = "flex";
    return;
  }

  state.isPaused = !state.isPaused;
  updateMainButton();
  if (state.isPaused) {
    const pausedAt =
      (state.masterQueue[state.currentJobIndex] || { taskList: [] })
        .currentIndex || 0;
    updateLiveStatus(i18n("status_paused", { index: pausedAt + 1 }), "warn");
    logMessage(i18n("log_paused"), "warn");
  } else {
    logMessage(i18n("log_resumed"), "info");
    updateLiveStatus(i18n("log_resumed"), "info");
  }
}

function startWithProjectChoice(continueCurrentProject) {
  if (
    !dom.mainActionButton ||
    !dom.startNewProjectButton ||
    !dom.startCurrentProjectButton
  ) {
    return;
  }
  dom.mainActionButton.style.display = "flex";
  dom.startNewProjectButton.style.display = "none";
  dom.startCurrentProjectButton.style.display = "none";
  startQueue(continueCurrentProject);
}

function handleStop() {
  if (!state.isRunning && !state.downloadInterval) return;

  state.stopRequested = true;
  state.isPaused = false;
  logMessage(i18n("log_stop_request"), "warn");

  const hadFinalScan = !!state.finalScanTimerId;
  if (state.finalScanTimerId) {
    clearInterval(state.finalScanTimerId);
    state.finalScanTimerId = null;
  }
  // While the run loop is alive it resets itself once it observes
  // stopRequested; we only reset here when nothing else will.
  if ((hadFinalScan && state.isRunning) || !state.isRunning) {
    resetState(i18n("reset_user_stop"), "warn");
  }
}

function handleModeChange(event) {
  state.currentMode = event.target.value;
  chrome.storage.local.set({ mode: state.currentMode });
  updateUIAfterModeChange();
  renderImagePromptPairs();
}

function logImageSortOrder() {
  const orderLabel =
    dom.imageSortSelector.options[dom.imageSortSelector.selectedIndex].text;
  logMessage(
    i18n("log_images_sorted", {
      count: state.imageFileList.length,
      order: orderLabel,
    }),
    "info",
  );
}

function handleImageSelection(event) {
  state.imageFileList = Array.from(event.target.files);
  sortImageFiles(dom.imageSortSelector.value);
  state.imagePromptPairs = [];
  renderImagePromptPairs(false);
  dom.imageCount.textContent = state.imageFileList.length;
  dom.imageFileSummary.style.display = "block";
  logImageSortOrder();
}

function handleImageSortChange(event) {
  chrome.storage.local.set({ imageSort: event.target.value });
  sortImageFiles(event.target.value);
  renderImagePromptPairs();
  logImageSortOrder();
}

function handlePromptFileUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (readEvent) => {
      if (!dom.promptsTextarea) return;
      const existing = dom.promptsTextarea.value.trim();
      const imported = readEvent.target.result.trim();
      dom.promptsTextarea.value = existing
        ? `${existing}\n\n${imported}`
        : imported;
      chrome.storage.local.set({ prompts: dom.promptsTextarea.value });
      renderImagePromptPairs(false);
    };
    reader.onerror = (errorEvent) =>
      logMessage(
        i18n("log_txt_read_error", { error: errorEvent.target.error }),
        "error",
      );
    reader.readAsText(file);
  }
  event.target.value = null;
}

async function focusOrOpenFlowTab() {
  try {
    const tabs = await chrome.tabs.query({ url: "*://*/*tools/flow*" });
    const target =
      tabs.find((tab) => tab.url?.includes("/project")) ||
      tabs.find((tab) => tab.url?.includes("/tools/flow"));
    if (target) {
      await chrome.tabs.update(target.id, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow" });
    }
  } catch {
    logMessage(i18n("log_nav_to_flow_error"), "error");
  }
}

function buildFailureReport() {
  const failedItems = [...state.failedPromptsList].sort((left, right) => {
    const leftJob = Number.isInteger(left.jobIndex)
      ? left.jobIndex
      : Number.MAX_SAFE_INTEGER;
    const rightJob = Number.isInteger(right.jobIndex)
      ? right.jobIndex
      : Number.MAX_SAFE_INTEGER;
    if (leftJob !== rightJob) return leftJob - rightJob;
    return (left.index || 0) - (right.index || 0);
  });

  if (failedItems.length === 0) {
    return { failedItems, text: i18n("report_no_failures") };
  }

  const text = failedItems
    .map((failure) => {
      const itemName =
        typeof failure.item === "string"
          ? i18n("report_text_prompt")
          : failure.item?.name || failure.key || i18n("report_unknown_image");
      const prompt =
        failure.prompt ||
        (typeof failure.item === "string" ? failure.item : "");
      return [
        i18n("report_task_line", { index: failure.index ?? "N/A" }),
        i18n("report_job_line", {
          job: Number.isInteger(failure.jobIndex)
            ? failure.jobIndex + 1
            : "N/A",
        }),
        i18n("report_item_line", { item: itemName }),
        i18n("report_prompt_line", { prompt: prompt || i18n("report_none") }),
        i18n("report_reason_line", {
          reason: failure.reason || i18n("report_unknown_reason"),
        }),
      ].join("\n");
    })
    .join("\n\n");

  return { failedItems, text };
}

async function copyDiagnosticReport() {
  const logs = dom.logDisplay?.innerText?.trim() || i18n("report_no_logs");
  const { failedItems, text: failedReport } = buildFailureReport();
  const manifest = chrome.runtime.getManifest();
  const report = [
    `Coachio Video Flow v${manifest.version}`,
    i18n("report_copied_at", { time: new Date().toLocaleString() }),
    i18n("report_project", {
      id: state.currentProjectId || i18n("report_unknown_project"),
    }),
    "",
    i18n("report_all_logs_header"),
    logs,
    "",
    i18n("report_failures_header", { count: failedItems.length }),
    failedReport,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(report);
    updateLiveStatus(i18n("status_copy_success"), "success");
  } catch {
    updateLiveStatus(i18n("status_copy_fail"), "error");
  }
}

export function handleTabRemoval(tabId) {
  if (
    tabId === state.flowTabId &&
    (state.isRunning || state.downloadInterval)
  ) {
    resetState(i18n("error_tab_closed"), "error");
  }
}

function handleAutoDownloadToggle() {
  chrome.storage.local.set({
    autoDownload: dom.autoDownloadCheckbox.checked,
  });
  if (
    !dom.autoDownloadCheckbox.checked &&
    state.downloadInterval &&
    !state.isRunning
  ) {
    stopScanner();
  }
  updateButtonStates();
}

function resetCreateForm() {
  dom.promptsTextarea.value = "";
  state.imageFileList = [];
  state.imagePromptPairs = [];
  dom.imageInput.value = null;
  dom.imageCount.textContent = "0";
  dom.imageFileSummary.style.display = "none";
  if (dom.imagePromptPairsContainer) {
    dom.imagePromptPairsContainer.innerHTML = "";
    dom.imagePromptPairsContainer.style.display = "none";
  }
  chrome.storage.local.set({ prompts: "" });
}

async function addJobToQueue() {
  const mode = dom.modeSelector.value;
  const textPrompts = parsePrompts(dom.promptsTextarea.value);
  const images = [...state.imageFileList];

  const downloadFolder =
    dom.jobDownloadFolderInput.value.trim() || i18n("job_folder_default");
  dom.jobDownloadFolderInput.value = downloadFolder;

  if (mode === "text-to-video" && textPrompts.length === 0) {
    logMessage(i18n("log_queue_job_add_fail_prompt"), "error");
    updateLiveStatus(i18n("log_queue_job_add_fail_prompt"), "error");
    return;
  }

  let imagePrompts = [];
  let savedImages = [];
  let framePairs = null;
  const frameMode =
    mode === "image-to-video" ? currentFrameMode() : "single";
  let usableImages = images;

  if (mode === "image-to-video") {
    if (images.length === 0) {
      logMessage(i18n("log_queue_job_add_fail_image"), "error");
      updateLiveStatus(i18n("log_queue_job_add_fail_image"), "error");
      return;
    }
    if (isFramePairMode(frameMode) && images.length < 2) {
      logMessage(i18n("log_queue_job_add_fail_frame_images"), "error");
      updateLiveStatus(i18n("log_queue_job_add_fail_frame_images"), "error");
      return;
    }

    renderImagePromptPairs();
    const expectedTransitions = countTransitions(images.length, frameMode);
    imagePrompts = state.imagePromptPairs.map((pair) => pair.prompt.trim());
    if (
      imagePrompts.length !== expectedTransitions ||
      imagePrompts.some((prompt) => !prompt)
    ) {
      logMessage(i18n("log_queue_add_fail_missing_prompt"), "error");
      updateLiveStatus(i18n("status_queue_add_fail_missing_prompt"), "error");
      return;
    }

    // Discrete mode with an odd count leaves a trailing image in no pair.
    // Drop it before saving so it never becomes an orphaned blob.
    const usedImageCount = state.imagePromptPairs.reduce(
      (highest, pair) =>
        Math.max(highest, pair.firstIndex, pair.lastIndex ?? pair.firstIndex),
      -1,
    );
    usableImages = images.slice(0, usedImageCount + 1);
    if (usableImages.length < images.length) {
      logMessage(
        i18n("filmstrip_warn_odd_image", {
          count: images.length - usableImages.length,
        }),
        "warn",
      );
    }
    framePairs = state.imagePromptPairs.map((pair) => ({
      first: pair.firstIndex,
      last: pair.lastIndex,
    }));

    try {
      for (const image of usableImages) {
        savedImages.push(await saveImage(image));
      }
    } catch (error) {
      logMessage(i18n("log_db_save_error", { error: error.message }), "error");
      updateLiveStatus(
        i18n("status_db_save_error", { error: error.message }),
        "error",
      );
      return;
    }

    if (savedImages.length === 0 && usableImages.length > 0) {
      logMessage(i18n("log_db_read_all_fail"), "error");
      updateLiveStatus(i18n("status_db_read_all_fail"), "error");
      return;
    }
  }

  const job = {
    id: Date.now().toString(),
    mode,
    frameMode,
    // Indices into job.images, not ids: immune to id churn and trivially
    // validated. job.images stays a flat de-duplicated list so a chained
    // middle image is stored once and deleted once.
    framePairs,
    prompts: mode === "image-to-video" ? imagePrompts : textPrompts,
    images: savedImages,
    downloadFolder,
    downloadSaveMode: dom.downloadSaveModeSelector.value,
    repeatCount: dom.repeatCountInput.value,
    model: dom.modelSelector.value,
    duration: dom.omniDurationSelector?.value === "6s" ? "6s" : "4s",
    aspectRatio: dom.aspectRatioSelector.value,
    startFrom: parseInt(dom.startFromInput.value, 10) || 1,
    status: "pending",
    progress: {
      completed: 0,
      total:
        mode === "image-to-video" ? imagePrompts.length : textPrompts.length,
    },
    currentIndex: 0,
  };

  state.masterQueue.push(job);
  chrome.storage.local.set({ masterQueue: state.masterQueue });
  logMessage(
    i18n("log_queue_job_added", { count: state.masterQueue.length }),
    "success",
  );
  updateQueueModal();

  resetCreateForm();
  state.nextProjectCounter++;
  chrome.storage.local.set({ nextProjectCounter: state.nextProjectCounter });
  const counter = state.nextProjectCounter.toString().padStart(2, "0");
  dom.jobDownloadFolderInput.value = `${i18n("job_folder_prefix")}${counter}`;
}

function openQueueTab() {
  activateTab("queue");
}

function closeQueueTab() {
  activateTab("control");
}

function handleQueueFolderChange(event) {
  if (!event.target.classList.contains("queue-folder-input")) return;
  const jobId = event.target.dataset.jobId;
  const folder = event.target.value.trim();
  const job = state.masterQueue.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "pending") return;

  job.downloadFolder = folder;
  event.target.value = folder;
  chrome.storage.local.set({ masterQueue: state.masterQueue });
}

async function handleQueueListClick(event) {
  const resetButton = event.target.closest(".queue-reset-job");
  if (resetButton) {
    const jobId = resetButton.closest("tr").dataset.jobId;
    const job = state.masterQueue.find((candidate) => candidate.id === jobId);
    if (!job || job.status === "pending" || job.status === "running") return;
    job.status = "pending";
    job.progress.completed = 0;
    job.currentIndex = 0;
    chrome.storage.local.set({ masterQueue: state.masterQueue });
    updateQueueModal();
    return;
  }

  const deleteButton = event.target.closest(".queue-delete-job");
  if (!deleteButton) return;

  const jobId = deleteButton.closest("tr").dataset.jobId;
  const jobIndex = state.masterQueue.findIndex(
    (candidate) => candidate.id === jobId,
  );
  if (jobIndex === -1) return;

  const job = state.masterQueue[jobIndex];
  if (job.status === "running") {
    logMessage(i18n("log_queue_delete_fail_running"), "error");
    return;
  }
  if (job.mode === "image-to-video" && job.images) {
    try {
      for (const image of job.images) await deleteImage(image.id);
    } catch (error) {
      logMessage(
        i18n("log_db_delete_error", { error: error.message }),
        "error",
      );
    }
  }

  state.masterQueue.splice(jobIndex, 1);
  chrome.storage.local.set({ masterQueue: state.masterQueue });
  updateQueueModal();
  logMessage(i18n("log_queue_job_deleted", { index: jobIndex + 1 }), "warn");
}

function openClearQueueConfirm() {
  if (state.isRunning || !dom.confirmClearQueueModal) return;
  dom.confirmClearQueueModal.style.display = "flex";
}

function resetFinishedJobs() {
  if (state.isRunning) return;

  let changed = false;
  state.masterQueue.forEach((job) => {
    if (job.status !== "done" && job.status !== "failed") return;
    job.status = "pending";
    job.progress.completed = 0;
    job.currentIndex = 0;
    changed = true;
  });
  if (!changed) return;

  chrome.storage.local.set({ masterQueue: state.masterQueue });
  updateQueueModal();
}

function confirmClearQueue() {
  if (state.isRunning) return;
  if (dom.confirmClearQueueModal) {
    dom.confirmClearQueueModal.style.display = "none";
  }
  state.masterQueue = [];
  chrome.storage.local.set({ masterQueue: [] }, () => {
    clearAllImages().then(() => {
      logMessage(i18n("log_queue_cleared"), "warn");
      updateQueueModal();
    });
  });
}

function cancelClearQueue() {
  if (dom.confirmClearQueueModal) {
    dom.confirmClearQueueModal.style.display = "none";
  }
}

function persistOnEvent(storageKey, readValue) {
  return (event) =>
    chrome.storage.local.set({ [storageKey]: readValue(event) });
}

const fromTarget = (event) => event.target.value;

export function attachEventListeners() {
  try {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        activateTab(button.getAttribute("data-tab"));
      });
    });

    dom.mainActionButton.addEventListener("click", handleMainAction);
    dom.startNewProjectButton.addEventListener("click", () =>
      startWithProjectChoice(false),
    );
    dom.startCurrentProjectButton.addEventListener("click", () =>
      startWithProjectChoice(true),
    );
    dom.stopButton.addEventListener("click", handleStop);

    dom.promptsTextarea.addEventListener("input", () => {
      chrome.storage.local.set({ prompts: dom.promptsTextarea.value });
      renderImagePromptPairs(false);
    });
    dom.startFromInput.addEventListener(
      "input",
      persistOnEvent("startFrom", () => dom.startFromInput.value),
    );
    dom.repeatCountInput.addEventListener(
      "change",
      persistOnEvent("videoCount", fromTarget),
    );
    dom.minInitialWaitTimeInput.addEventListener(
      "input",
      persistOnEvent("minInitialWait", () => dom.minInitialWaitTimeInput.value),
    );
    dom.maxInitialWaitTimeInput.addEventListener(
      "input",
      persistOnEvent("maxInitialWait", () => dom.maxInitialWaitTimeInput.value),
    );

    dom.languageSelector.addEventListener("change", (event) =>
      setLanguage(event.target.value),
    );
    dom.autoDownloadCheckbox.addEventListener(
      "change",
      handleAutoDownloadToggle,
    );
    dom.downloadSaveModeSelector.addEventListener(
      "change",
      persistOnEvent("downloadSaveMode", fromTarget),
    );
    dom.modeSelector.addEventListener("change", handleModeChange);
    dom.aspectRatioSelector.addEventListener(
      "change",
      persistOnEvent("aspectRatio", fromTarget),
    );
    dom.modelSelector.addEventListener("change", (event) => {
      chrome.storage.local.set({ model: event.target.value });
      updateModelSpecificSettings();
    });
    dom.omniDurationSelector?.addEventListener(
      "change",
      persistOnEvent("omniDuration", fromTarget),
    );

    dom.uploadImageButton.addEventListener("click", () =>
      dom.imageInput.click(),
    );
    dom.imageInput.addEventListener("change", handleImageSelection);
    dom.imageSortSelector.addEventListener("change", handleImageSortChange);
    dom.uploadPromptButton.addEventListener("click", () =>
      dom.fileInput.click(),
    );
    dom.fileInput.addEventListener("change", handlePromptFileUpload);
    dom.navigateToFlowButton.addEventListener("click", focusOrOpenFlowTab);
    dom.copyFailedButton.addEventListener("click", copyDiagnosticReport);
    dom.openDownloadsSettingsLink.addEventListener("click", (event) => {
      event.preventDefault();
      try {
        chrome.runtime.sendMessage({ type: "openDownloadsSettings" });
      } catch {
        logMessage(i18n("log_open_settings_fail"), "error");
      }
    });

    dom.addToQueueButton.addEventListener("click", addJobToQueue);
    dom.openQueueButton.addEventListener("click", openQueueTab);
    dom.clearQueueButton.addEventListener("click", openClearQueueConfirm);
    dom.closeQueueModal.addEventListener("click", closeQueueTab);
    dom.queueListDisplay.addEventListener("click", handleQueueListClick);
    dom.queueListDisplay.addEventListener("change", handleQueueFolderChange);
    dom.confirmClearQueueButton.addEventListener("click", confirmClearQueue);
    dom.cancelClearQueueButton.addEventListener("click", cancelClearQueue);
    dom.queueResetAllButton.addEventListener("click", resetFinishedJobs);
    dom.queueDeleteAllButton.addEventListener("click", openClearQueueConfirm);
  } catch (error) {
    logMessage(
      i18n("log_event_listener_error", { error: error.message }),
      "error",
    );
  }
}

export function attachChromeListeners() {
  chrome.tabs.onActivated.addListener(updateInterfaceVisibility);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (
        tabs?.length > 0 &&
        tabId === tabs[0].id &&
        (changeInfo.status || changeInfo.url)
      ) {
        updateInterfaceVisibility();
      }
    });
  });
  chrome.tabs.onRemoved.addListener(handleTabRemoval);
}
