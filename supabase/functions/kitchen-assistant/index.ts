import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.99.2";
import { askProvider, validateProposal } from "./handler.ts";
const headers = {
  "Access-Control-Allow-Origin":
    Deno.env.get("APP_ORIGIN") ?? "https://ksuivash98.github.io",
  "Access-Control-Allow-Headers":
    "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
Deno.serve(async (req: Request) => {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "Используйте POST" });
  if (Deno.env.get("AI_ENABLED") !== "true")
    return reply(503, {
      error:
        "ИИ ещё не активирован владельцем сервера. Платный провайдер не подключён.",
    });
  const key = Deno.env.get("AI_PROVIDER_KEY"),
    model = Deno.env.get("AI_MODEL");
  if (!key || !model)
    return reply(503, {
      error: "Не настроены серверные AI_PROVIDER_KEY и AI_MODEL",
    });
  let admin: SupabaseClient | undefined,
    id: string | undefined,
    userId: string | undefined;
  try {
    const token = req.headers.get("Authorization");
    if (!token) return reply(401, { error: "Требуется вход" });
    const url = Deno.env.get("SUPABASE_URL")!,
      user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: token } },
      });
    const auth = await user.auth.getUser();
    if (auth.error || !auth.data.user)
      return reply(401, { error: "Сессия недействительна" });
    userId = auth.data.user.id;
    const text = await req.text();
    if (text.length > 20000)
      return reply(413, { error: "Запрос слишком большой" });
    const body = JSON.parse(text);
    id = body.id;
    if(typeof id!=="string"||!/^([0-9a-f]{8}-){1}[0-9a-f-]{27}$/i.test(id))return reply(400,{error:"Некорректный идентификатор запроса"});
    const input = body.input;
    if (
      !input ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.to) ||
      input.from > input.to
    )
      return reply(400, { error: "Проверьте период" });
    const reservation = await user.rpc("reserve_ai_request", {
      p_family: body.family_id,
      p_id: id,
      p_input: input,
    });
    if (reservation.error)
      return reply(403, { error: reservation.error.message });
    if (!reservation.data.fresh) {
      if (
        reservation.data.status === "ready" ||
        reservation.data.status === "applied"
      )
        return reply(200, { id, result: reservation.data.result });
      return reply(409, {
        error:
          "Этот запрос уже выполняется или завершился ошибкой. Повтор не отправлен провайдеру.",
      });
    }
    admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const state = await user.rpc("get_kitchen_state", {
      p_family: body.family_id,
      p_from: input.from,
      p_to: input.to,
      p_offset: 0,
    });
    if (state.error) throw new Error("Не удалось прочитать контекст семьи");
    if (
      Object.values(state.data).some((v) => Array.isArray(v) && v.length >= 200)
    )
      throw new Error("Контекст семьи слишком большой для одного ИИ-запроса");
    const recipes = [];
    for (let offset = 0; ; offset += 200) {
      const page = await user.rpc("get_recipe_page", {
        p_family: body.family_id,
        p_offset: offset,
      });
      if (page.error) throw new Error("Не удалось прочитать рецепты");
      recipes.push(...page.data);
      if (page.data.length < 200) break;
      if (recipes.length > 1000)
        throw new Error(
          "Для ИИ выберите меньшую семейную книгу (до 1000 рецептов)",
        );
    }
    const excluded = String(input.excluded ?? "")
      .split(/[,\n]/)
      .map((s: string) => s.trim().toLocaleLowerCase("ru"))
      .filter(Boolean);
    const allowed = recipes.filter(
      (r) =>
        !r.recipe_ingredients.some((i: { name: string }) =>
          excluded.includes(i.name.trim().toLocaleLowerCase("ru")),
        ),
    );
    const context: {
      recipes: unknown[];
      stock: unknown;
      preparations: unknown;
      preferences?: unknown;
    } = {
      recipes: allowed.map((r) => ({
        id: r.id,
        title: r.title,
        servings: r.servings,
        can_freeze: r.can_freeze,
        ingredients: r.recipe_ingredients.map(
          (i: { name: string; amount: number; unit: string }) => ({
            name: i.name,
            amount: i.amount,
            unit: i.unit,
          }),
        ),
      })),
      stock: state.data.stock_batches.map((b: Record<string, unknown>) => ({
        name: state.data.products.find(
          (p: Record<string, unknown>) => p.id === b.product_id,
        )?.name,
        quantity: b.quantity,
        unit: b.unit,
        expires_on: b.expires_on,
      })),
      preparations: state.data.preparations.map(
        (p: Record<string, unknown>) => ({
          title: p.title,
          quantity: p.quantity,
          unit: p.unit,
          expires_on: p.expires_on,
        }),
      ),
    };
    // Только явно согласившиеся участники; имена/идентификаторы в контекст предпочтений не включаются.
    if (input.include_preferences) {
      const prefs = await admin
        .from("family_preferences")
        .select("preferences")
        .eq("family_id", body.family_id)
        .contains("preferences", { ai_consent: true });
      if (prefs.error) throw new Error("Не удалось проверить согласия");
      context.preferences = prefs.data.map((p) => p.preferences);
    }
    const raw = await askProvider(key, model, context, input);
    const result = validateProposal(
      raw,
      new Set(allowed.map((r) => r.id)),
      input.from,
      input.to,
      input.mode === "menu",
    );
    const saved = await admin
      .from("ai_requests")
      .update({ status: "ready", result })
      .eq("id", id)
      .eq("user_id", userId);
    if (saved.error) throw new Error("Не удалось сохранить предложение");
    return reply(200, { id, result });
  } catch {
    if (admin && id && userId)
      await admin
        .from("ai_requests")
        .update({ status: "failed" })
        .eq("id", id)
        .eq("user_id", userId);
    return reply(502, {
      error:
        "Не удалось завершить ИИ-запрос. Данные кухни не изменены. Проверьте серверные настройки.",
    });
  }
});
