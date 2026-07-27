import { dom } from "./dom.js";
import { state } from "./state.js";
import { updateModelSpecificSettings } from "./ui.js";

const SUPPORTED_MODELS = new Set([
  "omni_flash",
  "veo3_lite",
  "veo3_fast",
  "veo3_quality",
]);

export function loadSettings(onLoaded) {
  const detectedLanguage = chrome.i18n.getUILanguage().split("-")[0];
  const defaults = {
    prompts: "",
    startFrom: 1,
    language: ["vi", "en", "hi", "th", "ur", "bn", "es"].includes(
      detectedLanguage,
    )
      ? detectedLanguage
      : "en",
    videoCount: "1",
    minInitialWait: 3,
    maxInitialWait: 6,
    autoDownload: true,
    downloadSaveMode: "auto",
    downloadFolder: "Flow Downloads",
    mode: "text-to-video",
    aspectRatio: "portrait",
    model: "omni_flash",
    omniDuration: "4s",
    lastRunMode: null,
    imageSort: "az",
    masterQueue: [],
    nextProjectCounter: 1,
  };

  chrome.storage.local.get(defaults, (stored) => {
    const model = SUPPORTED_MODELS.has(stored.model)
      ? stored.model
      : "omni_flash";
    const migratedLegacyWait =
      (Number(stored.minInitialWait) === 30 &&
        Number(stored.maxInitialWait) === 60) ||
      (Number(stored.minInitialWait) === 90 &&
        Number(stored.maxInitialWait) === 120);
    const minInitialWait = migratedLegacyWait ? 3 : stored.minInitialWait;
    const maxInitialWait = migratedLegacyWait ? 6 : stored.maxInitialWait;

    dom.promptsTextarea.value = stored.prompts;
    dom.startFromInput.value = stored.startFrom;
    dom.repeatCountInput.value = stored.videoCount;
    dom.minInitialWaitTimeInput.value = minInitialWait;
    dom.maxInitialWaitTimeInput.value = maxInitialWait;
    dom.languageSelector.value = stored.language;
    dom.autoDownloadCheckbox.checked = stored.autoDownload;
    dom.downloadSaveModeSelector.value =
      stored.downloadSaveMode === "ask" ? "ask" : "auto";
    dom.modeSelector.value = stored.mode;
    dom.aspectRatioSelector.value = stored.aspectRatio;
    dom.modelSelector.value = model;
    dom.omniDurationSelector.value =
      stored.omniDuration === "6s" ? "6s" : "4s";
    dom.imageSortSelector.value = stored.imageSort;

    state.activeRunMode = stored.lastRunMode;
    state.currentLang = stored.language;
    state.currentMode = stored.mode;
    state.masterQueue = (stored.masterQueue || []).map((job) => ({
      ...job,
      status: job.status === "downloading" ? "pending" : job.status,
      repeatCount: job.repeatCount || stored.videoCount || "1",
      model: SUPPORTED_MODELS.has(job.model) ? job.model : "omni_flash",
      duration:
        job.duration === "6s"
          ? "6s"
          : job.duration === "4s"
            ? "4s"
            : stored.omniDuration === "6s"
              ? "6s"
              : "4s",
      aspectRatio: job.aspectRatio || stored.aspectRatio || "portrait",
      downloadSaveMode:
        job.downloadSaveMode === "ask"
          ? "ask"
          : job.downloadSaveMode === "auto"
            ? "auto"
            : stored.downloadSaveMode === "ask"
              ? "ask"
              : "auto",
    }));
    state.nextProjectCounter = stored.nextProjectCounter;
    updateModelSpecificSettings();

    if (
      migratedLegacyWait ||
      model !== stored.model ||
      stored.aspectRatio !== defaults.aspectRatio
    ) {
      chrome.storage.local.set({
        minInitialWait,
        maxInitialWait,
        model,
        aspectRatio: stored.aspectRatio || defaults.aspectRatio,
      });
    }

    onLoaded?.();
  });
}
