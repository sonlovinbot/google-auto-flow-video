import { queryDOMElements, dom } from "./dom.js";
import { state } from "./state.js";
import { loadSettings } from "./settings.js";
import { i18n } from "./i18n.js";
import { setLanguage } from "./language.js";
import { loadLocalConfig } from "./config.js";
import { attachEventListeners, attachChromeListeners } from "./handlers.js";
import {
  updateButtonStates,
  updateInterfaceVisibility,
  updateUIAfterModeChange,
  updateLiveStatus,
  updateQueueModal,
} from "./ui.js";

/**
 * Elements the panel cannot function without. Missing any of them means the
 * markup and this module are out of sync, so we disable the UI up front instead
 * of failing later with a null dereference mid-run.
 */
const REQUIRED_ELEMENTS = [
  "mainActionButton",
  "stopButton",
  "startNewProjectButton",
  "startCurrentProjectButton",
  "logDisplay",
  "liveStatus",
  "uploadPromptButton",
  "wrongPageMessageElement",
  "autoDownloadCheckbox",
  "downloadSaveModeSelector",
  "openDownloadsSettingsLink",
  "modeSelector",
  "imageModeContainer",
  "aspectRatioSelector",
  "modelSelector",
  "imageSortSelector",
  "navigateToFlowButton",
  "addToQueueButton",
  "openQueueButton",
  "clearQueueButton",
  "queueModalOverlay",
  "promptsTextarea",
  "startFromInput",
  "repeatCountInput",
  "minInitialWaitTimeInput",
  "maxInitialWaitTimeInput",
  "languageSelector",
  "jobDownloadFolderInput",
  "imageInput",
  "fileInput",
  "copyFailedButton",
  "closeQueueModal",
  "queueListDisplay",
  "confirmClearQueueModal",
  "confirmClearQueueButton",
  "cancelClearQueueButton",
  "confirmClearQueueMessage",
  "queueResetAllButton",
  "queueDeleteAllButton",
];

const INTERACTIVE_ELEMENTS = [
  "mainActionButton",
  "promptsTextarea",
  "uploadPromptButton",
  "modeSelector",
  "uploadImageButton",
  "startNewProjectButton",
  "startCurrentProjectButton",
  "navigateToFlowButton",
  "addToQueueButton",
  "clearQueueButton",
  "jobDownloadFolderInput",
  "confirmClearQueueButton",
  "cancelClearQueueButton",
  "queueResetAllButton",
  "queueDeleteAllButton",
];

function disableInterface() {
  for (const key of INTERACTIVE_ELEMENTS) {
    const element = dom[key];
    if (element) element.disabled = true;
  }
}

function reportFatal(message, level = "CRITICAL") {
  console.error(message);
  disableInterface();
  try {
    if (dom.liveStatus) updateLiveStatus(message, level);
  } catch {
    console.error(
      "liveStatus is missing; cannot surface the failure in the UI.",
    );
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    queryDOMElements();

    const missing = REQUIRED_ELEMENTS.filter((key) => !dom[key]);
    if (missing.length > 0) {
      console.error(
        `Interface initialization failed! Missing elements: ${missing.join(", ")}`,
      );
      reportFatal(i18n("log_init_fail_critical"));
      return;
    }

    dom.mainActionButton.style.display = "flex";
    dom.startNewProjectButton.style.display = "none";
    dom.startCurrentProjectButton.style.display = "none";
    updateLiveStatus(i18n("status_loading_config"), "info");

    if (!(await loadLocalConfig())) {
      reportFatal(i18n("log_config_load_error"), "error");
      return;
    }

    loadSettings(() => {
      setLanguage(state.currentLang);
      const counter = state.nextProjectCounter.toString().padStart(2, "0");
      dom.jobDownloadFolderInput.value = `${i18n("job_folder_prefix")}${counter}`;
      updateUIAfterModeChange();
      updateQueueModal();
      attachEventListeners();
      updateButtonStates();
      updateInterfaceVisibility();
      attachChromeListeners();
    });
  } catch (error) {
    console.error("Initialization failed:", error);
    reportFatal(i18n("log_init_fail_critical"));
  }
});
