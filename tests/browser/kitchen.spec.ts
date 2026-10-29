import { test, expect } from "@playwright/test";
import { recipeBackend } from "../support/recipe-backend";
test.setTimeout(90000);
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
test("единая кухня: меню → покупка → запасы → готовка → заморозка → частичное использование", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await b.save("Сырники для сквозного сценария");
    await page.goto("/menu");
    await page
      .getByRole("button", { name: "Добавить блюдо", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Дата", { exact: true })
      .fill(day());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      page.locator(".k-calendar").getByRole("heading", {
        name: "Сырники для сквозного сценария",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/shopping");
    await page
      .getByRole("button", {
        name: "Рассчитать недостающие продукты",
        exact: true,
      })
      .click();
    const item = page.locator(".k-item").filter({
      has: page.getByRole("heading", { name: "творог", exact: true }),
    });
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: "Куплено", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Фактически куплено", { exact: true })
      .fill("750");
    await page
      .getByRole("dialog")
      .getByLabel("Стоимость всей покупки, ₽", { exact: true })
      .fill("300.50");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "История покупок", exact: true }),
    ).toBeVisible();
    await page.goto("/products");
    await expect(page.locator(".k-list")).toContainText("750 г");
    await page.goto("/budget");
    await expect(page.locator(".k-metrics")).toContainText("300,50");
    await page.goto("/menu");
    await page
      .locator(".k-calendar")
      .getByRole("button", { name: "В план готовки", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/cooking");
    await page
      .getByRole("button", { name: "Подтвердить готовку", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Съели, порц.", { exact: true }).fill("1");
    await modal.getByLabel("В холодильник, порц.", { exact: true }).fill("1");
    await modal.getByLabel("В морозилку, порц.", { exact: true }).fill("2");
    await modal
      .getByRole("checkbox", {
        name: "Подтверждаю расход и распределение порций",
        exact: true,
      })
      .check();
    await modal
      .getByRole("button", { name: "Подтвердить приготовление", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/preparations");
    const frozen = page
      .locator(".k-list>.k-item")
      .filter({ hasText: "2 порц." });
    await frozen
      .getByRole("button", { name: "Использовать / переместить", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Количество (порц.)", { exact: true })
      .fill("0.5");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(page.locator(".k-list")).toContainText("1,5 порц.");
    expect(
      Number(
        (
          await b.query<{ sum: string }>(
            "select sum(quantity)from public.stock_batches",
          )
        ).rows[0].sum,
      ),
    ).toBe(250);
    expect(
      Number(
        (
          await b.query<{ sum: string }>(
            "select sum(amount)from public.financial_movements",
          )
        ).rows[0].sum,
      ),
    ).toBe(300.5);
    expect(
      (await b.query("select id from public.cooking_events")).rows,
    ).toHaveLength(1);
    await page.reload();
    await expect(page.locator(".k-list")).toContainText("1,5 порц.");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await page.close();
    await b.close();
  }
});
test("офлайн-меню использует изолированный кэш; очередь отправляется после восстановления связи", async ({
  page,
  context,
}) => {
  const b = await recipeBackend(page);
  try {
    await b.save("Офлайн-рецепт");
    await page.goto("/menu");
    await page
      .getByRole("button", { name: "Добавить блюдо", exact: true })
      .waitFor();
    await page.waitForFunction(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("moya-kuhnya-offline");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const result = await new Promise<boolean>((resolve) => {
        const r = db.transaction("cache").objectStore("cache").getAll();
        r.onsuccess = () =>
          resolve(r.result.some((x: { kind: string }) => x.kind === "recipes"));
      });
      db.close();
      return result;
    });
    await context.setOffline(true);
    await page
      .getByRole("button", { name: "Добавить блюдо", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Дата", { exact: true })
      .fill(day());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Локальных изменений:" }),
    ).toBeVisible();
    expect(
      (await b.query("select id from public.menu_items")).rows,
    ).toHaveLength(0);
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Локальных изменений:" }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (await b.query("select id from public.menu_items")).rows.length,
      )
      .toBe(1);
    await expect(
      page
        .locator(".k-calendar")
        .getByRole("heading", { name: "Офлайн-рецепт", exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
    await page.close();
    await b.close();
  }
});
test("ручная заготовка сохраняет отдельную приватную фотографию", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await page.goto("/preparations");
    await page
      .getByRole("button", { name: "Добавить заготовку", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByLabel("Название заготовки", { exact: true })
      .fill("Фотозаготовка");
    await modal.getByLabel("Количество", { exact: true }).fill("2");
    await modal
      .getByLabel("Фотография заготовки", { exact: true })
      .setInputFiles("public/icon-192.png");
    await expect(modal.getByText("Обрабатываем…", { exact: true })).toHaveCount(
      0,
    );
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Фотозаготовка", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".k-list img")).toBeVisible();
    expect(
      (
        await b.query<{ photo_path: string }>(
          "select photo_path from public.preparations",
        )
      ).rows[0].photo_path,
    ).toMatch(/^prep:/);
  } finally {
    await page.close();
    await b.close();
  }
});
test("офлайн-конфликт сохраняет локальную правку и не перезаписывает сервер", async ({
  page,
  context,
}) => {
  const b = await recipeBackend(page);
  try {
    const r = await b.save("Рецепт для конфликта");
    const id = crypto.randomUUID();
    const data = {
      id,
      recipe_id: r.id,
      month: day().slice(0, 7) + "-01",
      date: day(),
      meal: "Ужин",
      servings: 4,
      planned_count: 1,
      status: "Запланировано",
    };
    await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
      b.family,
      crypto.randomUUID(),
      "menu_save",
      data,
    ]);
    await page.goto("/menu");
    await page
      .locator(".k-calendar")
      .getByRole("button", { name: "Изменить", exact: true })
      .click();
    await context.setOffline(true);
    await page
      .getByRole("dialog")
      .getByLabel("Количество порций", { exact: true })
      .fill("6");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Локальных изменений:" }),
    ).toBeVisible();
    await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
      b.family,
      crypto.randomUUID(),
      "menu_save",
      { ...data, version: 1, servings: 5 },
    ]);
    await context.setOffline(false);
    await expect(
      page.getByRole("status").filter({ hasText: "требует решения" }),
    ).toBeVisible();
    expect(
      Number(
        (
          await b.query<{ servings: string }>(
            "select servings from public.menu_items where id=$1",
            [id],
          )
        ).rows[0].servings,
      ),
    ).toBe(5);
    await page
      .getByRole("status")
      .filter({ hasText: "Локальных изменений:" })
      .locator("summary")
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Локальных изменений:" }),
    ).toContainText('"servings": "6"');
  } finally {
    await context.setOffline(false);
    await page.close();
    await b.close();
  }
});
test("большая книга выводится страницами, поиск сбрасывает страницу", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    for (let i = 0; i < 25; i++)
      await b.save("Рецепт " + String(i).padStart(2, "0"));
    await page.goto("/recipes");
    await expect(page.locator(".recipe-card")).toHaveCount(24);
    await page
      .getByRole("button", { name: "Следующая страница рецептов", exact: true })
      .click();
    await expect(page.locator(".recipe-card")).toHaveCount(1);
    await page.getByLabel("Поиск рецептов", { exact: true }).fill("Рецепт 00");
    await expect(page.locator(".recipe-card")).toHaveCount(1);
    await expect(page.locator(".recipe-card")).toContainText("Рецепт 00");
  } finally {
    await page.close();
    await b.close();
  }
});
