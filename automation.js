import { dom } from "./dom.js";
import { state } from "./state.js";
import {
  logMessage,
  updateLiveStatus,
  updateProgressBar,
  updateButtonStates,
  updateFailedPromptsUI,
  updateQueueModal,
} from "./ui.js";
import { i18n } from "./i18n.js";
import {
  injectScript,
  clickNewProjectButton,
  scanExistingVideos,
  setInitialSettings,
  processImageAndPromptOnPage,
  processPromptOnPage,
  scanForQueueFullPopup,
} from "./injector.js";
import {
  getProjectIdFromUrl,
  readFileAsDataURL,
  getRandomWait,
  pauseIfNeeded,
  interruptibleSleep,
  interruptibleSleepAndScan,
  waitForTabLoad,
} from "./utils.js";
import { startScanner, stopScanner } from "./scanner.js";
import { getImage } from "./db.js";

const FLOW_HOME_URL = "https://labs.google/fx/tools/flow";
const NAVIGATION_TIMEOUT_MS = 60000;

/**
 * Failures at these steps mean Flow rejected an upload or frame selection on a
 * page that is otherwise healthy. Reloading would re-run the composer from
 * scratch and can leave a duplicate submission behind, so they retry in place.
 */
const RETRY_ON_CURRENT_PAGE_CODES = new Set([
  "UPLOAD_FAILED",
  "UPLOAD_NOT_STARTED",
  "UPLOAD_TIMEOUT",
  "FIRST_FRAME_OPTION_MISSING",
  "FIRST_FRAME_CONFIRM_DISABLED",
  "FIRST_FRAME_NOT_ATTACHED",
]);

export function addFailedPrompt(item, reason, taskIndex, jobIndex) {
  const key = `job${jobIndex + 1}_${
    typeof item === "string" ? item : item.name || "unknown file"
  }`;
  if (state.failedPromptsList.some((failure) => failure.key === key)) return;

  const job = state.masterQueue[jobIndex];
  const task = job
    ? state.masterTaskList.find(
        (candidate) =>
          candidate.jobId === job.id && candidate.index === taskIndex,
      )
    : null;

  state.failedPromptsList.push({
    key,
    item,
    reason,
    index: taskIndex,
    jobIndex,
    prompt: task?.prompt || (typeof item === "string" ? item : ""),
  });
  updateFailedPromptsUI();
  if (task) task.status = "failed";
}

function logTrace(trace, ok, prefix) {
  if (!trace?.length) return;
  for (const [index, entry] of trace.entries()) {
    const detail =
      entry.details === undefined ? "" : ` | ${JSON.stringify(entry.details)}`;
    const isLastEntry = index === trace.length - 1;
    logMessage(
      `[${prefix} +${entry.elapsedMs}ms] ${entry.step}: ${entry.message}${detail}`,
      ok || !isLastEntry ? "info" : "error",
    );
  }
}

export async function applyPageSettings(job) {
  // Flow now renders the composer immediately. A short settle window is
  // enough; the injected settings routine waits for each concrete control.
  await interruptibleSleep(200);

  const hasSubmittedPendingTask = state.masterTaskList.some(
    (task) =>
      task.jobId === job.id &&
      task.status === "pending" &&
      Number(task.submittedAt) > 0,
  );
  if (hasSubmittedPendingTask) {
    // Baselining here would mark videos from the already-submitted task as
    // pre-existing and they would never be downloaded.
    logMessage(i18n("log_skip_baseline_after_reload"), "info");
  } else {
    await baselineExistingVideos();
  }

  const settingsResult = await injectScript(setInitialSettings, [
    job.repeatCount || "1",
    job.model || "omni_flash",
    job.aspectRatio || "portrait",
    job.duration || "4s",
  ]);
  logTrace(settingsResult?.trace, settingsResult?.ok, "Flow settings");

  if (!settingsResult?.ok) {
    const failure = settingsResult
      ? `${settingsResult.step}: ${settingsResult.message}`
      : i18n("log_settings_no_result");
    const diagnostics = settingsResult?.diagnostics
      ? ` | DOM=${JSON.stringify(settingsResult.diagnostics)}`
      : "";
    const message = i18n("log_settings_step_fail", {
      failure,
      diagnostics,
    });
    logMessage(message, "error");
    updateLiveStatus(message, "error");
    logMessage(i18n("log_settings_fail"), "error");
    return false;
  }

  logMessage(i18n("log_settings_applied"), "info");
  return true;
}

/** Records the cards already on the page so they are never re-downloaded. */
async function baselineExistingVideos() {
  try {
    const existing = await injectScript(scanExistingVideos);
    if (!Array.isArray(existing) || existing.length === 0) return;
    existing.forEach((cardId) => state.downloadedVideoUrls.add(cardId));
    logMessage(
      i18n("log_initial_scan_found", { count: existing.length }),
      "info",
    );
  } catch {
    logMessage(i18n("log_scan_existing_fail"), "warn");
  }
}

export async function startQueue(continueCurrentProject = false) {
  // Clear leftover timers first: a previous run may still be watching for
  // downloads even when nothing is pending any more.
  if (state.zoomResetTimerId) {
    clearTimeout(state.zoomResetTimerId);
    state.zoomResetTimerId = null;
  }
  if (state.finalScanTimerId) {
    clearInterval(state.finalScanTimerId);
    state.finalScanTimerId = null;
  }

  const firstPendingIndex = state.masterQueue.findIndex(
    (job) => job.status === "pending",
  );
  if (firstPendingIndex === -1) {
    logMessage(i18n("log_no_pending_jobs"), "warn");
    return;
  }

  try {
    if (Object.keys(state.selectors).length === 0) {
      throw new Error(i18n("log_load_selectors_fail"));
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error(i18n("log_no_active_tab"));

    state.flowTabId = tab.id;
    state.isRunning = true;
    state.stopRequested = false;
    state.isPaused = false;
    state.currentJobIndex = firstPendingIndex;
    state.failedPromptsList = [];
    state.masterTaskList = [];
    updateButtonStates();
    updateFailedPromptsUI();
    dom.logDisplay.innerHTML = "";
    logMessage(i18n("log_session_ready"), "system");

    await runNextJob(continueCurrentProject);
  } catch (error) {
    const message = i18n("status_start_error", { error: error.message });
    logMessage(message, "CRITICAL");
    updateLiveStatus(message, "error");
    resetState(i18n("reset_error"), "error");
  }
}

function finishQueue() {
  const failedJobs = state.masterQueue.filter(
    (job) => job.status === "failed",
  ).length;

  if (failedJobs > 0) {
    const summary = i18n("log_queue_finished_with_failures", {
      failed: failedJobs,
      total: state.masterQueue.length,
    });
    logMessage(summary, "error");
    updateLiveStatus(summary, "error");
  } else {
    logMessage(i18n("log_all_jobs_complete"), "system");
    updateLiveStatus(i18n("log_all_jobs_complete"), "success");
  }
  resetState(null);
  updateButtonStates();
}

function buildTaskList(job, expectedVideos) {
  const items =
    job.mode === "image-to-video" ? job.images : job.prompts;
  state.taskList = items.map((item, index) => {
    const task = {
      index: index + 1,
      item,
      prompt:
        job.mode === "image-to-video" ? job.prompts[index] || "" : item,
      status: "pending",
      expectedVideos,
      foundVideos: 0,
      submittedAt: 0,
      jobId: job.id,
    };
    state.masterTaskList.push(task);
    return task;
  });
}

async function runNextJob(continueCurrentProject = false) {
  if (state.stopRequested) {
    resetState(i18n("reset_user_stop"));
    return;
  }
  if (state.finalScanTimerId) {
    clearInterval(state.finalScanTimerId);
    state.finalScanTimerId = null;
  }

  state.currentJobIndex = state.masterQueue.findIndex(
    (job, index) => job.status === "pending" && index >= state.currentJobIndex,
  );
  if (state.currentJobIndex === -1) {
    finishQueue();
    return;
  }

  const job = state.masterQueue[state.currentJobIndex];
  job.status = "running";
  updateQueueModal();

  const expectedVideos = parseInt(job.repeatCount, 10) || 1;
  // A partially finished job resumes where it stopped; otherwise honour the
  // user's "start from" position.
  const startFromIndex = Math.max(0, (job.startFrom || 1) - 1);
  if (!(job.currentIndex > 0 && job.currentIndex > startFromIndex)) {
    job.currentIndex = startFromIndex;
  }

  buildTaskList(job, expectedVideos);
  state.promptList = state.taskList.map((task) => task.item);
  state.currentMode = job.mode;
  state.currentIndex = job.currentIndex;

  await runJob(job, continueCurrentProject);
}

async function openProjectPage(continueCurrentProject) {
  const currentTab = continueCurrentProject
    ? await chrome.tabs.get(state.flowTabId)
    : null;
  const canContinue = Boolean(
    currentTab?.url?.includes("/tools/flow/project"),
  );

  if (canContinue) {
    state.currentProjectId = getProjectIdFromUrl(currentTab.url);
    logMessage(
      i18n("log_continuing_job", { index: state.currentJobIndex + 1 }),
      "system",
    );
    logMessage(
      i18n("log_continue_on_project", {
        id: state.currentProjectId || "N/A",
      }),
      "info",
    );
    await baselineExistingVideos();
    return true;
  }

  state.downloadedVideoUrls.clear();
  updateLiveStatus(i18n("status_creating_project"), "info");
  logMessage(
    i18n("log_starting_job", { index: state.currentJobIndex + 1 }),
    "system",
  );

  await chrome.tabs.update(state.flowTabId, { url: FLOW_HOME_URL });
  await waitForFlowHomepage();
  await interruptibleSleep(200);
  if (state.stopRequested) return false;

  logMessage(i18n("log_homepage_loaded"), "info");
  if (!(await injectScript(clickNewProjectButton))) {
    throw new Error(i18n("log_click_new_project_fail"));
  }

  logMessage(i18n("log_wait_for_project"), "info");
  await waitForProjectPage();

  const projectTab = await chrome.tabs.get(state.flowTabId);
  state.currentProjectId = getProjectIdFromUrl(projectTab.url);
  logMessage(
    i18n("log_navigated_to_project", { id: state.currentProjectId || "N/A" }),
    "info",
  );
  return true;
}

function waitForFlowHomepage() {
  return new Promise((resolve, reject) => {
    const listener = (tabId, changeInfo, tab) => {
      if (tabId !== state.flowTabId || changeInfo.status !== "complete") return;
      if (tab.url?.includes("/tools/flow") && !tab.url?.includes("/project")) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
        return;
      }
      if (
        !tab.url?.includes("/tools/flow") &&
        !tab.url?.includes("accounts.google.com")
      ) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(
          new Error(
            i18n("log_nav_error_or_unexpected_page", { url: tab.url }),
          ),
        );
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(i18n("log_timeout_nav_homepage")));
    }, NAVIGATION_TIMEOUT_MS);
  });
}

function waitForProjectPage() {
  return new Promise((resolve, reject) => {
    const listener = (tabId, changeInfo, tab) => {
      if (tabId !== state.flowTabId || changeInfo.status !== "complete") return;
      if (tab.url?.includes("/project/")) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
        return;
      }
      if (tab.url?.includes("/tools/flow")) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(i18n("log_fail_nav_from_homepage")));
        return;
      }
      if (!tab.url?.includes("accounts.google.com")) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(
          new Error(i18n("log_unexpected_page_after_click", { url: tab.url })),
        );
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(i18n("error_timeout_new_project")));
    }, NAVIGATION_TIMEOUT_MS);
  });
}

async function runJob(job, continueCurrentProject) {
  try {
    if (!(await openProjectPage(continueCurrentProject))) {
      resetState(i18n("reset_user_stop"));
      return;
    }
    if (!(await applyPageSettings(job))) {
      throw new Error(i18n("log_apply_initial_settings_fail"));
    }
    if (state.stopRequested) {
      resetState(i18n("reset_user_stop"));
      return;
    }

    if (state.currentIndex >= state.taskList.length) {
      const message = i18n("status_invalid_start_pos", {
        start: state.currentIndex + 1,
        total: state.taskList.length,
      });
      updateLiveStatus(message, "error");
      logMessage(message, "error");
      job.status = "done";
      updateQueueModal();
      chrome.storage.local.set({ masterQueue: state.masterQueue });
      state.currentJobIndex++;
      await runNextJob(false);
      return;
    }

    stopScanner();
    if (dom.autoDownloadCheckbox.checked) {
      startScanner("main");
      logMessage(
        i18n("log_scanner_started", {
          interval: state.hotScanIntervalMs / 1000,
        }),
        "info",
      );
    } else {
      logMessage(i18n("log_auto_scan_off"), "info");
    }

    state.newlyDownloadedCount = 0;
    state.activeRunMode = state.currentMode;
    chrome.storage.local.set({ lastRunMode: state.currentMode });

    await runTaskLoop(job);
  } catch (error) {
    logMessage(
      i18n("log_critical_job_error", {
        index: state.currentJobIndex + 1,
        error: error.message,
      }),
      "CRITICAL",
    );
    updateLiveStatus(
      i18n("status_start_error", { error: error.message }),
      "error",
    );
    job.status = "failed";
    updateQueueModal();
    state.currentJobIndex++;
    await runNextJob(false);
  }
}

/** Reloads the Flow tab and re-applies settings before a retry. */
async function reloadAndReapplySettings(job) {
  await new Promise((resolve, reject) => {
    chrome.tabs.reload(state.flowTabId, { bypassCache: true }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
  await waitForTabLoad(state.flowTabId);
  if (!(await applyPageSettings(job))) {
    throw new Error(i18n("log_settings_fail"));
  }
}

/**
 * Runs one task submission attempt and normalises the injected script's reply
 * into `true` (submitted), a string failure code, or `false`.
 */
async function submitTask(job, task, attempt, totalTasks) {
  const aspectRatio = job.aspectRatio || "portrait";

  if (job.mode !== "image-to-video") {
    const status = i18n("log_processing", {
      index: task.index,
      total: totalTasks,
      retry: attempt,
      maxRetry: state.MAX_RETRIES,
    });
    logMessage(status, "info");
    updateLiveStatus(status, "info");
    const outcome = await injectScript(processPromptOnPage, [
      task.prompt,
      state.selectors.PROMPT_TEXTAREA_ID,
      state.selectors.GENERATE_BUTTON_XPATH,
    ]);
    return { outcome, injectionCode: null, failureMessage: undefined };
  }

  const image = task.item;
  const status = i18n("log_processing_image", {
    index: task.index,
    total: totalTasks,
    retry: attempt,
    maxRetry: state.MAX_RETRIES,
  });
  logMessage(status, "info");
  updateLiveStatus(status, "info");

  let dataUrl;
  try {
    const file = await getImage(image.id);
    if (!file) {
      return {
        outcome: "FILE_READ_ERROR",
        injectionCode: null,
        failureMessage: undefined,
      };
    }
    dataUrl = await readFileAsDataURL(file);
  } catch {
    return {
      outcome: "FILE_READ_ERROR",
      injectionCode: null,
      failureMessage: undefined,
    };
  }

  const result = dataUrl
    ? await injectScript(processImageAndPromptOnPage, [
        dataUrl,
        image.name,
        image.type,
        task.prompt,
        aspectRatio,
      ])
    : "FILE_READ_ERROR";

  if (!result || typeof result !== "object") {
    return { outcome: result, injectionCode: null, failureMessage: undefined };
  }

  logTrace(result.trace, result.ok, "Flow task");

  let failureMessage;
  if (!result.ok) {
    const domDetails = result.diagnostics
      ? ` | DOM=${JSON.stringify(result.diagnostics)}`
      : "";
    failureMessage = i18n("log_flow_task_step_fail", {
      step: result.step,
      message: result.message,
      details: domDetails,
    });
    logMessage(failureMessage, "error");
  }

  const outcome = result.ok
    ? true
    : result.code === "QUEUE_FULL" || result.code === "POLICY_PROMPT"
      ? result.code
      : false;

  return {
    outcome,
    injectionCode: result.ok ? null : result.code || null,
    failureMessage,
  };
}

function describeTaskFailure(job, task, outcome, injectionFailureMessage) {
  const itemName = job.mode === "image-to-video" ? task.item.name : "N/A";
  if (outcome === "POLICY_IMAGE") {
    return i18n("log_policy_error_image", { filename: itemName });
  }
  if (outcome === "POLICY_PROMPT") return i18n("log_policy_error_prompt");
  if (outcome === "FILE_READ_ERROR") {
    return i18n("log_file_read_error", { filename: itemName });
  }
  if (outcome === false) {
    return i18n(
      job.mode === "image-to-video"
        ? "log_image_inject_fail"
        : "log_submit_fail",
    );
  }
  return injectionFailureMessage || i18n("reason_unknown");
}

async function runTaskLoop(job) {
  const totalTasks = state.taskList.length;

  while (
    state.currentIndex < totalTasks &&
    state.isRunning &&
    !state.stopRequested
  ) {
    await pauseIfNeeded();
    if (state.stopRequested) break;

    const task = state.taskList[state.currentIndex];
    let taskFailed = false;
    let policyBlocked = false;
    let lastInjectionCode = null;

    job.progress.completed = state.currentIndex;
    updateQueueModal();

    for (let attempt = 0; attempt <= state.MAX_RETRIES; attempt++) {
      await pauseIfNeeded();
      if (state.stopRequested) break;

      if (attempt > 0) {
        const retryOnCurrentPage =
          RETRY_ON_CURRENT_PAGE_CODES.has(lastInjectionCode);
        logMessage(
          retryOnCurrentPage
            ? i18n("log_retry_task_same_page", {
                index: task.index,
                retry: attempt,
              })
            : i18n("log_retry_task", { index: task.index, retry: attempt }),
          "warn",
        );
        if (dom.autoDownloadCheckbox.checked) {
          await interruptibleSleep(state.scanIntervalMs);
        }

        if (retryOnCurrentPage) {
          logMessage(
            i18n("log_retry_step_same_page", { code: lastInjectionCode }),
            "info",
          );
        } else {
          try {
            await reloadAndReapplySettings(job);
          } catch (error) {
            if (error.message === i18n("reset_user_stop")) {
              logMessage(i18n("reset_user_stop"), "warn");
              taskFailed = true;
              break;
            }
            const message = `${i18n("log_page_reload_fail")}: ${error.message}`;
            logMessage(message, "CRITICAL");
            addFailedPrompt(
              task.item,
              message,
              task.index,
              state.currentJobIndex,
            );
            taskFailed = true;
            break;
          }
        }

        if (!(await waitOutQueueFullBeforeRetry())) {
          taskFailed = true;
          break;
        }
      }

      updateProgressBar(
        state.currentIndex,
        totalTasks,
        state.currentJobIndex,
        state.masterQueue.length,
      );

      const { outcome, injectionCode, failureMessage } = await submitTask(
        job,
        task,
        attempt,
        totalTasks,
      );
      lastInjectionCode = injectionCode;

      if (outcome === true) {
        task.submittedAt = Date.now();
        logMessage(i18n("log_submit_success", { index: task.index }), "success");
        taskFailed = false;
        break;
      }

      if (outcome === "QUEUE_FULL") {
        logMessage(i18n("log_queue_full"), "warn");
        if (await waitOutQueueFullDuringTask()) {
          attempt--;
          continue;
        }
        taskFailed = true;
        if (attempt === state.MAX_RETRIES) {
          logMessage(i18n("log_queue_full_gave_up"), "error");
          addFailedPrompt(
            task.item,
            i18n("log_queue_full"),
            task.index,
            state.currentJobIndex,
          );
        }
        continue;
      }

      taskFailed = true;
      const reason = describeTaskFailure(job, task, outcome, failureMessage);
      logMessage(reason, "error");

      if (outcome === "POLICY_IMAGE" || outcome === "POLICY_PROMPT") {
        policyBlocked = true;
        addFailedPrompt(task.item, reason, task.index, state.currentJobIndex);
        break;
      }
      if (attempt === state.MAX_RETRIES) {
        logMessage(
          i18n("log_skip_task", {
            index: task.index,
            maxRetry: state.MAX_RETRIES,
          }),
          "error",
        );
        addFailedPrompt(task.item, reason, task.index, state.currentJobIndex);
      }
    }

    if (state.stopRequested) break;

    if (!taskFailed || policyBlocked) {
      const waitMs = getRandomWait(
        dom.minInitialWaitTimeInput.value,
        dom.maxInitialWaitTimeInput.value,
      );
      logMessage(
        i18n("log_wait_for_video", { seconds: Math.round(waitMs / 1000) }),
        "info",
      );
      if (policyBlocked) {
        await interruptibleSleep(waitMs);
      } else {
        const waitResult = await interruptibleSleepAndScan(waitMs);
        if (waitResult === "STOPPED") break;
        if (waitResult === "POLICY_ERROR") {
          logMessage(i18n("log_policy_error_prompt"), "error");
          taskFailed = true;
        }
      }
    }

    if (state.stopRequested) break;
    if (!taskFailed) {
      logMessage(i18n("log_prompt_completed", { index: task.index }), "system");
    }
    state.currentIndex++;
    job.currentIndex = state.currentIndex;
  }

  await finishJob(job, totalTasks);
}

async function finishJob(job, totalTasks) {
  if (state.stopRequested) {
    job.status = "pending";
    updateQueueModal();
    resetState(i18n("reset_user_stop"));
    return;
  }
  if (!state.isRunning) return;

  const jobTasks = state.masterTaskList.filter((task) => task.jobId === job.id);
  const failedTaskCount = jobTasks.filter(
    (task) => task.status === "failed",
  ).length;
  const allTasksFailed =
    jobTasks.length > 0 && failedTaskCount === jobTasks.length;
  const waitForDownloads =
    dom.autoDownloadCheckbox.checked && !allTasksFailed;

  job.status =
    failedTaskCount > 0 ? "failed" : waitForDownloads ? "downloading" : "done";
  job.progress.completed = totalTasks;
  updateQueueModal();
  chrome.storage.local.set({ masterQueue: state.masterQueue });

  if (waitForDownloads) {
    startJobCompletionWatcher(job);
    return;
  }

  if (allTasksFailed) {
    const summary = i18n("log_job_all_tasks_failed", {
      index: state.currentJobIndex + 1,
      failed: failedTaskCount,
      total: jobTasks.length,
    });
    logMessage(summary, "error");
    updateLiveStatus(summary, "error");
  }
  state.currentJobIndex++;
  await runNextJob(false);
}

function formatElapsed(elapsedMs) {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, "0")}`;
}

function reportWatcherHeartbeat(jobId, elapsedMs) {
  const now = Date.now();
  if (now - state.lastDownloadStatusUiAt < 10000) return;
  state.lastDownloadStatusUiAt = now;

  const diagnostics = state.lastVideoScanDiagnostics;
  const readyVideos = Array.isArray(diagnostics?.videos)
    ? diagnostics.videos.filter((video) => Number(video.readyState) >= 2).length
    : 0;
  const pendingDownloads = Array.from(state.activeDownloads.values()).filter(
    (download) => download.task?.jobId === jobId,
  ).length;

  const detail =
    pendingDownloads > 0
      ? i18n("status_detail_downloading", { count: pendingDownloads })
      : readyVideos > 0
        ? i18n("status_detail_ready", { count: readyVideos })
        : i18n("status_detail_none");

  updateLiveStatus(
    i18n("status_watching_progress", {
      elapsed: formatElapsed(elapsedMs),
      scans: state.videoScanAttemptCount,
      detail,
    }),
    pendingDownloads > 0 ? "info" : "warn",
  );
}

function failTimedOutTasks(job, jobTasks, timeoutMs) {
  for (const [captureToken, download] of state.activeDownloads.entries()) {
    if (download.task?.jobId !== job.id) continue;
    chrome.runtime.sendMessage({
      type: "cancelFlowDownloadCapture",
      token: captureToken,
    });
    state.activeDownloads.delete(captureToken);
  }

  const minutes = Math.round(timeoutMs / 60000);
  const unresolved = jobTasks.filter((task) => task.status === "pending");
  unresolved.forEach((task) => {
    task.status = "failed";
    addFailedPrompt(
      task.item,
      i18n("reason_scan_timeout", { minutes }),
      task.index,
      state.currentJobIndex,
    );
  });

  job.status = "failed";
  chrome.storage.local.set({ masterQueue: state.masterQueue });
  updateQueueModal();
  logMessage(
    i18n("log_scan_timeout_summary", {
      minutes,
      count: unresolved.length,
    }),
    "error",
  );
}

/**
 * After the last submission the videos still have to render and download, so
 * the job stays open until every task is terminal or the timeout expires.
 */
function startJobCompletionWatcher(job) {
  const timeoutMs = state.generationScanTimeoutMs;
  logMessage(
    i18n("log_job_submitted_watching", {
      index: state.currentJobIndex + 1,
      minutes: Math.round(timeoutMs / 60000),
    }),
    "system",
  );
  updateLiveStatus(i18n("status_watching_start"), "info");

  const startedAt = Date.now();
  state.finalScanTimerId = setInterval(async () => {
    if (
      state.currentJobIndex >= state.masterQueue.length ||
      !state.masterQueue[state.currentJobIndex]
    ) {
      clearInterval(state.finalScanTimerId);
      state.finalScanTimerId = null;
      return;
    }

    const currentJob = state.masterQueue[state.currentJobIndex];
    const jobTasks = state.masterTaskList.filter(
      (task) => task.jobId === currentJob.id,
    );
    const allTasksTerminal =
      jobTasks.length > 0 &&
      jobTasks.every(
        (task) => task.status === "complete" || task.status === "failed",
      );
    const elapsedMs = Date.now() - startedAt;

    reportWatcherHeartbeat(currentJob.id, elapsedMs);

    let finished = false;
    if (allTasksTerminal) {
      finished = true;
      if (currentJob.status === "downloading") {
        currentJob.status = jobTasks.some((task) => task.status === "failed")
          ? "failed"
          : "done";
        chrome.storage.local.set({ masterQueue: state.masterQueue });
        updateQueueModal();
      }
    } else if (elapsedMs >= timeoutMs) {
      finished = true;
      failTimedOutTasks(currentJob, jobTasks, timeoutMs);
    }

    if (!finished) return;

    const allComplete =
      allTasksTerminal &&
      jobTasks.every((task) => task.status === "complete");
    logMessage(
      i18n(
        allComplete
          ? "log_job_downloads_complete"
          : "log_job_downloads_incomplete",
        { index: state.currentJobIndex + 1 },
      ),
      allComplete ? "success" : "error",
    );

    clearInterval(state.finalScanTimerId);
    state.finalScanTimerId = null;
    state.currentJobIndex++;
    await runNextJob(false);
  }, state.scanIntervalMs);
}

/**
 * Polls Flow's "queue full" toast.
 * Returns STOPPED | ERROR | CLEARED | STILL_FULL.
 */
async function pollQueueFull(attempts, delayMs, attemptOffset) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await pauseIfNeeded();
    if (state.stopRequested) return "STOPPED";

    const stillFull = await injectScript(scanForQueueFullPopup);
    if (stillFull === undefined) return "ERROR";
    if (!stillFull) {
      logMessage(i18n("log_queue_cleared_after_wait"), "info");
      return "CLEARED";
    }

    const message = i18n("log_queue_full_retrying", {
      attempt: attempt + attemptOffset,
      total: 30,
    });
    logMessage(message, "warn");
    updateLiveStatus(message, "warn");
    await interruptibleSleep(delayMs);
  }
  return "STILL_FULL";
}

async function waitOutQueueFullDuringTask() {
  let result = await pollQueueFull(10, 10000, 0);
  if (result === "CLEARED") return true;
  if (result === "STOPPED" || result === "ERROR") return false;

  logMessage(i18n("log_queue_full_wait_30s"), "warn");
  await interruptibleSleep(30000);
  if (state.stopRequested) return false;

  result = await pollQueueFull(10, 10000, 10);
  return result === "CLEARED";
}

async function waitOutQueueFullBeforeRetry() {
  const result = await pollQueueFull(10, 10000, 20);
  if (result === "CLEARED") return true;
  if (result === "STOPPED" || result === "ERROR") return false;

  const message = i18n("log_queue_full_gave_up");
  logMessage(message, "CRITICAL");
  resetState(message, "error");
  return false;
}

function scheduleZoomReset(tabId) {
  if (state.zoomResetTimerId) clearTimeout(state.zoomResetTimerId);
  state.zoomResetTimerId = setTimeout(() => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab?.id === tabId) chrome.tabs.setZoom(tabId, 1).catch(() => {});
      });
    } catch {
      // The tab is already gone; nothing to restore.
    }
    state.zoomResetTimerId = null;
  }, 500);
}

function clearCreateFormUI() {
  if (dom.imageFileSummary) dom.imageFileSummary.style.display = "none";
  if (dom.imagePromptPairsContainer) {
    dom.imagePromptPairsContainer.innerHTML = "";
    dom.imagePromptPairsContainer.style.display = "none";
  }
  if (dom.imageCount) dom.imageCount.textContent = "0";
  if (dom.imageInput) dom.imageInput.value = null;
}

/**
 * @param {string|null} message Final status to show, or null for "ready".
 * @param {"success"|"warn"|"error"} [level] Explicit level; inferred when absent.
 */
export function resetState(message, level) {
  stopScanner();
  if (state.finalScanTimerId) {
    clearInterval(state.finalScanTimerId);
    state.finalScanTimerId = null;
  }
  if (state.flowTabId) scheduleZoomReset(state.flowTabId);

  state.isRunning = false;
  state.stopRequested = false;
  state.isPaused = false;
  state.currentIndex = 0;
  state.currentJobIndex = 0;
  state.flowTabId = null;
  state.currentProjectId = null;
  state.newlyDownloadedCount = 0;

  Array.from(state.activeDownloads.keys()).forEach((captureToken) => {
    chrome.runtime.sendMessage({
      type: "cancelFlowDownloadCapture",
      token: captureToken,
    });
  });
  state.activeDownloads.clear();
  state.scanInFlight = false;
  state.videoScanAttemptCount = 0;
  state.lastVideoScanAt = 0;
  state.lastVideoScanDiagnostics = null;
  state.lastDownloadStatusUiAt = 0;
  state.imageFileList = [];
  state.imagePromptPairs = [];
  state.promptList = [];
  state.taskList = [];
  state.masterTaskList = [];
  state.masterQueue.forEach((job) => {
    if (job.status === "running" || job.status === "downloading") {
      job.status = "pending";
    }
  });

  clearCreateFormUI();
  state.activeRunMode = null;
  chrome.storage.local.set({
    lastRunMode: null,
    masterQueue: state.masterQueue,
  });
  updateQueueModal();
  updateButtonStates();

  if (!state.isRunning && !state.downloadInterval && !state.finalScanTimerId) {
    if (dom.mainActionButton) dom.mainActionButton.style.display = "flex";
    if (dom.startNewProjectButton) {
      dom.startNewProjectButton.style.display = "none";
    }
    if (dom.startCurrentProjectButton) {
      dom.startCurrentProjectButton.style.display = "none";
    }
    if (dom.progressBar) dom.progressBar.value = 0;
  }

  if (!message) {
    updateLiveStatus(i18n("status_ready"));
    return;
  }

  const statusLevel = level || "warn";
  // A successful finish reads better as a system note in the log.
  const logLevel = statusLevel === "success" ? "system" : statusLevel;
  logMessage(message, logLevel);
  updateLiveStatus(message, statusLevel);
}
