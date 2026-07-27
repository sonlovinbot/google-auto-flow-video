/**
 * Queued image files are too large for chrome.storage.local, so the queue keeps
 * only {id, name, type} metadata and the File blobs live here in IndexedDB.
 */
const DB_NAME = "AutoFlowDB";
const DB_VERSION = 1;
const STORE_NAME = "imageStore";

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error("IndexedDB open error:", event.target.error);
      dbPromise = null;
      reject(event.target.error);
    };
  });
  return dbPromise;
}

async function runRequest(mode, operation, errorLabel) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    const request = operation(store);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error(`IndexedDB ${errorLabel} error:`, event.target.error);
      reject(event.target.error);
    };
  });
}

/** Stores the blob and returns the serialisable handle kept in the queue. */
export async function saveImage(file) {
  const id = crypto.randomUUID();
  await runRequest("readwrite", (store) => store.put({ id, file }), "put");
  return { id, name: file.name, type: file.type };
}

export async function getImage(id) {
  const record = await runRequest(
    "readonly",
    (store) => store.get(id),
    "get",
  );
  return record?.file || null;
}

export async function deleteImage(id) {
  await runRequest(
    "readwrite",
    (store) => store.delete(id),
    "delete file",
  );
}

export async function clearAllImages() {
  await runRequest("readwrite", (store) => store.clear(), "clear");
}
