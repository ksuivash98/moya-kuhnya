import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const owner = "11111111-1111-4111-8111-111111111111";
const adult = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const child = "44444444-4444-4444-8444-444444444444";
let db: PGlite;
let family: string;
let otherFamily: string;
let token: string;
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function scalar(sql: string, params: unknown[] = []) {
  const r = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(r.rows[0] ?? {})[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated; create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610280001_foundation.sql", "utf8"),
  );
  for (const id of [owner, adult, stranger, child])
    await db.query("insert into auth.users(id) values($1)", [id]);
  await asUser(owner);
  family = (await scalar("select public.create_family($1)", [
    "Наша семья",
  ])) as string;
  await asUser(stranger);
  otherFamily = (await scalar("select public.create_family($1)", [
    "Другая семья",
  ])) as string;
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe(
  "Семейные пространства — настоящая PostgreSQL и RLS",
  () => {
    test("регистрация создаёт профиль, создание семьи назначает владельца", async () => {
      await asUser(owner);
      expect(
        await scalar("select count(*)::int from public.profiles where id=$1", [
          owner,
        ]),
      ).toBe(1);
      expect(
        await scalar(
          "select role from public.family_members where family_id=$1",
          [family],
        ),
      ).toBe("owner");
    });
    test("другая семья не видит чужую семью, участников, профили и журнал", async () => {
      await asUser(stranger);
      expect(
        await scalar("select count(*)::int from public.families where id=$1", [
          family,
        ]),
      ).toBe(0);
      expect(
        await scalar(
          "select count(*)::int from public.family_members where family_id=$1",
          [family],
        ),
      ).toBe(0);
      expect(
        await scalar("select count(*)::int from public.profiles where id=$1", [
          owner,
        ]),
      ).toBe(0);
      expect(
        await scalar(
          "select count(*)::int from public.family_activity where family_id=$1",
          [family],
        ),
      ).toBe(0);
    });
    test("нельзя вступить без действительного приглашения или создать его чужой семье", async () => {
      await asUser(stranger);
      await expect(
        db.query("select public.create_invitation($1,$2)", [family, "adult"]),
      ).rejects.toThrow("Только владелец");
      await expect(
        db.query("select public.join_family($1)", ["неверный код"]),
      ).rejects.toThrow("недействительно");
    });
    test("взрослый вступает по одноразовому коду; токены недоступны напрямую", async () => {
      await asUser(owner);
      token = (await scalar("select public.create_invitation($1,$2)", [
        family,
        "adult",
      ])) as string;
      expect(token).toHaveLength(64);
      await expect(
        db.query("select * from public.family_invitations"),
      ).rejects.toThrow("permission denied");
      await asUser(adult);
      expect(await scalar("select public.join_family($1)", [token])).toBe(
        family,
      );
      expect(await scalar("select public.can_edit_family($1)", [family])).toBe(
        true,
      );
    });
    test("повторное использование кода невозможно", async () => {
      await asUser(child);
      await expect(
        db.query("select public.join_family($1)", [token]),
      ).rejects.toThrow("недействительно");
    });
    test("взрослый не может повышать права и приглашать участников", async () => {
      await asUser(adult);
      await expect(
        db.query("select public.manage_member($1,$2,$3,false,false)", [
          family,
          adult,
          "owner",
        ]),
      ).rejects.toThrow("Недостаточно прав");
      await expect(
        db.query("update public.family_members set role=$1 where user_id=$2", [
          "owner",
          adult,
        ]),
      ).rejects.toThrow("permission denied");
    });
    test("ребёнок по умолчанию только читает; владелец может разрешить редактирование", async () => {
      await asUser(owner);
      const code = await scalar("select public.create_invitation($1,$2)", [
        family,
        "child",
      ]);
      await asUser(child);
      await scalar("select public.join_family($1)", [code]);
      expect(await scalar("select public.can_edit_family($1)", [family])).toBe(
        false,
      );
      expect(
        await scalar(
          "select count(*)::int from public.family_members where family_id=$1",
          [family],
        ),
      ).toBe(3);
      await asUser(owner);
      await db.query("select public.manage_member($1,$2,$3,true,false)", [
        family,
        child,
        "child",
      ]);
      await asUser(child);
      expect(await scalar("select public.can_edit_family($1)", [family])).toBe(
        true,
      );
    });
    test("владелец защищён от удаления и понижения роли", async () => {
      await asUser(owner);
      await expect(
        db.query("select public.manage_member($1,$2,$3,false,true)", [
          family,
          owner,
          "adult",
        ]),
      ).rejects.toThrow("владельца");
    });
    test("отозванные и просроченные коды не работают", async () => {
      await asUser(owner);
      const revoked = await scalar("select public.create_invitation($1,$2)", [
        family,
        "adult",
      ]);
      await db.query("select public.revoke_invitations($1)", [family]);
      await asUser(stranger);
      await expect(
        db.query("select public.join_family($1)", [revoked]),
      ).rejects.toThrow("недействительно");
      await asUser(owner);
      const expired = await scalar("select public.create_invitation($1,$2)", [
        family,
        "adult",
      ]);
      await db.exec(
        "reset role;update public.family_invitations set expires_at=now()-interval '1 day'",
      );
      await asUser(stranger);
      await expect(
        db.query("select public.join_family($1)", [expired]),
      ).rejects.toThrow("недействительно");
    });
    test("удалённый участник теряет доступ, история сохраняется", async () => {
      await asUser(owner);
      await db.query("select public.manage_member($1,$2,$3,false,true)", [
        family,
        child,
        "child",
      ]);
      await asUser(child);
      expect(await scalar("select public.is_family_member($1)", [family])).toBe(
        false,
      );
      expect(
        await scalar(
          "select count(*)::int from public.family_activity where family_id=$1",
          [family],
        ),
      ).toBe(0);
      await asUser(owner);
      expect(
        Number(
          await scalar(
            "select count(*)::int from public.family_activity where family_id=$1",
            [family],
          ),
        ),
      ).toBeGreaterThan(2);
    });
    test("предпочтения видит только их автор; чужие данные изменить нельзя", async () => {
      await asUser(owner);
      await db.query(
        "insert into public.family_preferences(family_id,user_id,preferences) values($1,$2,$3)",
        [family, owner, { likes: ["суп"] }],
      );
      await asUser(adult);
      expect(
        await scalar(
          "select count(*)::int from public.family_preferences where family_id=$1",
          [family],
        ),
      ).toBe(0);
      await expect(
        db.query(
          "insert into public.family_preferences(family_id,user_id) values($1,$2)",
          [otherFamily, adult],
        ),
      ).rejects.toThrow("row-level security");
    });
    test("анонимный запрос не читает семейные данные и не вызывает RPC", async () => {
      await db.exec("reset role;set role anon");
      await expect(db.query("select * from public.families")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        db.query("select public.create_family('Чужая семья')"),
      ).rejects.toThrow("permission denied");
    });
  },
);
