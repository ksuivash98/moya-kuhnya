import { createClient } from "npm:@supabase/supabase-js@2.99.2";
import { createImportHandler, recognize, type ImportActor } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const userClient = (actor: ImportActor) =>
  createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: actor.token } },
  });
const key = Deno.env.get("AI_PROVIDER_KEY"),
  model = Deno.env.get("AI_IMPORT_MODEL");
Deno.serve(
  createImportHandler({
    origin: Deno.env.get("APP_ORIGIN") ?? "https://ksuivash98.github.io",
    enabled:
      Deno.env.get("AI_IMPORT_ENABLED") === "true" && Boolean(key && model),
    async authenticate(token) {
      const auth = await userClient({ userId: "", token }).auth.getUser();
      return auth.error || !auth.data.user
        ? null
        : { userId: auth.data.user.id, token };
    },
    async reserve(actor, input, hash) {
      const r = await userClient(actor).rpc("reserve_recipe_import", {
        p_family: input.family_id,
        p_id: input.id,
        p_kind: input.source.kind,
        p_hash: hash,
      });
      if (r.error) throw r.error;
      return r.data;
    },
    async complete(actor, input, result) {
      const admin = createClient(
        url,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const r = await admin
        .from("recipe_import_requests")
        .update({ status: result ? "ready" : "failed", result })
        .eq("id", input.id)
        .eq("family_id", input.family_id)
        .eq("user_id", actor.userId)
        .eq("status", "pending")
        .select("id");
      if (r.error || r.data?.length !== 1)
        throw new Error("Не удалось сохранить результат");
    },
    recognize: (source) => recognize(key!, model!, source),
  }),
);
