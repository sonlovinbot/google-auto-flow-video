import { dom } from "./dom.js";
import { state } from "./state.js";
import { logMessage } from "./ui.js";
import { i18n } from "./i18n.js";
import {
  injectScript,
  findAndGroupNewVideos,
  getFlowVideoCardSource,
  inspectVideoDiscovery,
} from "./injector.js";
import { interruptibleSleep } from "./utils.js";
import { isTabGoneError } from "./chrome-errors.js";

function normalizePrompt(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function normalizeDownloadSaveMode(value) {
  return value === "ask" ? "ask" : "auto";
}

export function sanitizeDownloadFolder(value) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/^\.+/g, "")
    .replace(/[.\s]+$/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "Flow Downloads";
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned.slice(0, 120);
}

export function buildDownloadPath(folder, filename) {
  const safeFolder = sanitizeDownloadFolder(folder);
  const safeFilename = String(filename || "video.mp4")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/[.\s]+$/g, "")
    .trim();
  return `${safeFolder}/${safeFilename || "video.mp4"}`;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message || "Runtime message failed.",
        });
        return;
      }
      resolve(response || { success: false, error: "No response." });
    });
  });
}

function countActiveDownloadsForTask(task) {
  return Array.from(state.activeDownloads.values()).filter(
    (download) => download.task === task,
  ).length;
}

async function verifyActiveDownloads() {
  for (const [captureToken, download] of state.activeDownloads.entries()) {
    const response = await sendRuntimeMessage({
      type: "getFlowDownloadCapture",
      token: captureToken,
    });
    if (
      response?.success &&
      (response.state === "waiting" || response.state === "in_progress")
    ) {
      if (
        response.state === "in_progress" &&
        !download.downloadDetectedLogged
      ) {
        download.downloadDetectedLogged = true;
        logMessage(
          i18n("log_download_started", { downloadId: response.downloadId }),
          "info",
        );
      }
      continue;
    }

    state.activeDownloads.delete(captureToken);
    await sendRuntimeMessage({
      type: "cancelFlowDownloadCapture",
      token: captureToken,
    });
    if (response?.success && response.state === "complete") {
      const capturedName = String(
        response.filename || response.originalFilename || "",
      );
      const capturedMime = String(response.mime || "").toLowerCase();
      const isVideo =
        capturedMime.startsWith("video/") ||
        /\.(?:mp4|webm|mov|m4v)$/i.test(capturedName);
      if (!isVideo) {
        state.downloadedVideoUrls.delete(download.cardId);
        download.task.downloadFailureCount =
          (download.task.downloadFailureCount || 0) + 1;
        logMessage(
          i18n("log_download_not_video", {
            mime: capturedMime || i18n("label_unknown_mime"),
            filename: capturedName || i18n("label_unknown_filename"),
          }),
          "error",
        );
        if (download.task.downloadFailureCount >= 3) {
          download.task.status = "failed";
          logMessage(
            i18n("log_task_stopped_wrong_type", { index: download.task.index }),
            "error",
          );
        }
        continue;
      }
      download.task.foundVideos += 1;
      state.newlyDownloadedCount += 1;
      logMessage(
        i18n("log_download_verified", { path: download.path }),
        "success",
      );
      if (download.task.foundVideos >= download.task.expectedVideos) {
        download.task.status = "complete";
        logMessage(
          i18n("log_task_complete", { index: download.task.index }),
          "success",
        );
      }
      continue;
    }

    state.downloadedVideoUrls.delete(download.cardId);
    download.task.downloadFailureCount =
      (download.task.downloadFailureCount || 0) + 1;
    const reason =
      response?.error ||
      response?.state ||
      i18n("log_download_state_unknown");
    logMessage(
      i18n("log_download_failed", {
        path: download.path,
        attempt: download.task.downloadFailureCount,
        reason,
      }),
      "error",
    );
    if (download.task.downloadFailureCount >= 3) {
      download.task.status = "failed";
      logMessage(
        i18n("log_task_stopped_download_failed", { index: download.task.index }),
        "error",
      );
    }
  }
}

function findPendingTask(prompt) {
  const normalized = normalizePrompt(prompt);
  const pending = state.masterTaskList.filter(
    (task) => task.status === "pending" && Number(task.submittedAt) > 0,
  );

  const exact = pending.find(
    (task) => normalizePrompt(task.prompt) === normalized,
  );
  if (exact) return exact;

  const contained = pending.find((task) => {
    const expected = normalizePrompt(task.prompt);
    return (
      expected &&
      normalized &&
      (normalized.includes(expected) || expected.includes(normalized))
    );
  });
  if (contained) return contained;

  // Flow's current card can temporarily omit/truncate prompt text while the
  // video is rendering. Queue order is the safest fallback for new assets.
  return pending[0] || null;
}

async function scanUnlocked() {
  if (!dom.autoDownloadCheckbox.checked || !state.flowTabId) return;

  await verifyActiveDownloads();

  const hasPending = state.masterTaskList.some(
    (task) => task.status === "pending",
  );
  if (
    !hasPending &&
    state.activeDownloads.size === 0 &&
    !state.finalScanTimerId &&
    !state.isRunning
  ) {
    return;
  }

  let groups;
  try {
    state.videoScanAttemptCount += 1;
    state.lastVideoScanAt = Date.now();
    groups = await injectScript(findAndGroupNewVideos, [
      Array.from(state.downloadedVideoUrls),
    ]);
  } catch (error) {
    if (isTabGoneError(error)) {
      if (!state.stopRequested) {
        logMessage(i18n("error_tab_closed"), "error");
      }
      stopScanner();
    } else if (!state.stopRequested) {
      logMessage(i18n("log_scan_error", { error: error.message }), "error");
    }
    return;
  }

  if (!Array.isArray(groups) || groups.length === 0) {
    const now = Date.now();
    if (
      state.finalScanTimerId &&
      now - state.lastEmptyVideoScanLogAt >= 30000
    ) {
      state.lastEmptyVideoScanLogAt = now;
      const diagnostics = await injectScript(inspectVideoDiscovery);
      state.lastVideoScanDiagnostics = diagnostics || null;
      logMessage(
        i18n("log_scan_no_ready_video", {
          dom: JSON.stringify(diagnostics || {}),
        }),
        "warn",
      );
    }
    return;
  }

  for (const group of groups) {
    const task = findPendingTask(group.prompt);
    if (!task) continue;

    const job = state.masterQueue.find(
      (candidate) => candidate.id === task.jobId,
    );
    if (!job) continue;

    const newVideos = group.videos.filter(
      (cardId) => !state.downloadedVideoUrls.has(String(cardId)),
    );
    if (newVideos.length === 0) continue;

    logMessage(
      i18n("log_scan_found_videos", {
        count: newVideos.length,
        prompt: `${task.prompt.substring(0, 30)}...`,
      }),
      "info",
    );

    const suffixes = "abcdefghijklmnopqrstuvwxyz";
    for (const cardId of newVideos) {
      if (state.activeDownloads.size > 0) break;
      if (
        task.foundVideos + countActiveDownloadsForTask(task) >=
        task.expectedVideos
      ) {
        break;
      }

      const cardIdentity = String(cardId);
      if (state.downloadedVideoUrls.has(cardIdentity)) continue;

      state.downloadedVideoUrls.add(cardIdentity);

      const videoNumber =
        task.foundVideos + countActiveDownloadsForTask(task) + 1;
      const suffix = suffixes[videoNumber - 1] || String(videoNumber);
      const now = new Date();
      const timestamp =
        `${now.getFullYear()}` +
        `${now.getMonth() + 1}`.padStart(2, "0") +
        `${now.getDate()}`.padStart(2, "0") +
        "_" +
        `${now.getHours()}`.padStart(2, "0") +
        `${now.getMinutes()}`.padStart(2, "0") +
        `${now.getSeconds()}`.padStart(2, "0");
      const filename = `${task.index}.${suffix}. ${timestamp}.mp4`;
      const path = buildDownloadPath(job.downloadFolder, filename);
      const saveMode = normalizeDownloadSaveMode(job.downloadSaveMode);
      logMessage(
        i18n(
          saveMode === "ask"
            ? "log_card_confirmed_save_as"
            : "log_card_confirmed_auto_save",
          { path },
        ),
        "info",
      );

      const sourceResult = await injectScript(getFlowVideoCardSource, [
        cardIdentity,
      ]);
      if (!sourceResult?.ok || !sourceResult.url) {
        const error =
          sourceResult?.message ||
          i18n("log_card_source_missing_url");
        logMessage(
          i18n("log_card_source_fail", {
            cardId: cardIdentity,
            step: sourceResult?.step || "video-source",
            error,
          }),
          "error",
        );
        state.downloadedVideoUrls.delete(cardIdentity);
        task.downloadFailureCount = (task.downloadFailureCount || 0) + 1;
        if (task.downloadFailureCount >= 3) {
          task.status = "failed";
          logMessage(
            i18n("log_task_stopped_no_source", { index: task.index }),
            "error",
          );
        }
        continue;
      }

      const downloadResult = await sendRuntimeMessage({
        type: "downloadFlowVideo",
        url: sourceResult.url,
        filename: path,
        saveAs: saveMode === "ask",
      });
      if (!downloadResult?.success || !downloadResult.token) {
        const error =
          downloadResult?.error ||
          i18n("log_download_start_refused");
        logMessage(i18n("log_card_download_start_fail", { cardId: cardIdentity, error }), "error");
        state.downloadedVideoUrls.delete(cardIdentity);
        task.downloadFailureCount = (task.downloadFailureCount || 0) + 1;
        if (task.downloadFailureCount >= 3) {
          task.status = "failed";
          logMessage(
            i18n("log_task_stopped_chrome_refused", { index: task.index }),
            "error",
          );
        }
        continue;
      }

      state.activeDownloads.set(downloadResult.token, {
        task,
        path,
        cardId: cardIdentity,
        startedAt: Date.now(),
      });
      logMessage(
        i18n("log_download_accepted", {
          cardId: cardIdentity,
          downloadId: downloadResult.downloadId,
        }) +
          (sourceResult.earlyDetection
            ? ` ${i18n("log_download_early_detection")}`
            : "") +
          ` ${i18n("log_download_waiting_file")}`,
        "info",
      );

      await interruptibleSleep(100);
    }
  }
}

async function scan() {
  if (state.scanInFlight) return;
  state.scanInFlight = true;
  try {
    await scanUnlocked();
  } finally {
    state.scanInFlight = false;
  }
}

export function startScanner() {
  stopScanner();
  state.lastEmptyVideoScanLogAt = 0;
  state.videoScanAttemptCount = 0;
  state.lastVideoScanAt = 0;
  state.lastVideoScanDiagnostics = null;
  state.lastDownloadStatusUiAt = 0;
  scan();
  state.downloadInterval = setInterval(
    scan,
    state.hotScanIntervalMs || state.scanIntervalMs,
  );
}

export function stopScanner() {
  if (state.downloadInterval) {
    clearInterval(state.downloadInterval);
    state.downloadInterval = null;
  }
}
