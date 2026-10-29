import { cacheGet, cachePut, enqueue, queueAll } from "../offline/store";
import { overlay } from "../offline/sync";
import { client, check } from "../supabase";
import { type State, type Row } from "./model";
export async function loadKitchen(
  family: string,
  from: string,
  to: string,
): Promise<State> {
  const session = await client().auth.getSession();
  const user = session.data.session?.user.id;
  if (!user) throw new Error("Войдите в аккаунт");
  const kind = `kitchen:${from}:${to}`;
  if (!navigator.onLine)
    return overlay(
      await cacheGet<State>(user, family, kind),
      await queueAll(user),
      family,
    );
  let result: State = { schema_version: 4 };
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client().rpc("get_kitchen_state", {
      p_family: family,
      p_from: from,
      p_to: to,
      p_offset: offset,
    });
    check(error);
    const page = data as State;
    let more = false;
    for (const [key, value] of Object.entries(page)) {
      if (Array.isArray(value)) {
        result[key] = [...((result[key] ?? []) as Row[]), ...value];
        if (value.length === 200) more = true;
      } else result[key] = value;
    }
    if (!more) break;
  }
  try {
    await cachePut(user, family, kind, result);
  } catch {
    /* Ошибка локального кэша не отменяет чтение БД. */
  }
  return overlay(result, await queueAll(user).catch(() => []), family);
}
export async function mutate(
  family: string,
  action: string,
  data: Record<string, unknown>,
  key: string,
) {
  if (!navigator.onLine) {
    const session = await client().auth.getSession();
    const user = session.data.session?.user.id;
    if (!user) throw new Error("Войдите в аккаунт");
    if (action === "menu_save" || action === "task_save") {
      const cached = await cacheGet<import("../recipes/model").Recipe[]>(
        user,
        family,
        "recipes",
      );
      const recipe = cached.find((r) => r.id === data.recipe_id);
      if (!recipe) throw new Error("Нет офлайн-копии выбранного рецепта");
      data = {
        ...data,
        title: recipe.data.title,
        recipe_version: recipe.version,
        recipe_snapshot: {
          title: recipe.data.title,
          servings: recipe.data.servings,
          ingredients: recipe.data.ingredients.map((i) => ({
            ...i,
            amount: i.unit === "по вкусу" ? null : Number(i.amount),
          })),
          steps: recipe.data.steps.map((s) => ({ ...s, description: s.text })),
        },
      };
    }
    await enqueue(user, family, action, data, key);
    return { queued: true };
  }
  const { data: result, error } = await client().rpc("kitchen_mutate", {
    p_family: family,
    p_key: key,
    p_action: action,
    p_data: data,
  });
  check(error);
  return result as { id?: string; queued?: boolean };
}
