// IndexedDB preserves File/Blob attachments. Account-scoped keys never contain tokens.
const cache = new Map<string, unknown>(),
  versions = new Map<string, number>();
const accounts = new Map<string, number>();
export function draftGeneration(key: string) {
  return accounts.get(key.split(":")[0]) ?? 0;
}
function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > 12) cache.delete(cache.keys().next().value!);
}
let database: Promise<IDBDatabase> | null = null;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("collabspace-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Draft storage blocked"));
  }));
}
export function cachedDraft<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
export async function loadDraft<T>(key: string): Promise<T | undefined> {
  if (cache.has(key)) return cachedDraft<T>(key);
  const version = versions.get(key) ?? 0;
  const accountVersion = draftGeneration(key);
  try {
    const database = await db();
    const result = await new Promise<{ value: T; updatedAt: number } | undefined>(
      (resolve, reject) => {
        const request = database.transaction("drafts", "readonly").objectStore("drafts").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    if (accountVersion !== draftGeneration(key)) return undefined;
    if (version !== (versions.get(key) ?? 0)) return cachedDraft<T>(key);
    if (result && Date.now() - result.updatedAt < 7 * 86400000) {
      remember(key, result.value);
      return result.value;
    }
  } catch {
    /* Browsers with storage disabled retain drafts for this tab. */
  }
  return undefined;
}
export function storeDraft<T>(key: string, value: T, generation = draftGeneration(key)) {
  if (generation !== draftGeneration(key)) return false;
  remember(key, value);
  versions.set(key, (versions.get(key) ?? 0) + 1);
  void db()
    .then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          if (generation !== draftGeneration(key)) {
            resolve();
            return;
          }
          const transaction = database.transaction("drafts", "readwrite");
          transaction.objectStore("drafts").put({ key, value, updatedAt: Date.now() });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        }),
    )
    .catch(() => { /* Memory already holds the draft; restricted IndexedDB is an optional persistence fallback. */ });
  return true;
}
export async function clearAccountDrafts(userId: string) {
  accounts.set(userId, (accounts.get(userId) ?? 0) + 1);
  const prefix = `${userId}:`;
  for (const key of cache.keys())
    if (key.startsWith(prefix)) {
      cache.delete(key);
      versions.set(key, (versions.get(key) ?? 0) + 1);
    }
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts"),
        request = store.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) store.delete(cursor.key);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    /* Local cache has already been cleared. */
  }
}
