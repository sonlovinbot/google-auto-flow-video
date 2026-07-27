import { i18n } from "./i18n.js";

function textForSelectedOption(select) {
  return select?.selectedOptions?.[0]?.textContent?.trim() || "";
}

function syncModeButtons() {
  const modeSelector = document.getElementById("modeSelector");
  if (!modeSelector) return;
  document.querySelectorAll(".mode-option").forEach((button) => {
    const active = button.dataset.mode === modeSelector.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncFrameButtons() {
  const frameModeSelector = document.getElementById("frameModeSelector");
  if (!frameModeSelector) return;
  document.querySelectorAll(".frame-option").forEach((button) => {
    const active = button.dataset.frameMode === frameModeSelector.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncProfile() {
  const model = document.getElementById("modelSelector");
  const duration = document.getElementById("omniDurationSelector");
  const ratio = document.getElementById("aspectRatioSelector");
  const output = document.getElementById("repeatCountInput");
  const save = document.getElementById("downloadSaveModeSelector");
  const folder = document.getElementById("jobDownloadFolderInput");

  const profileModel = document.getElementById("profileModel");
  const profileDuration = document.getElementById("profileDuration");
  const profileRatio = document.getElementById("profileRatio");
  const profileOutput = document.getElementById("profileOutput");
  const profileSave = document.getElementById("profileSave");
  const profileFolder = document.getElementById("profileFolder");

  if (profileModel) {
    profileModel.textContent = textForSelectedOption(model).toUpperCase();
  }
  if (profileDuration) {
    profileDuration.textContent =
      model?.value === "omni_flash"
        ? textForSelectedOption(duration).toUpperCase()
        : i18n("profile_duration_flow_default");
  }
  if (profileRatio) {
    profileRatio.textContent =
      ratio?.value === "portrait" ? "9:16" : "16:9";
  }
  if (profileOutput) {
    profileOutput.textContent = i18n("profile_output_per_line", {
      count: output?.value || "1",
    });
  }
  if (profileSave) {
    profileSave.textContent = i18n(
      save?.value === "ask" ? "profile_save_ask" : "profile_save_auto",
    );
  }
  if (profileFolder) {
    profileFolder.textContent =
      folder?.value?.trim() || i18n("job_folder_default");
  }
}

function syncTabAccessibility(activeTab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document
    .querySelectorAll(".tab-pane.active")
    .forEach((pane) => pane.classList.remove("active"));
  const pane =
    activeTab === "queue"
      ? document.getElementById("queueModalOverlay")
      : document.getElementById(`content-${activeTab}`);
  pane?.classList.add("active");
}

document.addEventListener("DOMContentLoaded", () => {
  const modeSelector = document.getElementById("modeSelector");
  document.querySelectorAll(".mode-option").forEach((button) => {
    button.addEventListener("click", () => {
      if (!modeSelector || modeSelector.value === button.dataset.mode) return;
      modeSelector.value = button.dataset.mode;
      modeSelector.dispatchEvent(new Event("change", { bubbles: true }));
      syncModeButtons();
    });
  });

  const frameModeSelector = document.getElementById("frameModeSelector");
  document.querySelectorAll(".frame-option").forEach((button) => {
    button.addEventListener("click", () => {
      if (
        !frameModeSelector ||
        frameModeSelector.value === button.dataset.frameMode
      ) {
        return;
      }
      frameModeSelector.value = button.dataset.frameMode;
      frameModeSelector.dispatchEvent(new Event("change", { bubbles: true }));
      syncFrameButtons();
    });
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      syncTabAccessibility(button.dataset.tab);
    });
  });

  document.querySelectorAll(".jump-to-settings").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector('.tab-button[data-tab="settings"]')?.click();
    });
  });

  document.getElementById("openQueueButton")?.addEventListener("click", () => {
    syncTabAccessibility("queue");
  });
  document.getElementById("closeQueueModal")?.addEventListener("click", () => {
    syncTabAccessibility("control");
  });

  [
    "modeSelector",
    "modelSelector",
    "omniDurationSelector",
    "aspectRatioSelector",
    "repeatCountInput",
    "downloadSaveModeSelector",
    "jobDownloadFolderInput",
    "frameModeSelector",
  ].forEach((id) => {
    const control = document.getElementById(id);
    control?.addEventListener("change", () => {
      syncModeButtons();
      syncFrameButtons();
      syncProfile();
    });
    control?.addEventListener("input", syncProfile);
  });

  const syncAll = () => {
    syncModeButtons();
    syncFrameButtons();
    syncProfile();
  };
  syncAll();
  // loadSettings resolves asynchronously; re-sync once it has written values.
  setTimeout(syncAll, 250);

  chrome.storage?.onChanged?.addListener(() => {
    setTimeout(syncProfile, 0);
  });
});
