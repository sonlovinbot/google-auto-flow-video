import { dom } from "./dom.js";
import { state } from "./state.js";
import { i18n } from "./i18n.js";

const LOG_LEVEL_ICONS = {
  system: "🔵",
  success: "🟢",
  warn: "🟡",
  error: "🔴",
  info: "⚪️",
  CRITICAL: "🔴",
};

export async function updateInterfaceVisibility() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = tab?.url || "";
    const onFlowPage = url.startsWith("https://labs.google/fx/");

    dom.mainInterface.style.display = onFlowPage ? "flex" : "none";
    dom.wrongPageInterface.style.display = onFlowPage ? "none" : "flex";
    if (dom.wrongPageMessageElement && !onFlowPage) {
      dom.wrongPageMessageElement.innerHTML = i18n("wrong_page_message");
    }
  } catch {
    dom.mainInterface.style.display = "none";
    dom.wrongPageInterface.style.display = "flex";
    if (dom.wrongPageMessageElement) {
      dom.wrongPageMessageElement.innerHTML = i18n("wrong_page_message");
    }
  }
}

export function updateButtonStates() {
  const busy =
    state.isRunning || !!state.downloadInterval || !!state.finalScanTimerId;
  const hasPendingJob = state.masterQueue.some(
    (job) => job.status === "pending",
  );

  dom.mainActionButton.disabled =
    (!state.isRunning && !!state.finalScanTimerId) ||
    (state.masterQueue.length === 0 && !state.isRunning) ||
    (!hasPendingJob && !state.isRunning);
  updateMainButton();

  dom.stopButton.disabled = !busy;
  dom.clearQueueButton.disabled = busy || state.masterQueue.length === 0;

  if (dom.queueResetAllButton) {
    const hasResettableJob = state.masterQueue.some(
      (job) => job.status === "done" || job.status === "failed",
    );
    dom.queueResetAllButton.disabled = busy || !hasResettableJob;
  }
  if (dom.queueDeleteAllButton) {
    dom.queueDeleteAllButton.disabled = busy || state.masterQueue.length === 0;
  }
  if (!state.isRunning) updateUIAfterModeChange();
}

export function updateMainButton() {
  const icon = dom.mainActionButton.querySelector(".material-symbols-outlined");
  const label = dom.mainActionButton.querySelector("span:last-child");
  if (!icon || !label) return;

  if (!state.isRunning) {
    icon.textContent = "play_arrow";
    label.textContent = i18n("start_button");
    dom.mainActionButton.title = i18n("start_button_title");
    return;
  }
  if (state.isPaused) {
    icon.textContent = "play_arrow";
    label.textContent = i18n("continue_button");
    dom.mainActionButton.title = i18n("continue_button_title");
    return;
  }
  icon.textContent = "pause";
  label.textContent = i18n("pause_button");
  dom.mainActionButton.title = i18n("pause_button_title");
}

export function updateFailedPromptsUI() {
  dom.failedPromptsDisplay.innerHTML = "";

  state.failedPromptsList
    .sort((a, b) => {
      if (a.index != null && b.index != null) return a.index - b.index;
      if (a.index != null) return -1;
      if (b.index != null) return 1;
      return 0;
    })
    .forEach((failure) => {
      const row = document.createElement("div");
      row.textContent = failure.key;
      row.title = i18n("failed_prompt_row_title", {
        index: failure.index || "N/A",
        key: failure.key,
        reason: failure.reason,
      });
      dom.failedPromptsDisplay.appendChild(row);
    });

  dom.failedSummary.textContent = i18n("failed_prompts_summary", {
    count: state.failedPromptsList.length,
  });
}

export function updateProgressBar(
  completedInJob,
  totalInJob,
  completedJobs = 0,
  totalJobs = 0,
) {
  if (!dom.progressBar) return;

  let percent = 0;
  if (totalJobs > 0) {
    const perJob = 100 / totalJobs;
    percent =
      completedJobs * perJob +
      (totalInJob > 0 ? completedInJob / totalInJob : 0) * perJob;
  } else if (totalInJob > 0) {
    percent = (completedInJob / totalInJob) * 100;
  }
  dom.progressBar.value = percent;
}

export function updateLiveStatus(message, level = "info") {
  if (!dom.liveStatus) return;

  dom.liveStatus.dataset.status = String(level || "info").toLowerCase();
  dom.liveStatus.style.color = "";

  const showJobPrefix =
    state.isRunning &&
    state.masterQueue.length > 0 &&
    state.currentJobIndex < state.masterQueue.length &&
    state.masterQueue[state.currentJobIndex];

  dom.liveStatus.textContent = showJobPrefix
    ? `[Job ${state.currentJobIndex + 1}/${state.masterQueue.length}] ${message}`
    : message;
}

export function logMessage(message, level = "info") {
  if (!dom.logDisplay) return;

  const row = document.createElement("div");
  const safeMessage = String(message).replace(/<|>/g, "&lt;");
  const timestamp = new Date().toLocaleTimeString("vi-VN");
  const icon = LOG_LEVEL_ICONS[level] || LOG_LEVEL_ICONS.info;

  row.innerHTML =
    `<span style="color: #9aa0a6; margin-right: 5px;">${timestamp}</span> ` +
    `${icon} ${safeMessage}`;
  dom.logDisplay.appendChild(row);
  dom.logDisplay.scrollTop = dom.logDisplay.scrollHeight;
}

export function updateUIAfterModeChange() {
  const imageMode = state.currentMode === "image-to-video";
  dom.imageModeContainer.style.display = imageMode ? "block" : "none";
  dom.promptListTitle.textContent = i18n(
    imageMode ? "prompt_list_for_images" : "prompt_list",
  );
  dom.promptsTextarea.placeholder = i18n("prompt_placeholder");
  dom.aspectRatioSelector.disabled = false;
}

export function updateModelSpecificSettings() {
  const showOmniDuration = dom.modelSelector?.value === "omni_flash";
  if (dom.omniDurationLabel) {
    dom.omniDurationLabel.style.display = showOmniDuration ? "" : "none";
  }
  if (dom.omniDurationSelector) {
    dom.omniDurationSelector.style.display = showOmniDuration ? "" : "none";
    dom.omniDurationSelector.disabled = !showOmniDuration;
  }
}

function jobStatusLabel(job) {
  switch (job.status) {
    case "pending":
      return i18n("job_status_pending");
    case "running":
      return `${i18n("job_status_running")} (${job.progress.completed}/${job.progress.total})`;
    case "downloading":
      return i18n("job_status_downloading", {
        completed: job.progress.completed,
        total: job.progress.total,
      });
    case "done":
      return i18n("job_status_done");
    case "failed":
      return i18n("job_status_failed");
    default:
      return job.status;
  }
}

function buildQueueRow(job, position) {
  const row = document.createElement("tr");
  row.dataset.jobId = job.id;

  const imageMode = job.mode === "image-to-video";
  const summary = imageMode
    ? i18n("job_summary_image", { count: job.images.length })
    : i18n("job_summary_text", { count: job.prompts.length });
  const modeLabel = i18n(imageMode ? "mode_image" : "mode_text");
  const isPending = job.status === "pending";
  const isActive = job.status === "running" || job.status === "downloading";

  const positionCell = document.createElement("td");
  positionCell.textContent = position;
  row.appendChild(positionCell);

  const summaryCell = document.createElement("td");
  summaryCell.innerHTML =
    `<div class="queue-job-desc">${summary}</div>` +
    `<div class="queue-job-mode">${modeLabel}</div>`;
  row.appendChild(summaryCell);

  const folderCell = document.createElement("td");
  if (isPending) {
    const folderInput = document.createElement("input");
    folderInput.type = "text";
    folderInput.className = "queue-folder-input";
    folderInput.value = job.downloadFolder;
    folderInput.dataset.jobId = job.id;
    folderInput.title = i18n("queue_edit_folder_title");
    folderCell.appendChild(folderInput);
  } else {
    folderCell.textContent = job.downloadFolder;
  }
  row.appendChild(folderCell);

  const statusCell = document.createElement("td");
  statusCell.textContent = jobStatusLabel(job);
  row.appendChild(statusCell);

  const actionsCell = document.createElement("td");
  actionsCell.innerHTML =
    `<button class="queue-job-button queue-reset-job" title="${i18n("queue_reset_job_title")}" data-job-id="${job.id}" ${isPending || isActive ? "disabled" : ""}>` +
    `<span class="material-symbols-outlined">restart_alt</span></button>` +
    `<button class="queue-job-button queue-delete-job" title="${i18n("queue_delete_job_title")}" data-job-id="${job.id}" ${isActive ? "disabled" : ""}>` +
    `<span class="material-symbols-outlined">delete</span></button>`;
  row.appendChild(actionsCell);

  return row;
}

export function updateQueueModal() {
  if (!dom.queueTableBody || !dom.queueListDisplay) return;
  dom.queueTableBody.innerHTML = "";

  const table = dom.queueTableBody.parentElement;
  const emptyMessage = dom.queueListDisplay.querySelector(
    ".queue-list-empty-message",
  );

  if (state.masterQueue.length === 0) {
    table.classList.add("empty-queue");
    if (emptyMessage) emptyMessage.style.display = "block";
  } else {
    table.classList.remove("empty-queue");
    if (emptyMessage) emptyMessage.style.display = "none";
    state.masterQueue.forEach((job, index) => {
      dom.queueTableBody.appendChild(buildQueueRow(job, index + 1));
    });
  }

  if (dom.queueTaskCount) {
    dom.queueTaskCount.textContent = state.masterQueue.length;
  }
  if (dom.queueResetAllButton) {
    const hasResettableJob = state.masterQueue.some(
      (job) => job.status === "done" || job.status === "failed",
    );
    dom.queueResetAllButton.disabled = state.isRunning || !hasResettableJob;
  }
  if (dom.queueDeleteAllButton) {
    dom.queueDeleteAllButton.disabled =
      state.isRunning || state.masterQueue.length === 0;
  }
  updateButtonStates();
}
