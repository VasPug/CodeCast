const DB_NAME = "codepodcast";
const STORE = "podcasts";
const VERSION = 1;

export type StoredTurn = {
  speaker: "A" | "B";
  text: string;
  codeRef: { path: string; startLine: number; endLine: number };
  snippet: string;
  audioBlob: Blob;
  mimeType: string;
  durationMs: number;
};

export type StoredPodcast = {
  id: string;
  title: string;
  createdAt: number;
  turns: StoredTurn[];
};

export type PodcastSummary = {
  id: string;
  title: string;
  createdAt: number;
  turnCount: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB tx failed"));
      }),
  );
}

export async function savePodcast(podcast: StoredPodcast): Promise<void> {
  await tx("readwrite", (s) => s.put(podcast));
}

export async function getPodcast(id: string): Promise<StoredPodcast | null> {
  const result = await tx<StoredPodcast | undefined>("readonly", (s) => s.get(id));
  return result ?? null;
}

export async function deletePodcast(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function listPodcasts(): Promise<PodcastSummary[]> {
  const all = await tx<StoredPodcast[]>("readonly", (s) => s.getAll());
  return all
    .map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt, turnCount: p.turns.length }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function newPodcastId(): string {
  return `pod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
