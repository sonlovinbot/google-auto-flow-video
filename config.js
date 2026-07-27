import { state } from "./state.js";
import { logMessage, updateLiveStatus } from "./ui.js";
import { i18n } from "./i18n.js";

const SELECTORS_URL = "flow-selectors.json";
const OVERRIDE_STORAGE_KEY = "selectorOverride";

/**
 * Every selector the automation needs. Loading is checked against this list so
 * a truncated override or a stale bundled file fails loudly at startup instead
 * of silently at the step that needs the missing control.
 */
const REQUIRED_SELECTORS = [
  "PROMPT_TEXTAREA_ID",
  "GENERATE_BUTTON_XPATH",
  "NEW_PROJECT_BUTTON_XPATH",
  "PROMPT_POLICY_ERROR_POPUP_XPATH",
  "QUEUE_FULL_POPUP_XPATH",
  "START_IMAGE_ADD_BUTTON_XPATH",
  "HIDDEN_FILE_INPUT_XPATH",
  "UPLOAD_SPINNER_XPATH",
  "IMAGE_POLICY_ERROR_POPUP_XPATH",
  "SETTINGS_BUTTON_XPATH",
  "MODEL_SELECTION_BUTTON_XPATH",
  "MODEL_OMNI_FLASH_XPATH",
  "MODEL_VEO_3_LITE_XPATH",
  "MODEL_VEO_3_FAST_XPATH",
  "MODEL_VEO_3_QUALITY_XPATH",
  "RESULT_CONTAINER_XPATH",
  "PROMPT_IN_CONTAINER_XPATH",
  "VIDEOS_IN_CONTAINER_XPATH",
];

function missingSelectors(selectors) {
  if (!selectors || typeof selectors !== "object") return REQUIRED_SELECTORS;
  return REQUIRED_SELECTORS.filter(
    (name) => typeof selectors[name] !== "string" || !selectors[name].trim(),
  );
}

function readOverride() {
  return new Promise((resolve) => {
    chrome.storage.local.get([OVERRIDE_STORAGE_KEY], (stored) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(stored?.[OVERRIDE_STORAGE_KEY] || null);
    });
  });
}

async function readBundledSelectors() {
  const response = await fetch(chrome.runtime.getURL(SELECTORS_URL));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Flow's DOM changes without notice, so the selectors live in a data file the
 * user can patch (chrome.storage.local.selectorOverride) instead of requiring a
 * new extension build for every Google UI tweak.
 */
export async function loadLocalConfig() {
  try {
    const override = await readOverride();
    if (override) {
      const overrideSelectors = override.selectors || override;
      const missing = missingSelectors(overrideSelectors);
      if (missing.length === 0) {
        state.selectors = overrideSelectors;
        logMessage(i18n("log_config_override_loaded"), "warn");
        return true;
      }
      logMessage(
        i18n("log_config_override_invalid", { keys: missing.join(", ") }),
        "warn",
      );
    }

    const bundled = await readBundledSelectors();
    const missing = missingSelectors(bundled.selectors);
    if (missing.length > 0) {
      const message = i18n("log_config_selectors_missing", {
        keys: missing.join(", "),
      });
      logMessage(message, "CRITICAL");
      updateLiveStatus(i18n("log_load_selectors_fail"), "error");
      return false;
    }

    state.selectors = bundled.selectors;
    logMessage(
      i18n("log_config_loaded_versioned", {
        version: bundled.version ?? "?",
        target: bundled.targetFlowUI || "?",
      }),
      "info",
    );
    return true;
  } catch (error) {
    logMessage(
      i18n("log_config_fetch_exception", { error: error.message }),
      "CRITICAL",
    );
    updateLiveStatus(i18n("log_config_load_error"), "error");
    return false;
  }
}
