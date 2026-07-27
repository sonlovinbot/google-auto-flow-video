# Coachio Video Flow

**Coachio Video Flow** is a Chrome extension designed to automate video creation workflows on Google's Flow AI (Veo). It helps users streamline bulk prompt processing, manage queues, and auto-download generated videos.

## Flow UI compatibility (v8.4.2)

- Supports the current Slate prompt editor instead of the retired textarea UI.
- Supports Frames, Omni Flash, Veo 3.1 Lite/Fast/Quality, 9:16/16:9 and 1-4 outputs.
- Uses a model-specific setup profile: Omni Flash selects 4 or 6 seconds, while
  Veo 3.1 Lite/Fast/Quality use Flow's model-managed duration.
- Supports automatic downloads into each job folder or a Save As prompt for
  every generated video.
- Creates one editable image/prompt row for every selected image.
- Submits each image upload once, then waits up to 120 seconds for large files
  instead of retrying during Flow's silent upload window and creating duplicates.
- Ignores stale global `Failed` cards from older Flow outputs; an upload failure
  must be newly associated with the current filename before it can trigger a
  retry, and upload/frame retries stay on the current page.
- Confirms the selected First frame through Flow's required **Add to Prompt**
  action before writing the prompt and submitting Create.
- Copies the complete visible session log together with extension/project
  metadata and detailed failed-task records in one diagnostic report.
- Tracks generated videos for up to 8 minutes and identifies completed output
  cards by Flow's stable `data-tile-id`.
- Downloads the `currentSrc` of the `<video>` inside the exact matching card,
  avoiding synthetic menu clicks that Chrome may reject.
- Uses a 500 ms hot scan while a job is active and starts downloading as soon
  as a new card exposes a real video URL; it no longer waits for the element to
  finish buffering (`readyState >= 2`).
- Video URLs are validated in both the Flow page and background worker;
  thumbnail redirect URLs are never downloaded or treated as completed videos.

## Coachio side-panel design

- Four focused tabs: Create, Queue, Logs, and Settings.
- Creation view shows the active profile without duplicating default controls.
- Queue management is a first-class tab instead of a blocking modal.
- Image and prompt rows include a clickable thumbnail for replacing one image
  while preserving that row's edited prompt.
- Responsive layouts are verified at 450 px and 340 px side-panel widths.
- Completes a job only after Chrome confirms the captured file is a real video
  and its download state is complete.
- Uses state-based UI waits and a 3-6 second queue pace instead of the old 30-60 second fixed delay.
- Scans for completed media immediately, then every 2 seconds.
- Shows a 10-second heartbeat with elapsed time, scan count, ready-video count,
  and active-download count; three consecutive download failures stop the task.
- Logs every settings step with elapsed time and a bounded DOM diagnostic on failure.

## Features

- **Bulk Prompt Processing**: Queue multiple prompts or images for automated generation.
- **Auto-Queue Management**: Automatically manages the generation queue, handling "queue full" states and retries.
- **Auto-Download**: Automatically downloads generated videos to your specified folder.
- **Multi-Mode Support**: Supports both Text-to-Video and Image-to-Video generation modes.
- **Configurable Settings**: Customize repeat counts, aspect ratios, Omni Flash/Veo 3.1 models, and pacing timers.

## Installation

1.  Download the extension files.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the folder containing the extension files.

## Usage

1.  Open Google Flow AI.
2.  Open the Side Panel by clicking the extension icon.
3.  **For Text-to-Video**: Enter your prompts in the text area (one per line or block).
4.  **For Image-to-Video**: Upload your images and (optional) prompts.
5.  Configure your settings (Aspect Ratio, Model, Repeats).
6.  Click **Add to Queue**.
7.  Click **Start Queue** and let the automation handle the rest!

## When Google changes the Flow UI

The automation drives Flow through XPath and CSS selectors that match the page's
visible controls, so a Google redesign can break a step. Those selectors live in
[`flow-selectors.json`](flow-selectors.json) — edit that file and reload the
extension to repair it.

To patch without touching the files, store a full replacement set from the side
panel's devtools console:

```js
chrome.storage.local.set({
  selectorOverride: { selectors: { /* all keys from flow-selectors.json */ } },
});
```

The override is used only when it contains every required key; an incomplete one
is ignored with a warning and the bundled set is used instead. Remove it with
`chrome.storage.local.remove("selectorOverride")`.

## Development

```bash
npm test
```

The suite covers prompt parsing, image/prompt pairing, download-path
sanitisation, video discovery, the armed-download capture (including a simulated
service-worker restart), selector loading, and translation coverage.

Notes for contributors:

- User-facing strings belong in `i18n.js`; a test fails the build if Vietnamese
  is hardcoded in the panel modules or if a translation key is unused.
- The functions in `injector.js` are serialised into the Flow page's MAIN world
  and cannot call `i18n()`. Their trace messages are developer diagnostics and
  are intentionally left untranslated.
- `background.js` runs as an MV3 service worker and must keep no state in module
  scope; the armed download capture lives in `chrome.storage.session`.
