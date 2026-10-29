export type Cached<T = unknown> = {
  key: string;
  user: string;
  family: string;
  kind: string;
  value: T;
  at: number;
};
export type Queued = {
  id: string;
  user: string;
  family: string;
  action: string;
  data: Record<string, unknown>;
  state: "pending" | "blocked";
  attempts: number;
  error?: string;
  at: number;
};
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("moya-kuhnya-offline", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("cache", { keyPath: "key" });
      r.result.createObjectStore("queue", { keyPath: "id" });
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
  });
}
async function run<T>(
  table: "cache" | "queue",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, mode),
      req = fn(tx.objectStore(table));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
const key = (user: string, family: string, kind: string) =>
  `${user}:${family}:${kind}`;
export async function cachePut<T>(
  user: string,
  family: string,
  kind: string,
  value: T,
) {
  if (!user) return;
  await run("cache", "readwrite", (s) =>
    s.put({
      key: key(user, family, kind),
      user,
      family,
      kind,
      value,
      at: Date.now(),
    }),
  );
  if (kind.startsWith("photo:")) {
    const all = await run<Cached[]>("cache", "readonly", (s) => s.getAll());
    const photos = all
      .filter((r) => r.user === user && r.kind.startsWith("photo:"))
      .sort((a, b) => b.at - a.at);
    for (const r of photos.filter(
      (r, i) => i >= 20 || Date.now() - r.at > 86400000,
    ))
      await run("cache", "readwrite", (s) => s.delete(r.key));
  }
}
export async function cacheGet<T>(
  user: string,
  family: string,
  kind: string,
): Promise<T> {
  const r = await run<Cached<T> | undefined>("cache", "readonly", (s) =>
    s.get(key(user, family, kind)),
  );
  if (!r || Date.now() - r.at > 86400000) {
    if (r) await run("cache", "readwrite", (s) => s.delete(r.key));
    throw new Error(
      "На этом устройстве нет свежей копии данных (срок — 24 часа). Подключитесь к интернету.",
    );
  }
  return r.value;
}
export async function purgeUser(user: string) {
  for (const table of ["cache", "queue"] as const) {
    const all = await run<(Cached | Queued)[]>(table, "readonly", (s) =>
      s.getAll(),
    );
    for (const r of all.filter((r) => r.user === user))
      await run(table, "readwrite", (s) => s.delete("key" in r ? r.key : r.id));
  }
}
export async function purgeFamily(user: string, family: string) {
  const all = await run<Cached[]>("cache", "readonly", (s) => s.getAll());
  for (const r of all.filter((r) => r.user === user && r.family === family))
    await run("cache", "readwrite", (s) => s.delete(r.key));
}
export async function queueAll(user: string) {
  const all = await run<Queued[]>("queue", "readonly", (s) => s.getAll());
  return all.filter((q) => q.user === user).sort((a, b) => a.at - b.at);
}
export const queueSave = (q: Queued) =>
  run("queue", "readwrite", (s) => s.put(q));
export const queueRemove = (id: string) =>
  run("queue", "readwrite", (s) => s.delete(id));
export async function enqueue(
  user: string,
  family: string,
  action: string,
  data: Record<string, unknown>,
  id: string,
) {
  if (
    !["menu_save", "task_save", "favorite"].includes(action) ||
    data.status === "Приготовлено"
  )
    throw new Error(
      "Эту операцию нельзя сохранить офлайн. Нужна связь с сервером.",
    );
  const all = await queueAll(user);
  const existing = all.find(
    (q) =>
      q.family === family &&
      q.action === action &&
      q.data.id === data.id &&
      q.state === "pending" &&
      q.attempts === 0,
  );
  await queueSave({
    id: existing?.id ?? id,
    user,
    family,
    action,
    data,
    state: "pending",
    attempts: 0,
    at: existing?.at ?? Date.now(),
  });
  window.dispatchEvent(new Event("kitchen-queue"));
}
