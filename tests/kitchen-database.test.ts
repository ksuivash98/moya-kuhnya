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
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`,
  );
  for (const file of [
    "202610280001_foundation.sql",
    "202610280002_recipes.sql",
    "202610290003_planning.sql",
    "202610290004_inventory.sql",
    "202610290005_shopping_budget.sql",
    "202610290006_assistant.sql",
    "202610290007_notifications.sql",
    "202610290008_sync_guards.sql",
    "202610290009_recipe_import.sql",
    "202610310010_recipe_freezing.sql",
    "202610310011_shopping_categories.sql",
    "202610310012_clear_shopping.sql",
    "202610310013_clear_planning.sql",
    "202611010014_recipe_categories.sql",
    "202611010015_recipe_multiple_categories.sql",
  ]) {
    if (file === "202610310011_shopping_categories.sql")
      await db.exec(`
      insert into public.families(id,name) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Старая семья');
      insert into public.products(id,family_id,name,name_key,category) values
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','лимон','лимон','Другое'),
      ('ffffffff-ffff-4fff-8fff-ffffffffffff','dddddddd-dddd-4ddd-8ddd-dddddddddddd','соль','соль','Мясо');
      insert into public.shopping_items(family_id,product_id,quantity,unit,month,status,category) values
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1,'шт.','2099-10-01','open','Другое'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',2,'шт.','2099-10-01','purchased','Другое'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','ffffffff-ffff-4fff-8fff-ffffffffffff',3,'г','2099-10-01','open','Другое');
    `);
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  }
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
test("офлайн-снимок рецепта защищён версией и чужие семейные идентификаторы не принимаются", async () => {
  await expect(
    op("menu_save", {
      id: crypto.randomUUID(),
      recipe_id: recipe,
      recipe_version: 999,
      month: "2099-01-01",
      date: "2099-01-20",
      meal: "Ужин",
      servings: 4,
      planned_count: 1,
      status: "Запланировано",
    }),
  ).rejects.toThrow("офлайн-копии");
});
test("параллельное использование заготовки не уводит остаток в минус", async () => {
  const p = (
    await db.query<{ id: string; version: number; quantity: string }>(
      "select id,version,quantity from public.preparations where quantity>0 limit 1",
    )
  ).rows[0];
  const attempt = {
    id: p.id,
    version: p.version,
    quantity: p.quantity,
    reason: "Списание",
    date: "2099-01-03",
  };
  const result = await Promise.allSettled([
    op("prep_use", attempt),
    op("prep_use", attempt),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    Number(
      await scalar("select quantity from public.preparations where id=$1", [
        p.id,
      ]),
    ),
  ).toBe(0);
});
test("все новые семейные реестры изолированы RLS, включая деньги, историю и ИИ", async () => {
  await user(other);
  for (const table of [
    "storage_places",
    "products",
    "stock_batches",
    "stock_movements",
    "menu_items",
    "cooking_tasks",
    "cooking_events",
    "preparations",
    "preparation_movements",
    "preparation_uses",
    "kitchen_operations",
    "shopping_items",
    "purchases",
    "expenses",
    "financial_movements",
    "monthly_budgets",
    "ai_requests",
    "notifications",
    "notification_preferences",
  ])
    expect(
      Number(await scalar(`select count(*)::int from public.${table}`)),
    ).toBe(0);
  await expect(
    db.query("select public.reserve_ai_request($1,$2,$3)", [
      family,
      crypto.randomUUID(),
      { mode: "recommend" },
    ]),
  ).rejects.toThrow("взрослым");
  await user();
});
test("импорт: ключ запроса идемпотентен, исходник не сохраняется, чужая семья и ребёнок отклоняются", async () => {
  await user();
  const id = crypto.randomUUID(),
    hash = "a".repeat(64);
  const reserve = (key = id, digest = hash) =>
    scalar("select public.reserve_recipe_import($1,$2,'text',$3)", [
      family,
      key,
      digest,
    ]);
  expect(await reserve()).toMatchObject({ fresh: true, status: "pending" });
  expect(await reserve()).toMatchObject({ fresh: false, status: "pending" });
  await expect(reserve(id, "b".repeat(64))).rejects.toThrow("использован");
  await expect(
    db.query(
      "insert into public.recipe_import_requests(id,family_id,user_id,source_kind,input_hash)values($1,$2,$3,'text',$4)",
      [crypto.randomUUID(), family, owner, hash],
    ),
  ).rejects.toThrow();
  await expect(
    db.query("delete from public.recipe_import_requests where id=$1", [id]),
  ).rejects.toThrow();
  await user(other);
  expect(
    await scalar("select count(*)::int from public.recipe_import_requests"),
  ).toBe(0);
  await expect(reserve(crypto.randomUUID())).rejects.toThrow("взрослым");
  await db.exec("reset role");
  await db.query(
    "insert into public.family_members(family_id,user_id,role,child_can_edit)values($1,$2,'child',true)",
    [family, other],
  );
  await user(other);
  await expect(reserve(crypto.randomUUID())).rejects.toThrow("взрослым");
  expect(
    await scalar("select count(*)::int from public.recipe_import_requests"),
  ).toBe(0);
  await db.exec("reset role");
  await db.query(
    "update public.family_members set role='adult'where family_id=$1 and user_id=$2",
    [family, other],
  );
  await user(other);
  expect(
    await scalar("select count(*)::int from public.recipe_import_requests"),
  ).toBe(0);
  await expect(
    db.query(
      "update public.recipe_import_requests set status='ready'where id=$1",
      [id],
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query(
    "delete from public.family_members where family_id=$1 and user_id=$2",
    [family, other],
  );
  await user();
});
test("импорт: квота учитывает неудачные запросы во всех семьях пользователя", async () => {
  await user();
  const second = await scalar(
    "select public.create_family('Вторая тестовая семья')",
  );
  for (let n = 0; n < 4; n++)
    await db.query("select public.reserve_recipe_import($1,$2,'photo',$3)", [
      n % 2 ? family : second,
      crypto.randomUUID(),
      "c".repeat(64),
    ]);
  await db.exec("reset role");
  await db.query(
    "update public.recipe_import_requests set status='failed'where user_id=$1",
    [owner],
  );
  await user();
  await expect(
    db.query("select public.reserve_recipe_import($1,$2,'text',$3)", [
      second,
      crypto.randomUUID(),
      "d".repeat(64),
    ]),
  ).rejects.toThrow("5 распознаваний");
  expect(
    await scalar("select count(*)::int from public.recipe_import_requests"),
  ).toBe(5);
});

test("категории: словарь различает продукты и не угадывает неизвестные смеси", async () => {
  await user();
  for (const [name, category] of [
    [" ЧЁРНЫЙ   МОЛОТЫЙ ПЕРЕЦ ", "Специи"],
    ["соль", "Специи"],
    ["лимон", "Фрукты"],
    ["лук репчатый", "Овощи"],
    ["болгарский перец", "Овощи"],
    ["творог", "Молочные продукты"],
    ["масло", "Другое"],
    ["соус из лимона и перца", "Другое"],
  ])
    expect(
      await scalar("select public.suggest_product_category($1)", [name]),
    ).toBe(category);
});
test("категории покупок: ручной выбор, пересчёт, идемпотентность и неизменная история", async () => {
  await user();
  const rid = crypto.randomUUID(),
    mid = crypto.randomUUID();
  await db.query("select public.save_recipe($1,$2,$3,null)", [
    rid,
    family,
    {
      title: "Лимон для категорий",
      category: "Другие",
      prep: 0,
      cook: 1,
      servings: 1,
      difficulty: "Легко",
      ingredients: [
        { id: crypto.randomUUID(), name: "лимон", amount: "1", unit: "шт." },
      ],
      steps: [{ id: crypto.randomUUID(), text: "Нарезать" }],
    },
  ]);
  await op("menu_save", {
    id: mid,
    recipe_id: rid,
    month: "2099-11-01",
    date: "",
    meal: "Другое",
    servings: 1,
    planned_count: 1,
    status: "Запланировано",
  });
  await op("shopping_generate", { month: "2099-11-01" });
  const get = () =>
    db.query<{
      id: string;
      product_id: string;
      version: number;
      category: string;
    }>(
      "select * from public.shopping_items where family_id=$1 and month='2099-11-01' and status='open'",
      [family],
    );
  let item = (await get()).rows[0];
  expect(item.category).toBe("Фрукты");
  await op("purchase_confirm", {
    id: item.id,
    version: item.version,
    quantity: 1,
    unit: "шт.",
    amount: "10",
    date: "2099-11-02",
  });
  // Ещё одна открытая позиция того же продукта.
  const id = crypto.randomUUID();
  await op("shopping_save", {
    id,
    product_id: item.product_id,
    quantity: 2,
    unit: "шт.",
    month: "2099-11-01",
    status: "open",
  });
  item = (await get()).rows[0];
  const key = crypto.randomUUID();
  const edit = {
    ...item,
    month: "2099-11-01",
    quantity: 2,
    unit: "шт.",
    status: "open",
    category: "Другое",
  };
  await op("shopping_save_categorized", edit, key);
  const version = (await get()).rows[0].version;
  await op("shopping_save_categorized", edit, key);
  expect((await get()).rows[0].version).toBe(version);
  expect(
    await scalar("select category_manual from public.products where id=$1", [
      item.product_id,
    ]),
  ).toBe(true);
  expect((await get()).rows[0].category).toBe("Другое");
  expect(
    await scalar(
      "select category from public.expenses where title='лимон' order by date desc limit 1",
    ),
  ).toBe("Фрукты");
  expect(
    await scalar(
      "select category from public.shopping_items where product_id=$1 and status='purchased'",
      [item.product_id],
    ),
  ).toBe("Фрукты");
  await op("shopping_generate", { month: "2099-11-01" });
  expect((await get()).rows.every((r) => r.category === "Другое")).toBe(true);
  await expect(
    op("shopping_save_categorized", {
      ...edit,
      version,
      category: "Несуществующая",
    }),
  ).rejects.toThrow("Выберите категорию");
  await expect(
    db.query("select public._finance_action($1,$2,$3,$4)", [
      family,
      crypto.randomUUID(),
      "shopping_save_categorized",
      edit,
    ]),
  ).rejects.toThrow("permission denied");
  await user(other);
  await expect(op("shopping_save_categorized", edit)).rejects.toThrow(
    "Нет права",
  );
  await user();
});

test("миграция категорий исправляет старые открытые позиции и сохраняет выбранное и историю", async () => {
  await db.exec("reset role");
  const items = (
    await db.query<{
      name: string;
      category: string;
      status: string;
      quantity: number;
    }>(
      "select p.name,s.category,s.status,s.quantity from public.shopping_items s join public.products p on p.id=s.product_id where s.family_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' order by s.quantity",
    )
  ).rows;
  expect(
    items.map((i) => [i.name, i.category, i.status, Number(i.quantity)]),
  ).toEqual([
    ["лимон", "Фрукты", "open", 1],
    ["лимон", "Другое", "purchased", 2],
    ["соль", "Мясо", "open", 3],
  ]);
  await user();
});

test("очистка покупок атомарна, повторяема и сохраняет другие месяцы, новые позиции и финансовую историю", async () => {
  await user();
  const product = crypto.randomUUID();
  await op("product_save", {
    id: product,
    name: "Тест очистки",
    unit: "г",
    minimum: 0,
    category: "Другое",
    archived: false,
  });
  const add = async (month = "2099-12-01") => {
    const id = crypto.randomUUID();
    await op("shopping_save", {
      id,
      product_id: product,
      quantity: 1,
      unit: "г",
      month,
      status: "open",
    });
    return { id, version: 1 };
  };
  const items = [];
  for (let i = 0; i < 25; i++) items.push(await add());
  const anotherMonth = await add("2099-10-01");
  const purchased = await add();
  await op("purchase_confirm", {
    ...purchased,
    quantity: 1,
    unit: "г",
    amount: "10",
    date: "2099-12-02",
  });
  const snapshot = () =>
    scalar(
      "select jsonb_build_object('paid',(select jsonb_agg(to_jsonb(p)) from public.purchases p where family_id=$1),'money',(select jsonb_agg(to_jsonb(m)) from public.financial_movements m where family_id=$1),'stock',(select jsonb_agg(to_jsonb(b)) from public.stock_batches b where family_id=$1))",
      [family],
    );
  const before = await snapshot();
  await expect(
    op("shopping_clear", {
      month: "2099-12-01",
      items: [...items.slice(0, -1), { ...items[24], version: 99 }],
    }),
  ).rejects.toThrow("другом устройстве");
  expect(
    await scalar(
      "select count(*)::int from public.shopping_items where month='2099-12-01' and status='open'",
    ),
  ).toBe(25);
  await expect(
    op("shopping_clear", {
      month: "2099-12-01",
      items: [items[0], anotherMonth],
    }),
  ).rejects.toThrow("другом устройстве");
  await expect(
    op("shopping_clear", { month: "2099-12-01", items: [items[0], items[0]] }),
  ).rejects.toThrow("Некорректный");
  const addedLater = await add();
  const key = crypto.randomUUID();
  const payload = { month: "2099-12-01", items };
  await op("shopping_clear", payload, key);
  await op("shopping_clear", payload, key);
  expect(
    await scalar(
      "select count(*)::int from public.shopping_items where month='2099-12-01' and status='cancelled'",
    ),
  ).toBe(25);
  expect(
    await scalar("select status from public.shopping_items where id=$1", [
      anotherMonth.id,
    ]),
  ).toBe("open");
  expect(
    await scalar("select status from public.shopping_items where id=$1", [
      addedLater.id,
    ]),
  ).toBe("open");
  expect(
    await scalar("select status from public.shopping_items where id=$1", [
      purchased.id,
    ]),
  ).toBe("purchased");
  expect(await snapshot()).toEqual(before);
  await expect(
    db.query("select public._shopping_clear($1,$2)", [family, payload]),
  ).rejects.toThrow("permission denied");
  await user(other);
  await expect(op("shopping_clear", payload)).rejects.toThrow("Нет права");
  await user();
});

test.each(["menu_clear", "cooking_clear"])(
  "%s: отменяет весь месяц атомарно, сохраняя готовку и связанные записи",
  async (action) => {
    await user();
    const isMenu = action === "menu_clear";
    const table = isMenu ? "menu_items" : "cooking_tasks";
    const addMenu = async (period = "2098-05-01") => {
      const id = crypto.randomUUID();
      await op("menu_save", {
        id,
        recipe_id: recipe,
        month: period,
        date: "",
        meal: "Ужин",
        servings: 4,
        planned_count: 1,
        status: "Запланировано",
      });
      return { id, version: 1 };
    };
    const linkedMenu = isMenu ? null : await addMenu();
    const add = async (period = "2098-05-01", linked = false) => {
      if (isMenu) return addMenu(period);
      const id = crypto.randomUUID();
      await op("task_save", {
        id,
        recipe_id: recipe,
        date: period,
        servings: 4,
        status: "Запланировано",
        planned_preparations: 0,
        menu_id: linked ? linkedMenu!.id : "",
      });
      return { id, version: 1 };
    };
    const items = [];
    for (let i = 0; i < 25; i++) items.push(await add("2098-05-01", i === 0));
    let linkedTask: string | null = null;
    if (isMenu) {
      linkedTask = crypto.randomUUID();
      await op("task_save", {
        id: linkedTask,
        recipe_id: recipe,
        menu_id: items[0].id,
        date: "2098-05-01",
        servings: 4,
        status: "Запланировано",
        planned_preparations: 0,
      });
    }
    const otherMonth = await add("2098-06-01");
    const completed = await add();
    await op("cook_confirm", {
      [isMenu ? "menu_id" : "task_id"]: completed.id,
      version: 1,
      date: "2098-05-01",
      servings: 4,
      eaten: 4,
      fridge: 0,
      frozen: 0,
      usage_confirmed: true,
      usage: [{ name: "Творог", unit: "г", amount: 0 }],
    });
    const preserve = () =>
      scalar(
        "select jsonb_build_object('events',(select jsonb_agg(to_jsonb(e)) from public.cooking_events e where family_id=$1),'prep',(select jsonb_agg(to_jsonb(p)) from public.preparations p where family_id=$1),'stock',(select jsonb_agg(to_jsonb(b)) from public.stock_batches b where family_id=$1),'money',(select jsonb_agg(to_jsonb(m)) from public.financial_movements m where family_id=$1))",
        [family],
      );
    const before = await preserve();
    await expect(
      op(action, {
        month: "2098-05-01",
        items: [items[0], { id: completed.id, version: 2 }],
      }),
    ).rejects.toThrow("План изменён");
    expect(
      await scalar(`select status from public.${table} where id=$1`, [
        items[0].id,
      ]),
    ).toBe("Запланировано");
    await expect(
      op(action, {
        month: "2098-05-01",
        items: [...items.slice(0, 24), { ...items[24], version: 99 }],
      }),
    ).rejects.toThrow("План изменён");
    await expect(
      op(action, { month: "2098-05-01", items: [items[0], otherMonth] }),
    ).rejects.toThrow("План изменён");
    const later = await add();
    const key = crypto.randomUUID();
    const payload = { month: "2098-05-01", items };
    await op(action, payload, key);
    await op(action, payload, key);
    for (const item of items)
      expect(
        await scalar(`select status from public.${table} where id=$1`, [
          item.id,
        ]),
      ).toBe("Отменено");
    expect(
      await scalar(`select status from public.${table} where id=$1`, [
        otherMonth.id,
      ]),
    ).toBe("Запланировано");
    expect(
      await scalar(`select status from public.${table} where id=$1`, [
        later.id,
      ]),
    ).toBe("Запланировано");
    expect(
      await scalar(`select status from public.${table} where id=$1`, [
        completed.id,
      ]),
    ).toBe("Приготовлено");
    if (linkedTask)
      expect(
        await scalar("select status from public.cooking_tasks where id=$1", [
          linkedTask,
        ]),
      ).toBe("Запланировано");
    if (linkedMenu)
      expect(
        await scalar("select status from public.menu_items where id=$1", [
          linkedMenu.id,
        ]),
      ).toBe("Запланировано");
    expect(await preserve()).toEqual(before);
    await expect(
      db.query("select public._planning_clear($1,$2,$3)", [
        family,
        action,
        payload,
      ]),
    ).rejects.toThrow("permission denied");
    await user(other);
    await expect(op(action, payload)).rejects.toThrow("Нет права");
    await user();
  },
);

test("удаление продукта сохраняет историю, запрещено с остатком и чужой семье; восстановление проверяет версию", async () => {
  await user();
  const id = crypto.randomUUID(),
    batch = crypto.randomUUID();
  const product = {
    id,
    name: "Продукт для удаления",
    category: "Специи",
    unit: "г",
    minimum: 0,
  };
  await op("product_save", product);
  const stock = {
    id: batch,
    product_id: id,
    quantity: 5,
    unit: "г",
    purchased_on: "2099-01-01",
    reason: "Ручное добавление",
  };
  await op("batch_save", stock);
  await expect(
    op("product_save", { ...product, version: 1, archived: true }),
  ).rejects.toThrow("Сначала спишите");
  await op("batch_save", {
    ...stock,
    version: 1,
    quantity: 0,
    reason: "Списание",
  });
  const key = crypto.randomUUID();
  const deletion = { ...product, version: 1, archived: true };
  await op("product_save", deletion, key);
  await op("product_save", deletion, key);
  expect(
    await scalar("select archived from public.products where id=$1", [id]),
  ).toBe(true);
  expect(
    Number(
      await scalar(
        "select count(*) from public.stock_movements where batch_id=$1",
        [batch],
      ),
    ),
  ).toBe(2);
  expect(
    Number(
      await scalar("select quantity from public.stock_batches where id=$1", [
        batch,
      ]),
    ),
  ).toBe(0);
  await user(other);
  await expect(
    op("product_save", { ...product, version: 2, archived: false }),
  ).rejects.toThrow();
  await user();
  await expect(
    op("product_save", { ...product, version: 1, archived: false }),
  ).rejects.toThrow("изменён");
  await op("product_save", { ...product, version: 2, archived: false });
  expect(
    await scalar("select archived from public.products where id=$1", [id]),
  ).toBe(false);
});
