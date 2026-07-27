import { state } from "./state.js";
import {
  updateFailedPromptsUI,
  updateLiveStatus,
  updateMainButton,
  updateModelSpecificSettings,
  updateUIAfterModeChange,
} from "./ui.js";
import { i18n, translations } from "./i18n.js";

/** A key counts as translatable if any locale defines it; i18n() falls back. */
function hasTranslation(key) {
  return (
    translations[state.currentLang]?.[key] !== undefined ||
    translations.en?.[key] !== undefined
  );
}

/**
 * Icon buttons and tab buttons hold an icon <span> plus a label <span>; only
 * the label may be replaced, otherwise the Material icon name is overwritten.
 */
function labelTargetFor(element) {
  if (
    element.tagName === "BUTTON" &&
    element.querySelector(".material-symbols-outlined")
  ) {
    const labels = element.querySelectorAll(
      "span:not(.material-symbols-outlined)",
    );
    return labels.length > 0 ? labels[labels.length - 1] : element;
  }
  if (element.classList.contains("tab-button") && element.querySelector("span")) {
    return element.querySelector("span:last-of-type");
  }
  return element;
}

export function setLanguage(language) {
  state.currentLang = translations[language] ? language : "en";
  chrome.storage.local.set({ language: state.currentLang });

  document.querySelectorAll("[data-lang-key]").forEach((element) => {
    const key = element.getAttribute("data-lang-key");
    if (!hasTranslation(key)) return;
    if (element.id === "wrong-page-message") {
      element.innerHTML = i18n(key);
      return;
    }
    const target = labelTargetFor(element);
    if (target) target.textContent = i18n(key);
  });

  document.querySelectorAll("[data-lang-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-lang-placeholder");
    if (hasTranslation(key)) element.placeholder = i18n(key);
  });

  document.querySelectorAll("[data-lang-title]").forEach((element) => {
    const key = element.getAttribute("data-lang-title");
    if (hasTranslation(key)) element.title = i18n(key);
  });

  updateMainButton();
  updateFailedPromptsUI();
  updateUIAfterModeChange();
  updateModelSpecificSettings();
  if (!state.isRunning && !state.downloadInterval && !state.finalScanTimerId) {
    updateLiveStatus(i18n("status_ready"));
  }
}
