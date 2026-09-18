window.SkoomaStore = (() => {
  const DB_NAME = "skooma-multitool";
  const DB_VERSION = 1;
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = work(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function saveProject(project) {
    return tx("projects", "readwrite", store => store.put(project));
  }

  async function getProject(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction("projects", "readonly").objectStore("projects").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listProjects() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction("projects", "readonly").objectStore("projects").getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteProject(id) {
    return tx("projects", "readwrite", store => store.delete(id));
  }

  async function saveAsset(asset) {
    return tx("assets", "readwrite", store => store.put(asset));
  }

  async function deleteAsset(id) {
    return tx("assets", "readwrite", store => store.delete(id));
  }

  async function clearAssets() {
    return tx("assets", "readwrite", store => store.clear());
  }

  async function listAssets() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction("assets", "readonly").objectStore("assets").getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  return { saveProject, getProject, listProjects, deleteProject, saveAsset, deleteAsset, clearAssets, listAssets };
})();