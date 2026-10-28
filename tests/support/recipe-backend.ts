// Только тесты: Supabase HTTP-контракт поверх настоящих SQL-миграций в PGlite.
// Это не production API и не проверка реального Supabase Auth/Storage-сервиса.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import {
  blankRecipe,
  blankIngredient,
  blankStep,
  type RecipeData,
} from "../../src/recipes/model";
const owner = "11111111-1111-4111-8111-111111111111",
  child = "44444444-4444-4444-8444-444444444444";
export async function recipeBackend(
  page: Page,
  role: "owner" | "child" = "owner",
) {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner_id text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`,
  );
  for (const file of [
    "202610280001_foundation.sql",
    "202610280002_recipes.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const id of [owner, child])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id,
        { display_name: id === owner ? "Тестовый пользователь" : "Ребёнок" },
      ],
    );
  async function asUser(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  await asUser(owner);
  const family = (
    await db.query<{ create_family: string }>(
      "select public.create_family('Семья для теста')",
    )
  ).rows[0].create_family;
  const code = (
    await db.query<{ create_invitation: string }>(
      "select public.create_invitation($1,$2)",
      [family, "child"],
    )
  ).rows[0].create_invitation;
  await asUser(child);
  await db.query("select public.join_family($1)", [code]);
  const user = role === "owner" ? owner : child;
  const storedUser = {
    id: user,
    aud: "authenticated",
    role: "authenticated",
    email: "kitchen@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {
      display_name: role === "owner" ? "Тестовый пользователь" : "Ребёнок",
    },
    created_at: new Date().toISOString(),
  };
  const now = Math.floor(Date.now() / 1000),
    payload = {
      sub: user,
      role: "authenticated",
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
    };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`;
  await page.addInitScript(
    (session) => {
      if (!localStorage.getItem("sb-recipe-tests-auth-token"))
        localStorage.setItem(
          "sb-recipe-tests-auth-token",
          JSON.stringify(session),
        );
    },
    {
      access_token: token,
      refresh_token: "test-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user: storedUser,
    },
  );
  await page.routeWebSocket("**/realtime/v1/websocket*", (socket) =>
    socket.close(),
  );
  const bytes = new Map<string, Buffer>();
  let queue = Promise.resolve();
  async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      await asUser(id);
      return await fn();
    } finally {
      release();
    }
  }
  const fulfill = (
    route: Route,
    json: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(json),
      headers,
    });
  const filter = (url: URL, name: string) =>
    url.searchParams.get(name)?.replace(/^eq\./, "");
  await page.route("https://recipe-tests.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    try {
      await locked(user, async () => {
        if (url.pathname === "/auth/v1/user") {
          await fulfill(route, storedUser);
          return;
        }
        if (url.pathname === "/auth/v1/logout") {
          await route.fulfill({ status: 204 });
          return;
        }
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const name = url.pathname.split("/").pop()!,
            body = req.postDataJSON() as Record<string, unknown>;
          const keys: Record<string, string[]> = {
            get_recipe_page: ["p_family", "p_offset"],
            save_recipe: ["p_id", "p_family", "p_data", "p_version"],
            set_recipe_favorite: ["p_recipe", "p_value"],
            archive_recipe: ["p_recipe", "p_version"],
            open_recipe: ["p_recipe"],
          };
          if (!keys[name]) throw new Error(`Неожиданный RPC ${name}`);
          const result = await db.query<Record<string, unknown>>(
            `select public.${name}(${keys[name].map((_, i) => `$${i + 1}`).join(",")})`,
            keys[name].map((k) => body[k]),
          );
          await fulfill(route, result.rows[0][name]);
          return;
        }
        if (url.pathname.startsWith("/rest/v1/")) {
          const table = url.pathname.split("/").pop()!;
          let rows: unknown[] = [];
          if (table === "family_members") {
            const where = filter(url, "user_id")
              ? "m.user_id=$1"
              : "m.family_id=$1";
            rows = (
              await db.query(
                `select m.*,json_build_object('name',f.name) families,json_build_object('display_name',p.display_name) profiles from public.family_members m join public.families f on f.id=m.family_id join public.profiles p on p.id=m.user_id where ${where}`,
                [filter(url, "user_id") ?? filter(url, "family_id")],
              )
            ).rows;
          } else if (table === "family_activity")
            rows = (
              await db.query(
                "select * from public.family_activity where family_id=$1 order by created_at desc limit 5",
                [filter(url, "family_id")],
              )
            ).rows;
          else if (table === "recipe_favorites")
            rows = (
              await db.query(
                "select recipe_id from public.recipe_favorites where user_id=$1",
                [user],
              )
            ).rows;
          else if (table === "recipes") {
            rows = (
              await db.query(
                `select r.*,coalesce((select json_agg(i order by i.position) from public.recipe_ingredients i where i.recipe_id=r.id),'[]'::json) recipe_ingredients,coalesce((select json_agg(s order by s.position) from public.recipe_steps s where s.recipe_id=r.id),'[]'::json) recipe_steps from public.recipes r where r.family_id=$1 and r.deleted_at is null order by created_at desc`,
                [filter(url, "family_id")],
              )
            ).rows;
            if (req.method() === "HEAD") {
              await route.fulfill({
                status: 200,
                headers: { "content-range": `*/${rows.length}` },
              });
              return;
            }
          } else if (table === "profiles")
            rows = (
              await db.query("select * from public.profiles where id=$1", [
                filter(url, "id"),
              ])
            ).rows;
          else throw new Error(`Неожиданная таблица ${table}`);
          const offset = Number(url.searchParams.get("offset") ?? 0),
            limit = Number(url.searchParams.get("limit") ?? 1000);
          await fulfill(route, rows.slice(offset, offset + limit));
          return;
        }
        const prefix = "/storage/v1/object/";
        if (url.pathname.startsWith(prefix)) {
          let path = decodeURIComponent(url.pathname.slice(prefix.length));
          if (req.method() === "DELETE") {
            const { prefixes } = req.postDataJSON() as { prefixes: string[] };
            const removed = [];
            for (const p of prefixes) {
              const result = await db.query(
                "delete from storage.objects where bucket_id=$1 and name=$2 returning name",
                ["recipe-photos", p],
              );
              if (result.rows.length) {
                bytes.delete(p);
                removed.push({ name: p });
              }
            }
            await fulfill(route, removed);
            return;
          }
          if (path.startsWith("sign/")) {
            path = path.slice("sign/recipe-photos/".length);
            const found = (
              await db.query(
                "select name from storage.objects where bucket_id=$1 and name=$2",
                ["recipe-photos", path],
              )
            ).rows.length;
            if (!found) throw new Error("Фото недоступно");
            if (req.method() === "POST") {
              await fulfill(route, {
                signedURL: `/object/sign/recipe-photos/${path}?token=test-signed`,
              });
              return;
            }
            const buffer = bytes.get(path);
            if (!buffer) throw new Error("Фото не найдено");
            await route.fulfill({
              status: 200,
              contentType: "image/jpeg",
              body: buffer,
            });
            return;
          }
          if (req.method() === "POST") {
            path = path.slice("recipe-photos/".length);
            let buffer = req.postDataBuffer()!;
            const contentType = req.headers()["content-type"] ?? "";
            if (contentType.includes("multipart/form-data")) {
              const form = await new Request("https://example.test", {
                method: "POST",
                headers: { "content-type": contentType },
                body: buffer,
              }).formData();
              const file = [...form.values()].find(
                (v) => typeof v !== "string",
              );
              if (!file || typeof file === "string")
                throw new Error("Нет файла");
              buffer = Buffer.from(await file.arrayBuffer());
            }
            const result = await db.query<{ id: string }>(
              "insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3) returning id",
              ["recipe-photos", path, user],
            );
            bytes.set(path, buffer);
            await fulfill(route, {
              Id: result.rows[0].id,
              Key: `recipe-photos/${path}`,
            });
            return;
          }
        }
        throw new Error(`Неожиданный запрос ${req.method()} ${url.pathname}`);
      });
    } catch (e) {
      await fulfill(
        route,
        {
          message: e instanceof Error ? e.message : "Ошибка тестового API",
          code: "TEST_API",
        },
        400,
      );
    }
  });
  return {
    family,
    bytes,
    close: () => db.close(),
    query: <T extends Record<string, unknown>>(
      sql: string,
      args: unknown[] = [],
    ) => locked(owner, () => db.query<T>(sql, args)),
    save: async (
      title = "Тестовый рецепт",
      version: number | null = null,
      id = crypto.randomUUID(),
    ) =>
      locked(owner, async () => {
        const data: RecipeData = {
          ...blankRecipe(),
          title,
          ingredients: [
            { ...blankIngredient(), name: "Творог", amount: "500" },
          ],
          steps: [{ ...blankStep(), text: "Смешать" }],
        };
        await db.query("select public.save_recipe($1,$2,$3,$4)", [
          id,
          family,
          data,
          version,
        ]);
        return { id, data };
      }),
  };
}
