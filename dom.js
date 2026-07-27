/**
 * Every element the side panel touches, resolved once on DOMContentLoaded.
 * Keys map to element ids unless listed under ELEMENT_SELECTORS.
 */
const ELEMENT_IDS = {
  mainActionButton: "mainActionButton",
  stopButton: "stopButton",
  startNewProjectButton: "startNewProjectButton",
  startCurrentProjectButton: "startCurrentProjectButton",
  promptsTextarea: "prompts",
  uploadPromptButton: "uploadPromptButton",
  fileInput: "fileInput",
  progressBar: "progressBar",
  liveStatus: "liveStatus",
  logDisplay: "logDisplay",
  mainInterface: "main-interface",
  wrongPageInterface: "wrong-page-interface",
  navigateToFlowButton: "navigateToFlowButton",
  startFromInput: "startFromInput",
  languageSelector: "languageSelector",
  repeatCountInput: "repeatCountInput",
  minInitialWaitTimeInput: "minInitialWaitTime",
  maxInitialWaitTimeInput: "maxInitialWaitTime",
  failedPromptsDisplay: "failedPromptsDisplay",
  copyFailedButton: "copyFailedButton",
  failedSummary: "failedSummary",
  autoDownloadCheckbox: "autoDownloadCheckbox",
  downloadSaveModeSelector: "downloadSaveModeSelector",
  openDownloadsSettingsLink: "openDownloadsSettingsLink",
  wrongPageMessageElement: "wrong-page-message",
  modeSelector: "modeSelector",
  imageModeContainer: "imageModeContainer",
  imageInput: "imageInput",
  uploadImageButton: "uploadImageButton",
  imageFileSummary: "imageFileSummary",
  imageCount: "imageCount",
  imagePromptPairsContainer: "imagePromptPairs",
  promptListTitle: "promptListTitle",
  promptContainer: "promptContainer",
  aspectRatioSelector: "aspectRatioSelector",
  modelSelector: "modelSelector",
  omniDurationLabel: "omniDurationLabel",
  omniDurationSelector: "omniDurationSelector",
  imageSortSelector: "imageSortSelector",
  frameModeContainer: "frameModeContainer",
  frameModeSelector: "frameModeSelector",
  frameModeHint: "frameModeHint",
  openQueueButton: "openQueueButton",
  queueTaskCount: "queueTaskCount",
  addToQueueButton: "addToQueueButton",
  clearQueueButton: "clearQueueButton",
  queueModalOverlay: "queueModalOverlay",
  closeQueueModal: "closeQueueModal",
  queueListDisplay: "queue-list-display",
  queueTableBody: "queueTableBody",
  jobDownloadFolderInput: "jobDownloadFolderInput",
  confirmClearQueueModal: "confirmClearQueueModal",
  confirmClearQueueButton: "confirmClearQueueButton",
  cancelClearQueueButton: "cancelClearQueueButton",
  queueResetAllButton: "queueResetAllButton",
  queueDeleteAllButton: "queueDeleteAllButton",
};

const ELEMENT_SELECTORS = {
  confirmClearQueueMessage: ".confirm-modal-message",
};

export const dom = Object.fromEntries(
  [...Object.keys(ELEMENT_IDS), ...Object.keys(ELEMENT_SELECTORS)].map(
    (key) => [key, null],
  ),
);

export function queryDOMElements() {
  for (const [key, id] of Object.entries(ELEMENT_IDS)) {
    dom[key] = document.getElementById(id);
  }
  for (const [key, selector] of Object.entries(ELEMENT_SELECTORS)) {
    dom[key] = document.querySelector(selector);
  }
}
