import { test, expect } from "@playwright/test";
import { recipeBackend } from "../support/recipe-backend";

test("ИИ-меню: правка порций и приёма пищи, проверка дат и неизменный режим результата", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    const recipe = await b.save("Блюдо для предложения");
    await page.route("**/rest/v1/family_preferences*", (route) =>
      route.fulfill({ json: null }),
    );
    let applied: Record<string, unknown> | undefined;
    let period: { from: string; to: string };
    await page.route("**/functions/v1/kitchen-assistant", async (route) => {
      const { input } = route.request().postDataJSON();
      period = input;
      await route.fulfill({
        json: {
          id: crypto.randomUUID(),
          result: {
            summary: "Предложенное меню",
            items: [
              {
                recipe_id: recipe.id,
                date: input.from,
                meal: "Обед",
                servings: 4,
                reason: "Проверить перед сохранением",
              },
            ],
          },
        },
      });
    });
    await page.route("**/rest/v1/rpc/apply_ai_menu", async (route) => {
      applied = route.request().postDataJSON();
      await route.fulfill({ json: [] });
    });
    await page.goto("/assistant");
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("combobox", { name: "Задача", exact: true })
      .selectOption("menu");
    await page
      .getByRole("button", {
        name: "Запросить ИИ (внешний сервис)",
        exact: true,
      })
      .click();
    const apply = page.getByRole("button", {
      name: "Подтвердить добавление в меню",
      exact: true,
    });
    await expect(apply).toBeEnabled();
    // Изменение следующего запроса не превращает уже готовое меню в совет.
    await page
      .getByRole("combobox", { name: "Задача", exact: true })
      .selectOption("recommend");
    await page
      .getByRole("combobox", { name: "Приём пищи", exact: true })
      .selectOption("Ужин");
    await page.getByLabel("Порции", { exact: true }).fill("");
    await expect(apply).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText(
      "целое количество порций",
    );
    await page.getByLabel("Порции", { exact: true }).fill("6");
    await page.getByLabel("Дата", { exact: true }).fill("2000-01-01");
    await expect(apply).toBeDisabled();
    expect(applied).toBeUndefined();
    await page.getByLabel("Дата", { exact: true }).fill(period!.to);
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(apply).toHaveCount(0);
    expect(applied).toMatchObject({
      p_family: b.family,
      p_items: [
        { recipe_id: recipe.id, date: period!.to, meal: "Ужин", servings: 6 },
      ],
    });

    await page
      .getByRole("combobox", { name: "Задача", exact: true })
      .selectOption("menu");
    await page
      .getByRole("button", {
        name: "Запросить ИИ (внешний сервис)",
        exact: true,
      })
      .click();
    await expect(apply).toBeEnabled();
    await page
      .getByRole("button", { name: "Удалить предложение", exact: true })
      .click();
    await expect(apply).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("хотя бы одно блюдо");
    await page
      .getByRole("combobox", { name: "Задача", exact: true })
      .selectOption("recommend");
    await page
      .getByRole("button", {
        name: "Запросить ИИ (внешний сервис)",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Предложенное меню", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Задача", exact: true })
      .selectOption("menu");
    await expect(apply).toHaveCount(0);
  } finally {
    await b.close();
  }
});

test.setTimeout(90000);
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
test("добавить запас: поиск продукта и создание в том же окне с сохранением заполненных полей", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    for (const name of ["Рис", "Паприка копчёная"]) {
      await b.query("select public.kitchen_mutate($1,$2,'product_save',$3)", [
        b.family,
        crypto.randomUUID(),
        {
          id: crypto.randomUUID(),
          name,
          category: "Специи",
          unit: "г",
          minimum: 0,
        },
      ]);
    }
    await page.goto("/products");
    await page
      .getByRole("button", { name: "Добавить запас", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    const picker = modal.getByRole("combobox", {
      name: "Какой продукт",
      exact: true,
    });
    await modal
      .getByLabel("Сколько есть в этой упаковке", { exact: true })
      .fill("25");
    await modal.getByLabel("Годен до", { exact: true }).fill("2099-01-01");
    await modal
      .getByLabel("Где хранится", { exact: true })
      .selectOption({ label: "Кухонный шкаф" });
    await modal
      .getByRole("searchbox", { name: "Поиск продукта", exact: true })
      .fill("ПАПРИ");
    await expect(picker.locator("option")).toHaveText([
      "Выберите продукт",
      "Паприка копчёная",
    ]);
    await picker.selectOption({ label: "Паприка копчёная" });
    await modal
      .getByRole("searchbox", { name: "Поиск продукта", exact: true })
      .fill("Куркума");
    await expect(picker).toHaveValue("");
    await expect(modal).toContainText("Продукт не найден");
    await modal
      .getByRole("button", { name: "Создать новый продукт", exact: true })
      .click();
    await expect(
      modal.getByLabel("Название нового продукта", { exact: true }),
    ).toHaveValue("Куркума");
    await modal
      .getByRole("combobox", { name: "Категория нового продукта", exact: true })
      .selectOption("Специи");
    // Ошибка создания не закрывает окно и не стирает данные запаса.
    let failed = false;
    const attempts: Record<string, unknown>[] = [];
    await page.route("**/rest/v1/rpc/kitchen_mutate", async (route) => {
      const body = route.request().postDataJSON();
      if (body.p_action === "product_save") {
        attempts.push(body);
        if (!failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            json: { message: "Временная ошибка создания" },
          });
          return;
        }
      }
      await route.fallback();
    });
    await modal
      .getByRole("button", { name: "Создать и выбрать", exact: true })
      .click();
    await expect(modal.getByRole("alert")).toContainText(
      "Временная ошибка создания",
    );
    await expect(
      modal.getByLabel("Сколько есть в этой упаковке", { exact: true }),
    ).toHaveValue("25");
    await modal
      .getByRole("button", { name: "Создать и выбрать", exact: true })
      .click();
    await expect(
      modal.getByRole("region", { name: "Новый продукт", exact: true }),
    ).toHaveCount(0);
    await expect(picker.locator("option:checked")).toHaveText("Куркума");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(
      (await b.query("select id from public.stock_batches")).rows,
    ).toHaveLength(0);
    await expect(modal.getByLabel("Годен до", { exact: true })).toHaveValue(
      "2099-01-01",
    );
    await expect(
      modal
        .getByLabel("Где хранится", { exact: true })
        .locator("option:checked"),
    ).toHaveText("Кухонный шкаф");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const saved = await b.query<{ name: string; quantity: number }>(
      "select p.name,b.quantity from public.stock_batches b join public.products p on p.id=b.product_id",
    );
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0].name).toBe("Куркума");
    expect(Number(saved.rows[0].quantity)).toBe(25);
    await page
      .getByRole("button", { name: "Добавить запас", exact: true })
      .click();
    await modal
      .getByRole("searchbox", { name: "Поиск продукта", exact: true })
      .fill("папри");
    await picker.selectOption({ label: "Паприка копчёная" });
    await modal
      .getByLabel("Сколько есть в этой упаковке", { exact: true })
      .fill("10");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(modal).toHaveCount(0);
    expect((await b.query("select id from public.products")).rows).toHaveLength(
      3,
    );
    expect(
      (await b.query("select id from public.stock_batches")).rows,
    ).toHaveLength(2);
  } finally {
    await b.close();
  }
});

test("добавить запас: первый продукт создаётся без выхода из пустого справочника", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await page.goto("/products");
    await page
      .getByRole("button", { name: "Добавить запас", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("button", { name: "Создать новый продукт", exact: true })
      .click();
    await modal
      .getByLabel("Название нового продукта", { exact: true })
      .fill("Овсяные хлопья");
    await modal
      .getByRole("button", { name: "Создать и выбрать", exact: true })
      .click();
    await expect(
      modal
        .getByRole("combobox", { name: "Какой продукт", exact: true })
        .locator("option:checked"),
    ).toHaveText("Овсяные хлопья");
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    expect((await b.query("select id from public.products")).rows).toHaveLength(
      1,
    );
    expect(
      (await b.query("select id from public.stock_batches")).rows,
    ).toHaveLength(0);
  } finally {
    await b.close();
  }
});

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
      page.locator(".k-calendar").getByRole("button", {
        name: "Действия: Сырники для сквозного сценария",
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
      .getByRole("button", { name: /^Действия:/ })
      .click();
    await page
      .getByRole("dialog")
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
        .getByRole("button", { name: "Действия: Офлайн-рецепт", exact: true }),
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
      .getByRole("button", { name: /^Действия:/ })
      .click();
    await page
      .getByRole("dialog")
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
    ).toBeEnabled();
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
      .getByRole("combobox", { name: "Какой продукт", exact: true })
      .selectOption({ label: "Рис" });
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
        page.locator('article.k-item[data-status="Отменено"]').first(),
      ).toBeVisible();
      await page.getByLabel("Показывать отменённые", { exact: true }).uncheck();
      await expect(
        page.locator('article.k-item[data-status="Отменено"]'),
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

for (const kind of ["products", "preparations"])
  test(`фильтры ${kind}: категория вместе с местом хранения и переключение вида`, async ({
    page,
  }) => {
    const b = await recipeBackend(page);
    try {
      const places = (
        await b.query<{ id: string; name: string }>(
          "select id,name from public.storage_places",
        )
      ).rows;
      const cold = places.find((p) => p.name === "Холодильник")!.id,
        room = places.find((p) => p.name === "Кладовая")!.id;
      const category = kind === "products" ? "Крупы" : "Овощные";
      const otherCategory =
        kind === "products" ? "Молочные продукты" : "Мясные";
      const mutate = async (action: string, data: Record<string, unknown>) =>
        b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
          b.family,
          crypto.randomUUID(),
          action,
          data,
        ]);
      for (const [title, cat, place] of [
        ["Первый запас", category, cold],
        ["Второй запас", category, room],
        ["Третий запас", otherCategory, cold],
      ]) {
        const id = crypto.randomUUID();
        if (kind === "products") {
          await mutate("product_save", {
            id,
            name: title,
            category: cat,
            unit: "г",
            minimum: 0,
            archived: false,
          });
          await mutate("batch_save", {
            id: crypto.randomUUID(),
            product_id: id,
            quantity: 100,
            unit: "г",
            purchased_on: day(),
            place_id: place,
            reason: "Ручное добавление",
          });
        } else
          await mutate("prep_save", {
            id,
            title,
            category: cat,
            quantity: 1,
            unit: "порц.",
            prepared_on: day(),
            place_id: place,
          });
      }
      await page.goto("/" + kind);
      const cards = page.locator("article.inventory-item");
      await expect(cards).toHaveCount(3);
      const cats = page.getByRole("combobox", {
          name: "Категория",
          exact: true,
        }),
        location = page.getByRole("combobox", {
          name: "Место хранения",
          exact: true,
        });
      await cats.selectOption(category);
      await expect(cards).toHaveCount(2);
      await location.selectOption(cold);
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Первый запас");
      await page.getByRole("button", { name: "Строки", exact: true }).click();
      await expect(cats).toHaveValue(category);
      await expect(location).toHaveValue(cold);
      await expect(cards).toHaveCount(1);
      await page.getByRole("button", { name: "Плитка", exact: true }).click();
      await expect(cards).toHaveCount(1);
      await cats.selectOption(otherCategory);
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Третий запас");
      await location.selectOption(room);
      await expect(cards).toHaveCount(0);
      await expect(
        page.getByText("По этим условиям запасов нет.", { exact: false }),
      ).toBeVisible();
      await cats.selectOption("");
      await location.selectOption("");
      await expect(cards).toHaveCount(3);
      await page.getByRole("button", { name: "Строки", exact: true }).click();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Строки", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(cards).toHaveCount(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await b.close();
    }
  });

test("вид списка сохраняется отдельно в разделах после перезагрузки", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    await b.save("Рецепт для видов");
    for (const route of [
      "/recipes",
      "/products",
      "/preparations",
      "/shopping",
      "/budget",
      "/menu",
      "/cooking",
      "/analytics",
      "/",
    ]) {
      await page.goto(route);
      const toggle = page.getByRole("group", {
        name: "Вид списка",
        exact: true,
      });
      await expect(toggle).toBeVisible();
      await toggle.getByRole("button", { name: "Строки", exact: true }).click();
      await expect(
        toggle.getByRole("button", { name: "Строки", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(
        toggle.getByRole("button", { name: "Строки", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page
          .locator(route === "/recipes" ? ".recipe-list" : ".list-layout--list")
          .first(),
      ).toBeAttached();
      await toggle.getByRole("button", { name: "Плитка", exact: true }).click();
      await expect(
        toggle.getByRole("button", { name: "Плитка", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      for (const width of [320, 768, 1024, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${route} при ${width}px`,
        ).toBe(true);
      }
      await page.reload();
      await expect(
        toggle.getByRole("button", { name: "Плитка", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
  } finally {
    await b.close();
  }
});

test("категория покупок фильтрует карточки, но очистка сохраняет область всего месяца", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  const month = day().slice(0, 7) + "-01";
  try {
    const mutate = async (action: string, data: Record<string, unknown>) =>
      b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
        b.family,
        crypto.randomUUID(),
        action,
        data,
      ]);
    for (const [name, category] of [
      ["Соль", "Специи"],
      ["Перец", "Специи"],
      ["Лимон", "Фрукты"],
    ]) {
      const id = crypto.randomUUID();
      await mutate("product_save", {
        id,
        name,
        category,
        unit: "г",
        minimum: 0,
        archived: false,
      });
      await mutate("shopping_save", {
        id: crypto.randomUUID(),
        product_id: id,
        quantity: 10,
        unit: "г",
        month,
        status: "open",
      });
    }
    await page.goto("/shopping");
    const cards = page.locator("article.k-item");
    await expect(cards).toHaveCount(3);
    await page
      .getByRole("combobox", { name: "Категория списка", exact: true })
      .selectOption("Специи");
    await expect(cards).toHaveCount(2);
    await page.getByRole("button", { name: "Строки", exact: true }).click();
    await expect(cards).toHaveCount(2);
    await page
      .getByRole("button", { name: "Очистить покупки", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal).toContainText("3 позиций");
    await expect(modal).toContainText("независимо от фильтра категории");
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Категория списка", exact: true })
      .selectOption("Мясо");
    await expect(cards).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Категория списка", exact: true })
      .selectOption("");
    await expect(cards).toHaveCount(3);
  } finally {
    await b.close();
  }
});

for (const kind of ["menu", "cooking"])
  test(`категория ${kind}: фильтрует список, сохраняя календарь и месячный объём очистки`, async ({
    page,
  }) => {
    const b = await recipeBackend(page),
      month = day().slice(0, 7) + "-01";
    try {
      const soup = await b.save("Овощной суп"),
        main = await b.save("Основное блюдо");
      await b.query("select public.save_recipe($1,$2,$3,$4)", [
        soup.id,
        b.family,
        { ...soup.data, category: "Супы" },
        1,
      ]);
      for (const recipe of [soup.id, main.id])
        await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
          b.family,
          crypto.randomUUID(),
          kind === "menu" ? "menu_save" : "task_save",
          {
            id: crypto.randomUUID(),
            recipe_id: recipe,
            date: day(),
            month,
            meal: "Ужин",
            servings: 4,
            planned_count: 1,
            status: "Запланировано",
            planned_preparations: 0,
          },
        ]);
      await page.goto("/" + kind);
      await page.getByRole("button", { name: "Строки", exact: true }).click();
      const cards = page.locator("article.k-item");
      await expect(cards).toHaveCount(2);
      await page
        .getByRole("combobox", { name: "Категория", exact: true })
        .selectOption("Супы");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Овощной суп");
      await page
        .getByRole("button", {
          name:
            kind === "menu" ? "Очистить меню" : "Очистить план приготовления",
          exact: true,
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText("2 незавершённых");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Отмена", exact: true })
        .click();
      await page.getByRole("button", { name: "Неделя", exact: true }).click();
      await expect(page.locator(".k-calendar")).toBeVisible();
      await expect(cards).toHaveCount(1);
      await page
        .getByRole("combobox", { name: "Категория", exact: true })
        .selectOption("");
      await expect(cards).toHaveCount(2);
    } finally {
      await b.close();
    }
  });

test("календарь с множеством блюд: ограниченная высота и доступные действия", async ({
  page,
}, testInfo) => {
  const b = await recipeBackend(page);
  try {
    const recipe = await b.save("Блюдо для компактного календаря");
    for (let i = 0; i < 8; i++) {
      await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
        b.family,
        crypto.randomUUID(),
        "menu_save",
        {
          id: crypto.randomUUID(),
          recipe_id: recipe.id,
          date: day(),
          month: day().slice(0, 7) + "-01",
          meal: "Ужин",
          servings: 4,
          planned_count: 1,
          status: "Запланировано",
        },
      ]);
    }
    for (const theme of ["light", "dark"]) {
      await page.goto("/menu");
      await page.emulateMedia({ reducedMotion: "reduce" });
      if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
        await page
          .getByRole("button", {
            name:
              theme === "dark"
                ? "Включить тёмную тему"
                : "Включить светлую тему",
            exact: true,
          })
          .click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Неделя", exact: true }).click();
      const today = page.locator(".k-day.is-today");
      const contents = today.locator(".k-day-items");
      await expect(today.locator("article")).toHaveCount(8);
      for (const row of await today.locator("article").all()) {
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(46);
      }
      const bounds = await today.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(320);
      expect(
        await contents.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await contents.focus();
      const dateTop = (await today.locator("header").boundingBox())!.y;
      await contents.press("End");
      await expect
        .poll(() => contents.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect((await today.locator("header").boundingBox())!.y).toBeCloseTo(
        dateTop,
        0,
      );
      const trigger = contents
        .getByRole("button", { name: /^Действия:/ })
        .last();
      await trigger.click();
      const actions = page.getByRole("dialog", {
        name: "Действия с блюдом",
        exact: true,
      });
      await expect(actions).toContainText("Блюдо для компактного календаря");
      await expect(actions).toContainText("Запланировано");
      await expect(actions).toContainText("1 приготовл.");
      await expect(
        actions.getByRole("button", {
          name: "Подтвердить готовку",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await actions
        .getByRole("button", { name: "Изменить", exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByLabel("Количество порций", { exact: true }),
      ).toHaveValue("4");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Закрыть", exact: true })
        .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await contents.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.locator(".k-calendar").screenshot({
        path: testInfo.outputPath(`compact-calendar-${theme}.png`),
      });
    }
    await b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
      b.family,
      crypto.randomUUID(),
      "task_save",
      {
        id: crypto.randomUUID(),
        recipe_id: recipe.id,
        date: day(),
        servings: 4,
        status: "Запланировано",
        planned_preparations: 0,
      },
    ]);
    await page.goto("/cooking");
    await page.getByRole("button", { name: "Неделя", exact: true }).click();
    await page.locator(".calendar-meal-row").click();
    const taskDialog = page.getByRole("dialog", {
      name: "Действия с блюдом",
      exact: true,
    });
    await taskDialog.getByText("Шаги приготовления", { exact: true }).click();
    const step = taskDialog.getByRole("checkbox").first();
    await step.click();
    await expect(step).toBeChecked();
    await expect(step).toBeEnabled();
    await step.click();
    await expect(step).not.toBeChecked();
    expect(
      (
        await b.query(
          "select id from public.menu_items where status='Запланировано'",
        )
      ).rows,
    ).toHaveLength(8);
  } finally {
    await b.close();
  }
});

test("строки запасов: горизонтальные колонки на компьютере и перенос на телефоне", async ({
  page,
}, testInfo) => {
  const b = await recipeBackend(page);
  try {
    const product = crypto.randomUUID();
    const place = (
      await b.query<{ id: string }>(
        "select id from public.storage_places limit 1",
      )
    ).rows[0].id;
    const mutate = (action: string, data: Record<string, unknown>) =>
      b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
        b.family,
        crypto.randomUUID(),
        action,
        data,
      ]);
    await mutate("product_save", {
      id: product,
      name: "Чёрный молотый перец",
      category: "Специи",
      unit: "г",
      minimum: 0,
      archived: false,
    });
    await mutate("batch_save", {
      id: crypto.randomUUID(),
      product_id: product,
      quantity: 22,
      unit: "г",
      purchased_on: day(),
      place_id: place,
      reason: "Ручное добавление",
    });
    await page.goto("/products");
    await page.getByRole("button", { name: "Строки", exact: true }).click();
    const row = page.locator("article.inventory-item");
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
        await page
          .getByRole("button", {
            name:
              theme === "dark"
                ? "Включить тёмную тему"
                : "Включить светлую тему",
            exact: true,
          })
          .click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(row).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${theme}: ${width}px`,
        ).toBe(true);
        if (width === 1440) {
          const bounds = await row.boundingBox();
          expect(bounds!.height).toBeLessThanOrEqual(130);
          const positions = await row.evaluate((el) =>
            ["title", "quantity", "storage", "actions"].map(
              (name) =>
                el
                  .querySelector(`.inventory-item-${name}`)!
                  .getBoundingClientRect().x,
            ),
          );
          expect(positions).toEqual([...positions].sort((a, b) => a - b));
          expect(new Set(positions).size).toBe(4);
        }
        await expect(
          row.getByRole("button", { name: "Изменить запас", exact: true }),
        ).toBeVisible();
        if ([1440, 390].includes(width))
          await page.screenshot({
            path: testInfo.outputPath(`compact-rows-${theme}-${width}.png`),
          });
      }
    }
    await row
      .getByRole("button", { name: "Изменить запас", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Сколько осталось", { exact: true }),
    ).toHaveValue("22");
  } finally {
    await b.close();
  }
});

test("редактор продуктов: правка без запасов, подтверждение удаления, история и восстановление", async ({
  page,
}) => {
  const b = await recipeBackend(page);
  try {
    const empty = crypto.randomUUID(),
      stocked = crypto.randomUUID();
    const mutate = (action: string, data: Record<string, unknown>) =>
      b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
        b.family,
        crypto.randomUUID(),
        action,
        data,
      ]);
    for (const [id, name] of [
      [empty, "Старая специя"],
      [stocked, "Рис с остатком"],
    ]) {
      await mutate("product_save", {
        id,
        name,
        category: "Специи",
        unit: "г",
        minimum: 0,
      });
    }
    const batch = crypto.randomUUID();
    const stock = {
      id: batch,
      product_id: empty,
      quantity: 10,
      unit: "г",
      purchased_on: day(),
      reason: "Ручное добавление",
    };
    await mutate("batch_save", stock);
    await mutate("batch_save", {
      ...stock,
      version: 1,
      quantity: 0,
      reason: "Списание",
    });
    await mutate("batch_save", {
      ...stock,
      id: crypto.randomUUID(),
      product_id: stocked,
      quantity: 25,
    });
    await page.goto("/products");
    await page
      .getByRole("button", { name: "Редактор продуктов", exact: true })
      .click();
    const editor = page.getByRole("region", {
      name: "Редактор продуктов",
      exact: true,
    });
    const card = (name: string) =>
      editor
        .locator("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(
      card("Рис с остатком").getByRole("button", {
        name: "Удалить",
        exact: true,
      }),
    ).toBeDisabled();
    await card("Старая специя")
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByLabel("Название продукта", { exact: true })
      .fill("Новая специя");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(card("Новая специя")).toBeVisible();
    page.once("dialog", (d) => d.dismiss());
    await card("Новая специя")
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await expect(card("Новая специя")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await card("Новая специя")
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await expect(card("Новая специя")).toHaveCount(0);
    expect(
      (
        await b.query(
          "select id from public.stock_movements where batch_id=$1",
          [batch],
        )
      ).rows,
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "Добавить запас", exact: true })
      .click();
    await expect(
      modal
        .getByRole("combobox", { name: "Какой продукт", exact: true })
        .locator("option"),
    ).not.toContainText(["Новая специя"]);
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    await editor
      .getByRole("combobox", { name: "Список продуктов", exact: true })
      .selectOption("archived");
    await expect(card("Новая специя")).toBeVisible();
    await card("Новая специя")
      .getByRole("button", { name: "Восстановить", exact: true })
      .click();
    await expect(card("Новая специя")).toHaveCount(0);
    await editor
      .getByRole("combobox", { name: "Список продуктов", exact: true })
      .selectOption("active");
    await editor
      .getByRole("searchbox", {
        name: "Поиск в редакторе продуктов",
        exact: true,
      })
      .fill("новая");
    await expect(editor.locator("article")).toHaveCount(1);
    await expect(card("Новая специя")).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Редактор продуктов", exact: true })
      .click();
    await expect(card("Новая специя")).toBeVisible();
  } finally {
    await b.close();
  }
});

test("редактор продуктов недоступен ребёнку без права редактирования", async ({
  page,
}) => {
  const b = await recipeBackend(page, "child");
  try {
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: "Мои продукты", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Редактор продуктов", exact: true }),
    ).toHaveCount(0);
  } finally {
    await b.close();
  }
});

for (const kind of ["menu", "cooking"])
  test(`ингредиенты ${kind}: день, неделя через границу месяца и возврат к месяцу`, async ({
    page,
  }) => {
    const b = await recipeBackend(page);
    try {
      const recipe = await b.save("Блюдо для выбранного периода");
      const mutate = (action: string, data: Record<string, unknown>) =>
        b.query("select public.kitchen_mutate($1,$2,$3,$4)", [
          b.family,
          crypto.randomUUID(),
          action,
          data,
        ]);
      for (const date of [
        "2030-04-01",
        "2030-04-29",
        "2030-04-30",
        "2030-05-01",
        "2030-05-06",
        ...(kind === "menu" ? [""] : []),
      ]) {
        const id = crypto.randomUUID();
        const data = {
          id,
          recipe_id: recipe.id,
          month: (date || "2030-04-01").slice(0, 7) + "-01",
          date,
          meal: "Обед",
          servings: recipe.data.servings,
          planned_count: 1,
          planned_preparations: 0,
          status: "Запланировано",
        };
        await mutate(kind === "menu" ? "menu_save" : "task_save", data);
        // Связанный план готовки заменяет потребность меню, а не удваивает её.
        if (kind === "menu" && date === "2030-04-30")
          await mutate("task_save", {
            ...data,
            id: crypto.randomUUID(),
            menu_id: id,
          });
      }
      for (const status of ["Отменено"])
        await mutate(kind === "menu" ? "menu_save" : "task_save", {
          id: crypto.randomUUID(),
          recipe_id: recipe.id,
          month: "2030-05-01",
          date: "2030-05-02",
          meal: "Обед",
          servings: recipe.data.servings,
          planned_count: 1,
          planned_preparations: 0,
          status,
        });
      await page.goto("/" + kind);
      await expect(
        page.getByRole("button", { name: "Добавить блюдо", exact: true }),
      ).toBeEnabled();
      await page.getByLabel("Месяц", { exact: true }).fill("2030-04");
      const panel = page.locator("section.panel").filter({
        has: page.getByRole("heading", {
          name: "Ингредиенты плана",
          exact: true,
        }),
      });
      const needed = panel.locator("tbody tr").first().locator("td").nth(1);
      await expect(needed).toHaveText(
        kind === "menu" ? /^2\s*000\s*г$/ : /^1\s*500\s*г$/,
      );
      await page.getByRole("button", { name: "Неделя", exact: true }).click();
      await page
        .getByLabel("Выбранный день", { exact: true })
        .fill("2030-04-30");
      await expect(panel).toContainText("За неделю: 2030-04-29 — 2030-05-05");
      await expect(needed).toHaveText(/^1\s*500\s*г$/);
      await page
        .getByRole("button", { name: "Вперёд по датам", exact: true })
        .click();
      await expect(needed).toHaveText(/^500\s*г$/);
      await page
        .getByRole("button", { name: "Назад по датам", exact: true })
        .click();
      await expect(needed).toHaveText(/^1\s*500\s*г$/);
      await page.getByRole("button", { name: "День", exact: true }).click();
      await expect(panel).toContainText("За день: 2030-04-30");
      await expect(needed).toHaveText(/^500\s*г$/);
      await page
        .getByRole("button", { name: "Вперёд по датам", exact: true })
        .click();
      await expect(panel).toContainText("За день: 2030-05-01");
      await expect(needed).toHaveText(/^500\s*г$/);
      await page
        .getByRole("button", { name: "Вперёд по датам", exact: true })
        .click();
      await expect(panel).toContainText("Нет незавершённых блюд");
      await expect(panel.locator("table")).toHaveCount(0);
      await page
        .getByRole("button", {
          name: kind === "menu" ? "Месяц" : "Список",
          exact: true,
        })
        .click();
      await expect(panel).toContainText("За месяц: 2030-04");
      await expect(needed).toHaveText(
        kind === "menu" ? /^2\s*000\s*г$/ : /^1\s*500\s*г$/,
      );
    } finally {
      await b.close();
    }
  });

for (const kind of ["menu", "cooking"])
  test(`периоды ${kind}: прямое открытие без рецептов, отступы и перенос кнопок`, async ({
    page,
  }) => {
    const b = await recipeBackend(page);
    try {
      await b.save("Рецепт для проверки периодов");
      await page.goto("/" + kind);
      const periods = page.getByRole("group", {
        name: "Период планирования",
        exact: true,
      });
      await expect(periods).toBeVisible();
      await expect(periods.getByRole("button")).toHaveCount(
        kind === "menu" ? 5 : 3,
      );
      for (const theme of ["light", "dark"]) {
        if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
          await page
            .getByRole("button", {
              name:
                theme === "dark"
                  ? "Включить тёмную тему"
                  : "Включить светлую тему",
              exact: true,
            })
            .click();
        }
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const layout = await periods.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              display: style.display,
              wrap: style.flexWrap,
              gap: parseFloat(style.columnGap),
              buttons: [...el.querySelectorAll("button")].map((b) => {
                const r = b.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  border: parseFloat(getComputedStyle(b).borderTopWidth),
                };
              }),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          expect(layout.display).toBe("flex");
          expect(layout.wrap).toBe("wrap");
          expect(layout.gap).toBeGreaterThanOrEqual(8);
          expect(layout.overflow).toBe(false);
          for (const [i, rect] of layout.buttons.entries()) {
            expect(rect.height).toBeGreaterThanOrEqual(42);
            expect(rect.border).toBeGreaterThan(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(width);
            if (i && Math.abs(layout.buttons[i - 1].y - rect.y) < 1)
              expect(
                rect.x - layout.buttons[i - 1].x - layout.buttons[i - 1].width,
              ).toBeGreaterThanOrEqual(8);
          }
        }
        await periods
          .getByRole("button", { name: "Неделя", exact: true })
          .click();
        await expect(
          periods.getByRole("button", { name: "Неделя", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await periods
          .getByRole("button", { name: "День", exact: true })
          .click();
        await expect(
          periods.getByRole("button", { name: "День", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(periods.locator("[aria-pressed=true]")).toHaveCount(1);
      }
    } finally {
      await b.close();
    }
  });
