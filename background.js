/**
 * MV3 terminates this service worker after ~30s of inactivity, so the armed
 * capture cannot live in a module variable — it is kept in chrome.storage.session
 * (extension-only, cleared when the browser closes) and re-read on every event.
 */
const ARMED_KEY = "armedFlowDownload";
const ARM_TIMEOUT_MS = 60000;

async function readArmedDownload() {
  try {
    const stored = await chrome.storage.session.get(ARMED_KEY);
    return stored?.[ARMED_KEY] || null;
  } catch {
    return null;
  }
}

async function writeArmedDownload(armed) {
  try {
    if (armed) {
      await chrome.storage.session.set({ [ARMED_KEY]: armed });
    } else {
      await chrome.storage.session.remove(ARMED_KEY);
    }
  } catch {
    // A failed session write only costs us the capture, never the download.
  }
}

function isImageDownload(item) {
  const filename = String(item.filename || "").toLowerCase();
  const mime = String(item.mime || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    /\.(?:png|jpe?g|webp|gif|avif)$/i.test(filename)
  );
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    const armed = await readArmedDownload();
    if (!armed || Date.now() - armed.armedAt > ARM_TIMEOUT_MS) {
      if (armed) await writeArmedDownload(null);
      suggest();
      return;
    }
    if (Number.isInteger(armed.downloadId)) {
      suggest();
      return;
    }

    // Flow also emits thumbnail images; those must never consume the capture.
    if (isImageDownload(item)) {
      armed.rejectedDownloads = (armed.rejectedDownloads || 0) + 1;
      armed.lastRejected = {
        filename: item.filename || "",
        mime: item.mime || "",
      };
      await writeArmedDownload(armed);
      suggest();
      return;
    }

    armed.downloadId = item.id;
    armed.detectedAt = Date.now();
    armed.originalFilename = item.filename || "";
    armed.mime = item.mime || "";
    await writeArmedDownload(armed);
    suggest({
      filename: armed.filename,
      conflictAction: "uniquify",
    });
  })();
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ windowId: tab.windowId });
});

function searchDownload(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ item: items[0] || null });
    });
  });
}

function startDownload(options) {
  return new Promise((resolve) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError || !Number.isInteger(downloadId)) {
        resolve({
          error:
            chrome.runtime.lastError?.message ||
            "Chrome did not return a download ID.",
        });
        return;
      }
      resolve({ downloadId });
    });
  });
}

async function handleGetDownloadStatus(message) {
  if (!Number.isInteger(message.downloadId)) {
    return { success: false, error: "Invalid downloadId." };
  }
  const { item, error } = await searchDownload(message.downloadId);
  if (error) return { success: false, error };
  if (!item) return { success: false, error: "Download item not found." };
  return {
    success: true,
    state: item.state,
    error: item.error || "",
    filename: item.filename || "",
    bytesReceived: item.bytesReceived || 0,
    totalBytes: item.totalBytes || 0,
  };
}

async function handleDownloadFlowVideo(message) {
  if (!message.url || !message.filename) {
    return { success: false, error: "Missing video URL or target filename." };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(message.url);
  } catch {
    return { success: false, error: "Invalid Flow video URL." };
  }
  const hostAllowed =
    parsedUrl.hostname === "labs.google" ||
    parsedUrl.hostname.endsWith(".googleusercontent.com");
  const isThumbnail =
    parsedUrl.searchParams
      .get("mediaUrlType")
      ?.toUpperCase()
      .includes("THUMBNAIL") || /thumbnail/i.test(parsedUrl.pathname);
  if (parsedUrl.protocol !== "https:" || !hostAllowed || isThumbnail) {
    return {
      success: false,
      error:
        "Refused non-video or non-Google media URL to prevent saving a thumbnail.",
    };
  }

  const token =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeArmedDownload({
    token,
    filename: message.filename,
    saveAs: Boolean(message.saveAs),
    armedAt: Date.now(),
    downloadId: null,
    rejectedDownloads: 0,
    lastRejected: null,
    source: "direct-video-element",
  });

  const { downloadId, error } = await startDownload({
    url: parsedUrl.href,
    filename: message.filename,
    conflictAction: "uniquify",
    saveAs: Boolean(message.saveAs),
  });
  if (error) {
    const armed = await readArmedDownload();
    if (armed?.token === token) await writeArmedDownload(null);
    return { success: false, error };
  }

  // onDeterminingFilename may already have stamped the id; never clobber it.
  const armed = await readArmedDownload();
  if (armed?.token === token && !Number.isInteger(armed.downloadId)) {
    armed.downloadId = downloadId;
    armed.detectedAt = Date.now();
    await writeArmedDownload(armed);
  }
  return { success: true, token, downloadId };
}

async function handleGetFlowDownloadCapture(message) {
  const armed = await readArmedDownload();
  if (!armed || armed.token !== message.token) {
    return {
      success: false,
      state: "missing",
      error: "Flow download capture is no longer armed.",
    };
  }
  if (!Number.isInteger(armed.downloadId)) {
    if (Date.now() - armed.armedAt > ARM_TIMEOUT_MS) {
      const rejectedDetail = armed.lastRejected
        ? ` Last rejected: ${armed.lastRejected.mime || "unknown"} ${armed.lastRejected.filename || ""}.`
        : "";
      await writeArmedDownload(null);
      return {
        success: false,
        state: "timed_out",
        error: `Flow did not create a video download within 60 seconds.${rejectedDetail}`,
      };
    }
    return {
      success: true,
      state: "waiting",
      rejectedDownloads: armed.rejectedDownloads,
      lastRejected: armed.lastRejected,
    };
  }

  const { item, error } = await searchDownload(armed.downloadId);
  if (error) return { success: false, state: "search_error", error };
  if (!item) {
    return {
      success: false,
      state: "missing_item",
      error: "Captured Flow download item not found.",
    };
  }
  return {
    success: true,
    state: item.state,
    downloadId: item.id,
    error: item.error || "",
    filename: item.filename || "",
    originalFilename: armed.originalFilename,
    mime: item.mime || armed.mime || "",
    bytesReceived: item.bytesReceived || 0,
    totalBytes: item.totalBytes || 0,
    rejectedDownloads: armed.rejectedDownloads,
  };
}

async function handleCancelFlowDownloadCapture(message) {
  const armed = await readArmedDownload();
  if (!message.token || armed?.token === message.token) {
    await writeArmedDownload(null);
  }
  return { success: true };
}

const MESSAGE_HANDLERS = {
  getDownloadStatus: handleGetDownloadStatus,
  downloadFlowVideo: handleDownloadFlowVideo,
  getFlowDownloadCapture: handleGetFlowDownloadCapture,
  cancelFlowDownloadCapture: handleCancelFlowDownloadCapture,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "openDownloadsSettings") {
    chrome.tabs.create({ url: "chrome://settings/downloads" });
    return;
  }

  const handler = MESSAGE_HANDLERS[message?.type];
  if (!handler) return;

  handler(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ success: false, error: error?.message || String(error) });
    });
  return true;
});
