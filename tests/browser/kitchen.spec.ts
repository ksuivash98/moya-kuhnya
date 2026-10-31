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
    const modal = page.getByRole("dialog", { name: "Заготовка", exact: true });
    await modal
      .getByLabel("Название заготовки", { exact: true })
      .fill("Фотозаготовка");
    await modal.getByLabel("Количество", { exact: true }).fill("2");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#eac";
      ctx.fillRect(0, 0, 600, 1200);
      ctx.fillStyle = "#285";
      ctx.fillRect(0, 0, 600, 50);
      ctx.fillRect(0, 1150, 600, 50);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await modal
      .getByLabel("Фотография заготовки", { exact: true })
      .setInputFiles({
        name: "preparation.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await expect(modal.getByText("Обрабатываем…", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      modal.getByRole("img", { name: "Фотография заготовки", exact: true }),
    ).toHaveCSS("object-fit", "contain");
    await modal
      .getByRole("button", {
        name: "Открыть фото: Фотография заготовки",
        exact: true,
      })
      .click();
    const preview = page.getByRole("dialog", {
      name: "Фотография заготовки",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(preview.locator("img")).toHaveCSS("object-fit", "contain");
    await preview.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(preview).not.toBeVisible();
    await expect(modal).toBeVisible();
    expect(
      (await b.query("select id from public.preparations")).rows,
    ).toHaveLength(0);
    await modal
      .getByRole("button", {
        name: "Открыть фото: Фотография заготовки",
        exact: true,
      })
      .click();
    await expect(preview).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByLabel("Название заготовки", { exact: true }),
    ).toHaveValue("Фотозаготовка");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Фотозаготовка", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".k-list img")).toBeVisible();
    await expect(page.locator(".k-list img")).toHaveCSS(
      "object-fit",
      "contain",
    );
    await page
      .getByRole("button", { name: "Открыть фото: Фотозаготовка", exact: true })
      .click();
    const viewer = page.getByRole("dialog", {
      name: "Фотозаготовка",
      exact: true,
    });
    await expect(viewer).toBeVisible();
    await expect
      .poll(() =>
        viewer
          .locator("img")
          .evaluate(
            (img: HTMLImageElement) => img.naturalWidth / img.naturalHeight,
          ),
      )
      .toBe(0.5);
    expect(await viewer.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(
      true,
    );
    await viewer.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(viewer).not.toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Открыть фото: Фотозаготовка",
        exact: true,
      }),
    ).toBeFocused();
    await page.reload();
    await expect(page.locator(".k-list img")).toHaveCSS(
      "object-fit",
      "contain",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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

test("категории покупок: автоматическая подсказка и ручной выбор после пересчёта", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await b.save("Рецепт с творогом");
    await page.goto("/menu");
    await page
      .getByRole("button", { name: "Добавить блюдо", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.goto("/shopping");
    const generate = page.getByRole("button", {
      name: "Рассчитать недостающие продукты",
      exact: true,
    });
    await generate.click();
    const item = page.locator("article.k-item").filter({
      has: page.getByRole("heading", { name: "творог", exact: true }),
    });
    await expect(item.locator(".pill")).toHaveText("Молочные продукты");
    await item
      .getByRole("button", { name: "Изменить / удалить", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Категория", { exact: false })
      .selectOption("Другое");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(item.locator(".pill")).toHaveText("Другое");
    await generate.click();
    await expect(item.locator(".pill")).toHaveText("Другое");
    await page.reload();
    await expect(item.locator(".pill")).toHaveText("Другое");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await b.close();
  }
});

test("главная при первом открытии: показатели семьи не слипаются на телефоне и компьютере", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    // Не посещаем ленивый KitchenPage: стили должны загрузиться уже на главной.
    await page.goto("/");
    const panel = page.getByRole("region", {
      name: "Сегодня в семье",
      exact: true,
    });
    await expect(panel).toBeVisible();
    const cards = panel.getByRole("link");
    await expect(cards).toHaveCount(5);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const width of [320, 390, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        for (const card of await cards.all()) {
          const label = await card.locator("span").boundingBox();
          const value = await card.locator("strong").boundingBox();
          expect(label).not.toBeNull();
          expect(value).not.toBeNull();
          expect(value!.y).toBeGreaterThanOrEqual(label!.y + label!.height);
          const size = await card.evaluate((e) => ({
            width: e.clientWidth,
            scroll: e.scrollWidth,
          }));
          expect(size.scroll).toBeLessThanOrEqual(size.width);
        }
        const rects = await cards.evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          }),
        );
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i],
              b = rects[j];
            expect(
              a.right <= b.x ||
                b.right <= a.x ||
                a.bottom <= b.y ||
                b.bottom <= a.y,
            ).toBe(true);
          }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(cards.last()).toHaveAttribute("href", /\/budget$/);
        if (width === 390 && theme === "dark")
          await panel.screenshot({
            path: test.info().outputPath("family-mobile-dark.png"),
          });
      }
    }
  } finally {
    await b.close();
  }
});

test("мои продукты: понятный путь от названия к запасу и изменение оставшегося количества", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await page.goto("/products");
    await expect(
      page.getByRole("region", { name: "Как вести запасы", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Добавить запас", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Создать продукт", exact: true })
      .click();
    let modal = page.getByRole("dialog");
    await expect(modal).toContainText(
      "Количество, которое есть дома, внесите через «Добавить запас»",
    );
    await modal.getByLabel("Название продукта", { exact: true }).fill("Рис");
    await modal
      .getByLabel("Категория продукта", { exact: true })
      .selectOption("Крупы");
    await modal
      .getByLabel("Единица учёта продукта", { exact: true })
      .selectOption("г");
    await expect(
      modal.getByLabel("Желаемый минимальный запас", { exact: true }),
    ).toHaveAccessibleDescription(/на расчёт покупок не влияет/);
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(modal).not.toBeVisible();
    expect(
      (await b.query("select id from public.stock_batches")).rows,
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "Добавить запас", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByLabel("Сколько есть в этой упаковке", { exact: true })
      .fill("0.5");
    await modal
      .getByLabel("В чём указано количество", { exact: true })
      .selectOption("кг");
    await modal.getByLabel("Годен до", { exact: true }).fill("2099-01-01");
    await modal
      .getByLabel("Где хранится", { exact: true })
      .selectOption({ label: "Кухонный шкаф" });
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(modal).not.toBeVisible();
    const card = page
      .locator("article.k-item")
      .filter({ has: page.getByRole("heading", { name: "Рис", exact: true }) });
    await expect(card).toContainText("В наличии: 500 г");
    await card
      .getByRole("button", { name: "Изменить запас", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await expect(
      modal.getByLabel("Сколько осталось", { exact: true }),
    ).toHaveAccessibleDescription(/новый остаток, а не расход/);
    await modal.getByLabel("Сколько осталось", { exact: true }).fill("200");
    expect(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(card).toContainText("В наличии: 200 г");
    expect(
      Number(
        (
          await b.query<{ quantity: number }>(
            "select quantity from public.stock_batches",
          )
        ).rows[0].quantity,
      ),
    ).toBe(200);
    expect((await b.query("select id from public.expenses")).rows).toHaveLength(
      0,
    );
    await page.reload();
    await expect(card).toContainText("В наличии: 200 г");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await b.close();
  }
});

test("очистить покупки: подтверждение, все страницы и сохранение оплаченной покупки", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  const month = day().slice(0, 7) + "-01";
  try {
    const product = crypto.randomUUID();
    await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
      b.family,
      crypto.randomUUID(),
      "product_save",
      {
        id: product,
        name: "Продукт для очистки",
        category: "Другое",
        unit: "г",
        minimum: 0,
        archived: false,
      },
    ]);
    const ids = [];
    for (let i = 0; i < 26; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
        b.family,
        crypto.randomUUID(),
        "shopping_save",
        {
          id,
          product_id: product,
          quantity: 1,
          unit: "г",
          month,
          status: "open",
        },
      ]);
    }
    await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
      b.family,
      crypto.randomUUID(),
      "purchase_confirm",
      {
        id: ids[0],
        version: 1,
        quantity: 1,
        unit: "г",
        amount: 10,
        date: day(),
      },
    ]);
    await page.goto("/shopping");
    const clear = page.getByRole("button", {
      name: "Очистить покупки",
      exact: true,
    });
    await clear.click();
    const modal = page.getByRole("dialog", {
      name: "Очистить покупки?",
      exact: true,
    });
    await expect(modal).toContainText("25 позиций");
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(modal).not.toBeVisible();
    expect(
      (
        await b.query(
          "select id from public.shopping_items where status='open'",
        )
      ).rows,
    ).toHaveLength(25);
    await clear.click();
    await modal
      .getByRole("button", { name: "Очистить список", exact: true })
      .click();
    await expect(modal).not.toBeVisible();
    await expect(clear).toBeDisabled();
    await expect(
      page.getByText("Список покупок пуст.", { exact: false }),
    ).toBeVisible();
    expect(
      (
        await b.query(
          "select id from public.shopping_items where status='cancelled'",
        )
      ).rows,
    ).toHaveLength(25);
    expect(
      (
        await b.query(
          "select id from public.shopping_items where status='purchased'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await b.query("select id from public.purchases")).rows,
    ).toHaveLength(1);
    expect((await b.query("select id from public.expenses")).rows).toHaveLength(
      1,
    );
    await page.reload();
    await expect(clear).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await b.close();
  }
});

for (const kind of ["menu", "cooking"])
  test(`очистка ${kind}: подтверждение, весь месяц, история и просмотр отменённых`, async ({
    page,
  }) => {
    const b = await recipeBackend(page);
    const month = day().slice(0, 7) + "-01";
    try {
      const { id: recipe } = await b.save("Блюдо для очистки");
      const mutate = async (action: string, data: Record<string, unknown>) =>
        b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
          b.family,
          crypto.randomUUID(),
          action,
          data,
        ]);
      const add = async (date: string) => {
        const id = crypto.randomUUID();
        await mutate(kind === "menu" ? "menu_save" : "task_save", {
          id,
          recipe_id: recipe,
          month,
          date,
          meal: "Ужин",
          servings: 4,
          planned_count: 1,
          status: "Запланировано",
          planned_preparations: 0,
        });
        return id;
      };
      const first = await add(day());
      await add(kind === "menu" ? "" : month);
      const done = await add(day());
      await mutate("cook_confirm", {
        [kind === "menu" ? "menu_id" : "task_id"]: done,
        version: 1,
        date: day(),
        servings: 4,
        eaten: 4,
        fridge: 0,
        frozen: 0,
        usage_confirmed: true,
        usage: [{ name: "Творог", unit: "г", amount: 0 }],
      });
      await page.goto("/" + kind);
      const clear = page.getByRole("button", {
        name: kind === "menu" ? "Очистить меню" : "Очистить план приготовления",
        exact: true,
      });
      await clear.click();
      const modal = page.getByRole("dialog");
      await expect(modal).toContainText("2 незавершённых");
      await modal.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(modal).not.toBeVisible();
      await clear.click();
      await modal
        .getByRole("button", { name: "Очистить список", exact: true })
        .click();
      await expect(modal).not.toBeVisible();
      await expect(clear).toBeDisabled();
      const table = kind === "menu" ? "menu_items" : "cooking_tasks";
      expect(
        (
          await b.query(
            `select id from public.${table} where status='Отменено'`,
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (await b.query("select id from public.cooking_events")).rows,
      ).toHaveLength(1);
      await page.getByLabel("Показывать отменённые", { exact: true }).check();
      await expect(
        page.locator("article.k-item").filter({ hasText: "Отменено" }).first(),
      ).toBeVisible();
      await page.getByLabel("Показывать отменённые", { exact: true }).uncheck();
      await expect(
        page.locator("article.k-item").filter({ hasText: "Отменено" }),
      ).toHaveCount(0);
      await page.reload();
      await expect(clear).toBeDisabled();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await b.query(`select status from public.${table} where id=$1`, [
            first,
          ])
        ).rows[0].status,
      ).toBe("Отменено");
    } finally {
      await b.close();
    }
  });
