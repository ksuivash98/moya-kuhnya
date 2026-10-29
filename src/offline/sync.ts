import { client, check, errorText } from "../supabase";
import {
  queueAll,
  queueSave,
  queueRemove,
  purgeFamily,
  type Queued,
} from "./store";
let syncing: Promise<void> | null = null;
export function flushQueue(user: string) {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!navigator.onLine) return;
    for (const q of await queueAll(user)) {
      if (q.state === "blocked") continue;
      const session = await client().auth.getSession();
      if (session.data.session?.user.id !== user) return;
      try {
        const access = await client()
          .from("family_members")
          .select("user_id")
          .eq("family_id", q.family)
          .eq("user_id", user)
          .maybeSingle();
        check(access.error);
        if (!access.data) {
          await purgeFamily(user, q.family);
          throw new Error(
            "Доступ к семье отозван. Локальная операция не отправлена.",
          );
        }
        await queueSave({ ...q, attempts: q.attempts + 1 });
        if (q.action === "favorite") {
          const r = await client().rpc("set_recipe_favorite", {
            p_recipe: q.data.id,
            p_value: q.data.value,
          });
          check(r.error);
        } else {
          const r = await client().rpc("kitchen_mutate", {
            p_family: q.family,
            p_key: q.id,
            p_action: q.action,
            p_data: q.data,
          });
          check(r.error);
        }
        await queueRemove(q.id);
      } catch (e) {
        const message = errorText(e),
          network = /fetch|network|связи|интернет/i.test(message);
        await queueSave({
          ...q,
          attempts: q.attempts + 1,
          state: network ? "pending" : "blocked",
          error: message,
        });
        if (network) break;
      }
    }
    window.dispatchEvent(new Event("kitchen-synced"));
  })().finally(() => {
    syncing = null;
    window.dispatchEvent(new Event("kitchen-queue"));
  });
  return syncing;
}
export function overlay<T>(state: T, queued: Queued[], family: string): T {
  const next = structuredClone(state) as Record<string, unknown>;
  for (const q of queued.filter((q) => q.family === family)) {
    const table =
      q.action === "menu_save"
        ? "menu_items"
        : q.action === "task_save"
          ? "cooking_tasks"
          : null;
    if (!table) continue;
    const list = (next[table] ?? []) as Record<string, unknown>[];
    const index = list.findIndex((r) => r.id === q.data.id);
    if (index >= 0) list[index] = { ...list[index], ...q.data };
    else
      list.push({
        ...q.data,
        family_id: family,
        version: 0,
        title: "Локально запланированное блюдо",
        recipe_snapshot: {},
      });
    next[table] = list;
  }
  return next as T;
}
