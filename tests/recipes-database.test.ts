import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  blankRecipe,
  blankIngredient,
  blankStep,
  type RecipeData,
} from "../src/recipes/model";
const owner = "11111111-1111-4111-8111-111111111111",
  adult = "22222222-2222-4222-8222-222222222222",
  stranger = "33333333-3333-4333-8333-333333333333",
  child = "44444444-4444-4444-8444-444444444444";
let db: PGlite,
  family: string,
  other: string,
  id = crypto.randomUUID(),
  version = 1;
let data: RecipeData;
let photo = "";
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function scalar(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(r.rows[0] ?? {})[0];
}
const save = (
  d: RecipeData = data,
  v: number | null = version,
  recipe = id,
  f = family,
) => db.query("select public.save_recipe($1,$2,$3,$4)", [recipe, f, d, v]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text not null,owner_id text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,delete on storage.objects to authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610280001_foundation.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202610280002_recipes.sql", "utf8"),
  );
  for (const id of [owner, adult, stranger, child])
    await db.query("insert into auth.users(id) values($1)", [id]);
  await user(owner);
  family = (await scalar(
    "select public.create_family('Наша семья')",
  )) as string;
  for (const [who, role] of [
    [adult, "adult"],
    [child, "child"],
  ]) {
    await user(owner);
    const code = await scalar("select public.create_invitation($1,$2)", [
      family,
      role,
    ]);
    await user(who);
    await scalar("select public.join_family($1)", [code]);
  }
  await user(stranger);
  other = (await scalar(
    "select public.create_family('Другая семья')",
  )) as string;
  await user(owner);
  data = {
    ...blankRecipe(),
    title: "Сырники",
    description: "Семейное блюдо",
    category: "Завтраки",
    prep: 10,
    cook: 20,
    servings: 4,
    freeze: true,
    shelfLife: "3 дня",
    storage: "В холодильнике",
    thaw: "Разогреть",
    notes: "Не спешить",
    source: "https://example.com/recipe",
    favorite: true,
    ingredients: [
      {
        ...blankIngredient(),
        name: "Творог",
        amount: "500",
        unit: "г",
        note: "9%",
      },
      { ...blankIngredient(), name: "Соль", unit: "по вкусу", amount: "" },
    ],
    steps: [
      { ...blankStep(), text: "Смешать" },
      { ...blankStep(), text: "Обжарить" },
    ],
  };
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Этап 2 — транзакции, сохранение, RLS и приватные фотографии", () => {
  test("создание сохраняет все поля, ингредиенты, шаги и личное избранное", async () => {
    await save(data, null);
    expect(
      await scalar("select title from public.recipes where id=$1", [id]),
    ).toBe("Сырники");
    expect(
      await scalar("select shelf_life from public.recipes where id=$1", [id]),
    ).toBe("3 дня");
    expect(
      await scalar(
        "select storage_conditions from public.recipes where id=$1",
        [id],
      ),
    ).toBe("В холодильнике");
    expect(
      await scalar("select thaw_instructions from public.recipes where id=$1", [
        id,
      ]),
    ).toBe("Разогреть");
    expect(
      await scalar(
        "select count(*)::int from public.recipe_ingredients where recipe_id=$1",
        [id],
      ),
    ).toBe(2);
    expect(
      await scalar(
        "select amount from public.recipe_ingredients where recipe_id=$1 and unit=$2",
        [id, "по вкусу"],
      ),
    ).toBeNull();
    expect(
      await scalar(
        "select count(*)::int from public.recipe_favorites where recipe_id=$1",
        [id],
      ),
    ).toBe(1);
  });
  test("чужая семья не видит рецепт и дочерние записи и не может менять или избрать его", async () => {
    await user(stranger);
    expect(
      await scalar("select public.get_recipe_page($1,0)", [family]),
    ).toEqual([]);
    for (const table of [
      "recipes",
      "recipe_ingredients",
      "recipe_steps",
      "recipe_favorites",
      "recipe_photos",
    ])
      expect(await scalar(`select count(*)::int from public.${table}`)).toBe(0);
    await expect(save(data, version, id, other)).rejects.toThrow("недоступен");
    await expect(save(data, version)).rejects.toThrow("Нет права");
    await expect(
      db.query("select public.set_recipe_favorite($1,true)", [id]),
    ).rejects.toThrow("недоступен");
    await expect(
      db.query("select public.open_recipe($1)", [id]),
    ).rejects.toThrow("недоступен");
  });
  test("взрослый читает и редактирует, добавляет и удаляет ингредиенты, меняет порядок шагов", async () => {
    await user(adult);
    expect(
      await scalar("select title from public.recipes where id=$1", [id]),
    ).toBe("Сырники");
    data = {
      ...data,
      title: "Нежные сырники",
      ingredients: [
        data.ingredients[0],
        { ...blankIngredient(), name: "Мука", amount: "100" },
      ],
      steps: [
        data.steps[1],
        data.steps[0],
        { ...blankStep(), text: "Подавать" },
      ],
      favorite: false,
    };
    await save();
    version++;
    expect(
      await scalar("select version from public.recipes where id=$1", [id]),
    ).toBe(version);
    expect(
      await scalar(
        "select description from public.recipe_steps where recipe_id=$1 and position=0",
        [id],
      ),
    ).toBe("Обжарить");
    expect(
      await scalar(
        "select count(*)::int from public.recipe_ingredients where recipe_id=$1 and name=$2",
        [id, "Соль"],
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_steps where recipe_id=$1",
        [id],
      ),
    ).toBe(3);
  });
  test("ошибка ингредиента откатывает заголовок, версию и дочерние таблицы целиком", async () => {
    await expect(
      save({
        ...data,
        title: "Не должно сохраниться",
        ingredients: [{ ...data.ingredients[0], amount: "0" }],
      }),
    ).rejects.toThrow();
    expect(
      await scalar("select title from public.recipes where id=$1", [id]),
    ).toBe("Нежные сырники");
    expect(
      await scalar("select version from public.recipes where id=$1", [id]),
    ).toBe(version);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_steps where recipe_id=$1",
        [id],
      ),
    ).toBe(3);
    await expect(
      save({
        ...data,
        ingredients: [{ ...data.ingredients[0], amount: "0.12345" }],
      }),
    ).rejects.toThrow("4 знаков");
  });
  test("повторное или устаревшее сохранение не перезаписывает чужую работу", async () => {
    await expect(
      save({ ...data, title: "Устаревший текст" }, version - 1),
    ).rejects.toThrow("другом устройстве");
    await expect(save(data, null)).rejects.toThrow("другом устройстве");
    expect(
      await scalar("select title from public.recipes where id=$1", [id]),
    ).toBe("Нежные сырники");
  });
  test("ребёнок читает и сохраняет личное избранное, но не редактирует и не удаляет", async () => {
    await user(child);
    expect(
      await scalar("select title from public.recipes where id=$1", [id]),
    ).toBe("Нежные сырники");
    await expect(save()).rejects.toThrow("Нет права");
    await expect(
      db.query("select public.archive_recipe($1,$2)", [id, version]),
    ).rejects.toThrow("Нет права");
    await db.query("select public.set_recipe_favorite($1,true)", [id]);
    await db.query("select public.set_recipe_favorite($1,true)", [id]);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_favorites where recipe_id=$1",
        [id],
      ),
    ).toBe(1);
    await db.query("select public.set_recipe_favorite($1,false)", [id]);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_favorites where recipe_id=$1",
        [id],
      ),
    ).toBe(0);
  });
  test("популярность считает просмотры без изменения версии рецепта", async () => {
    await db.query("select public.open_recipe($1)", [id]);
    expect(
      Number(
        await scalar("select views from public.recipes where id=$1", [id]),
      ),
    ).toBe(1);
    expect(
      await scalar("select version from public.recipes where id=$1", [id]),
    ).toBe(version);
  });
  test("прямые изменения таблиц запрещены даже взрослому", async () => {
    await user(adult);
    await expect(
      db.query("update public.recipes set title=$1 where id=$2", ["Обход", id]),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("delete from public.recipe_ingredients where recipe_id=$1", [
        id,
      ]),
    ).rejects.toThrow("permission denied");
  });
  test("Storage принимает только фото своей семьи; бакет приватный", async () => {
    await user(owner);
    photo = `${family}/${id}/${crypto.randomUUID()}.jpg`;
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)",
      ["recipe-photos", photo, owner],
    );
    await user(stranger);
    expect(
      await scalar("select count(*)::int from storage.objects where name=$1", [
        photo,
      ]),
    ).toBe(0);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "recipe-photos",
        `${family}/${id}/${crypto.randomUUID()}.jpg`,
      ]),
    ).rejects.toThrow("row-level security");
    await user(child);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "recipe-photos",
        `${family}/${id}/${crypto.randomUUID()}.jpg`,
      ]),
    ).rejects.toThrow("row-level security");
    await db.exec("reset role");
    expect(
      await scalar(
        "select public from storage.buckets where id='recipe-photos'",
      ),
    ).toBe(false);
    await user(owner);
  });
  test("фото блюда и шага сохраняются; привязанный файл нельзя удалить", async () => {
    data = {
      ...data,
      photo,
      steps: data.steps.map((s, i) => (i === 0 ? { ...s, photo } : s)),
    };
    await save();
    version++;
    expect(
      await scalar(
        "select count(*)::int from public.recipe_photos where recipe_id=$1",
        [id],
      ),
    ).toBe(1);
    expect(
      await scalar(
        "select photo_path from public.recipe_steps where recipe_id=$1 and position=0",
        [id],
      ),
    ).toBe(photo);
    await db.query("delete from storage.objects where name=$1", [photo]);
    expect(
      await scalar("select count(*)::int from storage.objects where name=$1", [
        photo,
      ]),
    ).toBe(1);
  });
  test("файл другого рецепта или несуществующий файл нельзя прикрепить", async () => {
    await expect(
      save({
        ...data,
        photo: `${family}/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`,
      }),
    ).rejects.toThrow("Фотография недоступна");
    await expect(
      save({ ...data, photo: `${family}/${id}/${crypto.randomUUID()}.jpg` }),
    ).rejects.toThrow("Фотография недоступна");
  });
  test("удаление фото из рецепта освобождает приватный объект для очистки", async () => {
    data = {
      ...data,
      photo: "",
      steps: data.steps.map((s) => ({ ...s, photo: "" })),
    };
    await save();
    version++;
    expect(
      await scalar(
        "select count(*)::int from public.recipe_photos where recipe_id=$1",
        [id],
      ),
    ).toBe(0);
    await db.query("delete from storage.objects where name=$1", [photo]);
    expect(
      await scalar("select count(*)::int from storage.objects where name=$1", [
        photo,
      ]),
    ).toBe(0);
  });
  test("архивирование сохраняет рецепт, ингредиенты, шаги и внешнюю историю", async () => {
    await db.exec(
      "reset role;create table history(recipe_id uuid references public.recipes(id))",
    );
    await db.query("insert into history values($1)", [id]);
    await user(owner);
    await db.query("select public.archive_recipe($1,$2)", [id, version]);
    expect(
      await scalar(
        "select count(*)::int from public.recipes where id=$1 and deleted_at is null",
        [id],
      ),
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_ingredients where recipe_id=$1",
        [id],
      ),
    ).toBe(2);
    expect(
      await scalar(
        "select count(*)::int from public.recipe_steps where recipe_id=$1",
        [id],
      ),
    ).toBe(3);
    await expect(save()).rejects.toThrow("недоступен");
    await db.exec("reset role");
    expect(
      await scalar("select count(*)::int from history where recipe_id=$1", [
        id,
      ]),
    ).toBe(1);
  });
  test("анонимный пользователь не читает рецепты, фото и не вызывает сохранение", async () => {
    await db.exec("reset role;set role anon");
    await expect(db.query("select * from public.recipes")).rejects.toThrow(
      "permission denied",
    );
    await expect(save()).rejects.toThrow("permission denied");
    await expect(db.query("select * from storage.objects")).rejects.toThrow(
      "permission denied",
    );
  });
});
