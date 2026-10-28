import type { RecipeData } from "./model";
export type Draft = {
  key: string;
  recipeId: string;
  data: RecipeData;
  files: [string, Blob][];
  version: number | null;
  updatedAt: number;
};
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("moya-kuhnya-recipe-drafts", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("drafts", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const req = fn(tx.objectStore("drafts"));
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
export const readDraft = (key: string) =>
  transaction<Draft | undefined>("readonly", (s) => s.get(key));
export const writeDraft = (draft: Draft) =>
  transaction("readwrite", (s) => s.put(draft));
export const removeDraft = (key: string) =>
  transaction("readwrite", (s) => s.delete(key));
