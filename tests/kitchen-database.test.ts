import { beforeAll, afterAll, test, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite, family: string, recipe: string, menu: string, task: string;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
async function user(id = owner) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function scalar(sql: string, p: unknown[] = []) {
  const r = await db.query<Record<string, unknown>>(sql, p);
  return Object.values(r.rows[0])[0];
}
const op = (
  action: string,
  data: Record<string, unknown>,
  key = crypto.randomUUID(),
) =>
  db.query("select public.kitchen_mutate($1,$2,$3,$4)", [
    family,
    key,
    action,
    data,
  ]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`,
  );
  for (const file of [
    "202610280001_foundation.sql",
    "202610280002_recipes.sql",
    "202610290003_planning.sql",
    "202610290004_inventory.sql",
    "202610290005_shopping_budget.sql",
    "202610290006_assistant.sql",
    "202610290007_notifications.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into auth.users(id)values($1),($2)", [owner, other]);
  await user();
  family = (await scalar(
    "select public.create_family('Тестовая кухня')",
  )) as string;
  recipe = crypto.randomUUID();
  await db.query("select public.save_recipe($1,$2,$3,null)", [
    recipe,
    family,
    {
      title: "Сырники",
      category: "Завтраки",
      prep: 10,
      cook: 20,
      servings: 4,
      difficulty: "Легко",
      ingredients: [
        { id: crypto.randomUUID(), name: "Творог", amount: "500", unit: "г" },
      ],
      steps: [{ id: crypto.randomUUID(), text: "Приготовить" }],
    },
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
test("меню без даты переносится в календарь той же записью; версия защищает от потери правок", async () => {
  menu = crypto.randomUUID();
  const d = {
    id: menu,
    recipe_id: recipe,
    month: "2099-01-01",
    date: "",
    meal: "Завтрак",
    servings: 4,
    planned_count: 2,
    status: "Запланировано",
  };
  await op("menu_save", d);
  await op("menu_save", { ...d, date: "2099-01-02", version: 1 });
  expect(await scalar("select count(*)::int from public.menu_items")).toBe(1);
  await expect(op("menu_save", { ...d, version: 1 })).rejects.toThrow(
    "другом устройстве",
  );
  expect(
    await scalar("select date::text from public.menu_items where id=$1", [
      menu,
    ]),
  ).toBe("2099-01-02");
});
test("план хранит снимок рецепта и выбранные шаги", async () => {
  task = crypto.randomUUID();
  await op("task_save", {
    id: task,
    recipe_id: recipe,
    menu_id: menu,
    date: "2099-01-02",
    servings: 4,
    status: "Запланировано",
    planned_preparations: 2,
    checked_steps: [],
  });
  expect(
    await scalar(
      "select recipe_snapshot->>'title' from public.cooking_tasks where id=$1",
      [task],
    ),
  ).toBe("Сырники");
});
test("недостаток запасов откатывает всё приготовление", async () => {
  await expect(
    op("cook_confirm", {
      task_id: task,
      version: 1,
      date: "2099-01-02",
      servings: 4,
      eaten: 2,
      fridge: 1,
      frozen: 1,
      usage_confirmed: true,
      usage: [{ name: "Творог", amount: 500, unit: "г" }],
    }),
  ).rejects.toThrow("Недостаточно");
  expect(await scalar("select count(*)::int from public.cooking_events")).toBe(
    0,
  );
});
test("готовка списывает FEFO и создаёт заготовки ровно один раз", async () => {
  await db.exec("reset role");
  const pid = crypto.randomUUID();
  await db.query(
    "insert into public.products(id,family_id,name,name_key)values($1,$2,$3,$4)",
    [pid, family, "Творог", "творог"],
  );
  for (const [q, date] of [
    [300, "2099-02-01"],
    [400, "2099-03-01"],
  ])
    await db.query(
      "insert into public.stock_batches(family_id,product_id,quantity,unit,expires_on)values($1,$2,$3,$4,$5)",
      [family, pid, q, "г", date],
    );
  await user();
  const key = crypto.randomUUID(),
    d = {
      task_id: task,
      version: 1,
      date: "2099-01-02",
      servings: 4,
      eaten: 1,
      fridge: 1,
      frozen: 2,
      usage_confirmed: true,
      usage: [{ name: "Творог", amount: 0.5, unit: "кг" }],
    };
  await op("cook_confirm", d, key);
  await op("cook_confirm", d, key);
  expect(await scalar("select count(*)::int from public.cooking_events")).toBe(
    1,
  );
  expect(
    Number(await scalar("select sum(quantity) from public.stock_batches")),
  ).toBe(200);
  expect(
    Number(
      await scalar(
        "select quantity from public.stock_batches where expires_on='2099-02-01'",
      ),
    ),
  ).toBe(0);
  expect(
    Number(await scalar("select sum(quantity) from public.preparations")),
  ).toBe(3);
  await expect(op("cook_confirm", d)).rejects.toThrow("уже подтверждена");
});
test("RLS и права защищают всю кухню другой семьи, прямые записи закрыты", async () => {
  await user(other);
  expect(await scalar("select count(*)::int from public.menu_items")).toBe(0);
  await expect(
    db.query("select public.get_kitchen_state($1,$2,$3,0)", [
      family,
      "2099-01-01",
      "2099-01-31",
    ]),
  ).rejects.toThrow("недоступно");
  await expect(op("menu_save", {})).rejects.toThrow("Нет права");
  await user();
  await expect(
    db.query("update public.stock_batches set quantity=-1"),
  ).rejects.toThrow("permission denied");
});
test("заготовка частично используется без повторного списания ингредиентов", async () => {
  const prep = (
    await db.query<{ id: string; version: number }>(
      "select id,version from public.preparations where quantity=2",
    )
  ).rows[0];
  const before = await scalar("select sum(quantity) from public.stock_batches");
  const key = crypto.randomUUID(),
    d = {
      id: prep.id,
      version: prep.version,
      quantity: 0.5,
      reason: "Использование",
      date: "2099-01-03",
    };
  await op("prep_use", d, key);
  await op("prep_use", d, key);
  expect(
    Number(
      await scalar("select quantity from public.preparations where id=$1", [
        prep.id,
      ]),
    ),
  ).toBe(1.5);
  expect(await scalar("select sum(quantity) from public.stock_batches")).toBe(
    before,
  );
  await expect(
    op("prep_use", { ...d, version: 2, quantity: 99 }),
  ).rejects.toThrow("не превышать");
});
test("ручная партия и корректировки сохраняют журнал; кг не теряются", async () => {
  const pid = crypto.randomUUID(),
    bid = crypto.randomUUID();
  await op("product_save", {
    id: pid,
    name: "Мука",
    category: "Другое",
    unit: "г",
    minimum: 100,
  });
  await op("batch_save", {
    id: bid,
    product_id: pid,
    quantity: 2,
    unit: "кг",
    purchased_on: "2099-01-01",
    expires_on: "2099-05-01",
  });
  expect(
    Number(
      await scalar("select quantity from public.stock_batches where id=$1", [
        bid,
      ]),
    ),
  ).toBe(2000);
  await op("batch_save", {
    id: bid,
    version: 1,
    product_id: pid,
    quantity: 1500,
    unit: "г",
    purchased_on: "2099-01-01",
    reason: "Списание",
  });
  expect(
    Number(
      await scalar(
        "select sum(quantity) from public.stock_movements where batch_id=$1",
        [bid],
      ),
    ),
  ).toBe(1500);
});
test("покупка оприходует фактическое количество и расход один раз; компенсация сохраняет журнал", async () => {
  const product = (
    await db.query<{ id: string }>(
      "select id from public.products where name='Мука'",
    )
  ).rows[0].id;
  const item = crypto.randomUUID();
  await op("shopping_save", {
    id: item,
    product_id: product,
    quantity: 2,
    unit: "кг",
    month: "2099-01-01",
    status: "open",
  });
  const key = crypto.randomUUID(),
    d = {
      id: item,
      version: 1,
      quantity: 3,
      unit: "кг",
      amount: "300.10",
      date: "2099-01-05",
    };
  await op("purchase_confirm", d, key);
  await op("purchase_confirm", d, key);
  expect(await scalar("select count(*)::int from public.purchases")).toBe(1);
  expect(
    Number(
      await scalar(
        "select quantity from public.stock_batches where notes='Покупка'",
      ),
    ),
  ).toBe(3000);
  expect(
    Number(await scalar("select sum(amount)from public.financial_movements")),
  ).toBe(300.1);
  const buy = (await scalar("select id from public.purchases")) as string;
  await op("purchase_reverse", { id: buy });
  expect(
    Number(await scalar("select sum(amount)from public.financial_movements")),
  ).toBe(0);
  expect(
    await scalar("select count(*)::int from public.financial_movements"),
  ).toBe(2);
});
test("денежные корректировки, бюджет и расчёт потребности точны", async () => {
  const expense = crypto.randomUUID();
  await op("expense_save", {
    id: expense,
    title: "Продукты",
    category: "Другое",
    amount: "0.10",
    date: "2099-01-02",
  });
  await op("expense_save", {
    id: expense,
    version: 1,
    title: "Продукты",
    category: "Другое",
    amount: "0.30",
    date: "2099-01-02",
  });
  await op("budget_save", { month: "2099-01-01", amount: 100 });
  const summary = (await scalar(
    "select public.kitchen_finance_summary($1,$2,$3)",
    [family, "2099-01-01", "2099-01-31"],
  )) as { spent: number; remaining: number };
  expect(Number(summary.spent)).toBe(0.3);
  expect(Number(summary.remaining)).toBe(99.7);
  const need = (
    await db.query<{ name: string; missing: string }>(
      "select * from public.kitchen_requirements($1,$2)",
      [family, "2099-01-01"],
    )
  ).rows;
  expect(Number(need.find((n) => n.name === "творог")?.missing)).toBe(300);
});
test("ИИ-запрос повторяется без повторной резервации, предложение не пишет меню без принятия", async () => {
  const id = crypto.randomUUID(),
    input = { mode: "menu", from: "2099-01-01", to: "2099-01-31" };
  const first = (await scalar("select public.reserve_ai_request($1,$2,$3)", [
    family,
    id,
    input,
  ])) as { fresh: boolean };
  const second = (await scalar("select public.reserve_ai_request($1,$2,$3)", [
    family,
    id,
    input,
  ])) as { fresh: boolean };
  expect(first.fresh).toBe(true);
  expect(second.fresh).toBe(false);
  await db.exec("reset role");
  await db.query(
    "update public.ai_requests set status='ready',result=$2 where id=$1",
    [id, { summary: "Тест", items: [] }],
  );
  await user();
  const key = crypto.randomUUID(),
    items = [
      { recipe_id: recipe, date: "2099-01-10", meal: "Ужин", servings: 2 },
    ];
  await scalar("select public.apply_ai_menu($1,$2,$3,$4)", [
    family,
    id,
    key,
    items,
  ]);
  await scalar("select public.apply_ai_menu($1,$2,$3,$4)", [
    family,
    id,
    key,
    items,
  ]);
  expect(
    await scalar(
      "select count(*)::int from public.menu_items where date='2099-01-10'",
    ),
  ).toBe(1);
});
test("напоминания не дублируются и доступны только своему пользователю", async () => {
  await db.query("select public.refresh_kitchen_notifications($1)", [family]);
  await db.query("select public.refresh_kitchen_notifications($1)", [family]);
  await db.exec("reset role");
  await db.exec(
    "update public.stock_batches set expires_on=(timezone('Asia/Yekaterinburg',now())::date)+1 where quantity>0",
  );
  await user();
  await db.query("select public.refresh_kitchen_notifications($1)", [family]);
  const n = Number(
    await scalar("select count(*)::int from public.notifications"),
  );
  expect(n).toBeGreaterThan(0);
  await db.query("select public.refresh_kitchen_notifications($1)", [family]);
  expect(
    Number(await scalar("select count(*)::int from public.notifications")),
  ).toBe(n);
  await user(other);
  expect(await scalar("select count(*)::int from public.notifications")).toBe(
    0,
  );
  await expect(
    db.query("select public.refresh_kitchen_notifications($1)", [family]),
  ).rejects.toThrow("недоступна");
  await user();
});
