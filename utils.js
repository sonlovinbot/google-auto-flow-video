import { state } from "./state.js";
import { logMessage } from "./ui.js";
import { i18n } from "./i18n.js";
import { scanForPolicyError, injectScript } from "./injector.js";

export const naturalSortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function getProjectIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/project\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => {
      logMessage(i18n("log_file_read_error", { filename: file.name }), "error");
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

export function sortImageFiles(order) {
  if (!state.imageFileList?.length) return;
  switch (order) {
    case "az":
      state.imageFileList.sort((a, b) =>
        naturalSortCollator.compare(a.name, b.name),
      );
      break;
    case "za":
      state.imageFileList.sort((a, b) =>
        naturalSortCollator.compare(b.name, a.name),
      );
      break;
    case "newest":
      state.imageFileList.sort((a, b) => b.lastModified - a.lastModified);
      break;
    case "oldest":
      state.imageFileList.sort((a, b) => a.lastModified - b.lastModified);
      break;
  }
}

export function getRandomWait(minValue, maxValue) {
  const parsedMin = Number.parseInt(minValue || "3", 10) || 3;
  const parsedMax = Number.parseInt(maxValue || "6", 10) || 6;
  const min = Math.max(1, Math.min(parsedMin, parsedMax));
  const max = Math.max(min, Math.max(parsedMin, parsedMax));
  return 1000 * (Math.floor(Math.random() * (max - min + 1)) + min);
}

export async function pauseIfNeeded() {
  while (state.isPaused && !state.stopRequested) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function interruptibleSleep(duration) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    await pauseIfNeeded();
    if (state.stopRequested) return true;
    const remaining = deadline - Date.now();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(150, Math.max(0, remaining))),
    );
  }
  return false;
}

export async function interruptibleSleepAndScan(duration) {
  const deadline = Date.now() + duration;
  let nextPolicyScan = Date.now() + 1000;

  while (Date.now() < deadline) {
    await pauseIfNeeded();
    if (state.stopRequested) return "STOPPED";

    const now = Date.now();
    if (now >= nextPolicyScan) {
      try {
        if (await injectScript(scanForPolicyError)) return "POLICY_ERROR";
      } catch {
        // Keep the short pacing wait even when Flow is between renders.
      }
      nextPolicyScan = now + 750;
    }

    const remaining = deadline - now;
    const untilScan = nextPolicyScan - now;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(150, remaining, untilScan))),
    );
  }
  return "COMPLETED";
}

export async function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const verifyProjectTab = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          finish(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (tab?.status === "complete" && tab.url?.includes("/project/")) {
          finish();
        }
      });
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        verifyProjectTab();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    verifyProjectTab();
    timeoutId = setTimeout(
      () => finish(new Error(i18n("log_page_reload_fail"))),
      60000,
    );
  });
}
