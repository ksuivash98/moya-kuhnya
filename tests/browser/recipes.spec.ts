import { expect, test } from "@playwright/test";
import { recipeBackend } from "../support/recipe-backend";
test.setTimeout(60000);
async function startForm(page: import("@playwright/test").Page) {
  await page.goto("/recipes");
  await page
    .getByRole("button", { name: "Добавить рецепт", exact: true })
    .click();
  await page.getByRole("button", { name: "Вручную", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "Новый рецепт", exact: true }),
  ).toBeVisible();
}
async function photo(page: import("@playwright/test").Page, label: string) {
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2200;
    c.height = 1100;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#aabb88";
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel(label, { exact: true }).setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByText("Обрабатываем…", { exact: true })).toHaveCount(0);
}
test("полная форма: фото, ингредиенты, шаги, сохранение, порции и редактирование", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    await startForm(page);
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Сырники для семьи");
    await page.getByLabel("Описание", { exact: true }).fill("Семейный завтрак");
    await page.getByLabel("Ингредиент 1", { exact: true }).fill("Творог");
    await page
      .getByLabel("Количество ингредиента 1", { exact: true })
      .fill("500");
    await page
      .getByRole("button", { name: "Добавить ингредиент", exact: true })
      .click();
    await page.getByLabel("Ингредиент 2", { exact: true }).fill("Яйцо");
    await page
      .getByLabel("Количество ингредиента 2", { exact: true })
      .fill("2");
    await page
      .getByLabel("Единица ингредиента 2", { exact: true })
      .selectOption("шт.");
    await page
      .getByRole("button", { name: "Добавить ингредиент", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Удалить ингредиент 3", exact: true })
      .click();
    await page
      .getByLabel("Описание шага 1", { exact: true })
      .fill("Смешать творог");
    await page
      .getByRole("button", { name: "Добавить шаг", exact: true })
      .click();
    await page
      .getByLabel("Описание шага 2", { exact: true })
      .fill("Обжарить сырники");
    await page
      .getByRole("button", { name: "Шаг 2 вверх", exact: true })
      .click();
    await expect(
      page.getByLabel("Описание шага 1", { exact: true }),
    ).toHaveValue("Обжарить сырники");
    await page.getByLabel("Можно замораживать", { exact: true }).check();
    await page
      .getByLabel("Рекомендуемый срок хранения", { exact: true })
      .fill("3 дня");
    await page
      .getByLabel("Условия хранения", { exact: true })
      .fill("В холодильнике");
    await page
      .getByLabel("Приготовление после разморозки", { exact: true })
      .fill("Разогреть");
    await page
      .getByLabel("Примечания", { exact: true })
      .fill("Наш семейный рецепт");
    await page
      .getByLabel("Ссылка на источник", { exact: true })
      .fill("https://example.com/recipe");
    await page.getByLabel("Добавить в избранное", { exact: true }).check();
    await photo(page, "Фотография блюда");
    await photo(page, "Фото шага 1");
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Сырники для семьи", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Пересчитать на порции", { exact: true }).fill("8");
    await expect(page.getByText("1 000 г", { exact: true })).toBeVisible();
    await expect(page.getByText("4 шт.", { exact: true })).toBeVisible();
    expect(backend.bytes.size).toBe(2);
    for (const bytes of backend.bytes.values())
      expect([...bytes.subarray(0, 2)]).toEqual([255, 216]);
    await expect(page.locator("img.detail-cover")).toBeVisible();
    expect(
      await page
        .locator("img.detail-cover")
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeLessThanOrEqual(1600);
    await page
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    await expect(
      page.getByLabel("Рекомендуемый срок хранения", { exact: true }),
    ).toHaveValue("3 дня");
    await expect(
      page.getByLabel("Количество ингредиента 1", { exact: true }),
    ).toHaveValue("500");
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Нежные сырники");
    await page
      .getByRole("button", { name: "Удалить: Фотография блюда", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Нежные сырники", exact: true }),
    ).toBeVisible();
    expect(backend.bytes.size).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Нежные сырники", exact: true }),
    ).toBeVisible();
    const result = await backend.query<{ amount: string }>(
      "select amount::text from public.recipe_ingredients where name=$1",
      ["Творог"],
    );
    expect(Number(result.rows[0].amount)).toBe(500);
  } finally {
    await backend.close();
  }
});
test("черновик с фото переживает перезагрузку; выход предупреждает, записи в БД нет", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    await startForm(page);
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Несохранённый рецепт");
    await photo(page, "Фотография блюда");
    await expect(
      page.getByText("Черновик сохранён на этом устройстве.", { exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Несохранённый рецепт");
    await expect(
      page.locator(".photo-field").first().locator("img"),
    ).toBeVisible();
    await page
      .getByRole("navigation", {
        name:
          page.viewportSize()!.width <= 720
            ? "Мобильная навигация"
            : "Основная навигация",
        exact: true,
      })
      .getByRole("link", { name: "Меню", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Выйти из формы?", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Продолжить редактирование", exact: true })
      .click();
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "Удалить черновик", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Удалить черновик", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Мои рецепты", exact: true }),
    ).toBeVisible();
  } finally {
    await backend.close();
  }
});
test("поиск, фильтры, избранное, список и недоступный ИИ без фиктивных записей", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    await backend.save("Сырники тест");
    await backend.save("Оладьи тест");
    await page.goto("/recipes");
    await expect(page.locator(".recipe-card")).toHaveCount(2);
    await page.getByLabel("Поиск рецептов", { exact: true }).fill("ТВОРОГ");
    await expect(page.locator(".recipe-card")).toHaveCount(2);
    await page.getByLabel("Поиск рецептов", { exact: true }).fill("сырники");
    await expect(page.locator(".recipe-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "В избранное: Сырники тест", exact: true })
      .click();
    await page.getByLabel("Поиск рецептов", { exact: true }).fill("");
    await page
      .getByRole("group", { name: "Категории рецептов" })
      .getByRole("button", { name: "Избранное", exact: true })
      .click();
    await expect(page.locator(".recipe-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Компактный список", exact: true })
      .click();
    await expect(page.locator(".recipe-list")).toBeVisible();
    await page.reload();
    await page
      .getByRole("group", { name: "Категории рецептов" })
      .getByRole("button", { name: "Избранное", exact: true })
      .click();
    await expect(page.locator(".recipe-card")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Добавить рецепт", exact: true })
      .click();
    await page.getByRole("button", { name: "По видео", exact: false }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Импорт видео и ссылок пока не реализован.", {
          exact: false,
        }),
    ).toBeVisible();
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(2);
  } finally {
    await backend.close();
  }
});
test("удаление требует подтверждения и сохраняет исходные данные в архиве", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    const { id } = await backend.save("Удаляемый рецепт");
    await page.goto(`/recipes?recipe=${id}`);
    await expect(
      page.getByRole("heading", { name: "Удаляемый рецепт", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Удалить рецепт", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Оставить", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Удаляемый рецепт", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Удалить рецепт", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Удалить рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Начните вашу семейную книгу",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await backend.query(
          "select * from public.recipes where deleted_at is not null",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await backend.query("select * from public.recipe_ingredients")).rows,
    ).toHaveLength(1);
  } finally {
    await backend.close();
  }
});
test("конфликт версий не перезаписывает изменения другого устройства", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    const { id } = await backend.save("Исходный рецепт");
    await page.goto(`/recipes?recipe=${id}&edit=1`);
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Исходный рецепт");
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Мой несохранённый текст");
    await backend.save("Изменено на другом устройстве", 1, id);
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("другом устройстве");
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Мой несохранённый текст");
    expect(
      (
        await backend.query<{ title: string }>(
          "select title from public.recipes where id=$1",
          [id],
        )
      ).rows[0].title,
    ).toBe("Изменено на другом устройстве");
  } finally {
    await backend.close();
  }
});
test("детский аккаунт читает рецепты и избранное, но не видит редактирование", async ({
  page,
}) => {
  const backend = await recipeBackend(page, "child");
  try {
    const { id } = await backend.save("Рецепт для всех");
    await page.goto(`/recipes?recipe=${id}`);
    await expect(
      page.getByRole("heading", { name: "Рецепт для всех", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Редактировать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Удалить рецепт", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "В избранное", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Убрать из избранного", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Добавить в меню", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Меню", exact: true }),
    ).toBeVisible();
  } finally {
    await backend.close();
  }
});
test("ошибка сохранения не оставляет рецепт или загруженное фото; повторная попытка работает", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  try {
    await startForm(page);
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Рецепт после ошибки");
    await page.getByLabel("Ингредиент 1", { exact: true }).fill("Творог");
    await page
      .getByLabel("Количество ингредиента 1", { exact: true })
      .fill("500");
    await page
      .getByLabel("Описание шага 1", { exact: true })
      .fill("Приготовить");
    await photo(page, "Фотография блюда");
    const pattern = "**/rest/v1/rpc/save_recipe";
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Тестовая ошибка сохранения" }),
      }),
    );
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Тестовая ошибка сохранения",
    );
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
    expect(backend.bytes.size).toBe(0);
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Рецепт после ошибки");
    await page.unroute(pattern);
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Рецепт после ошибки", exact: true }),
    ).toBeVisible();
    expect(backend.bytes.size).toBe(1);
  } finally {
    await backend.close();
  }
});

const recognized = {
  is_recipe: true,
  title: "Сырники из источника",
  description: "Утренний рецепт",
  category: "Завтраки",
  prep: 10,
  cook: 20,
  servings: 4,
  difficulty: null,
  ingredients: [{ name: "Творог", amount: "500", unit: "г", note: "" }],
  steps: ["Смешать и обжарить"],
  notes: "",
  warnings: ["Проверьте название блюда"],
};
async function openImport(
  page: import("@playwright/test").Page,
  kind = "Из текста",
) {
  await page.goto("/recipes");
  await page
    .getByRole("button", { name: "Добавить рецепт", exact: true })
    .click();
  await page.getByRole("button", { name: kind, exact: false }).click();
}
test("импорт текста: согласие → предпросмотр → правка → черновик после перезагрузки → явное сохранение", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  let calls = 0;
  await page.route("**/functions/v1/recipe-import", async (route) => {
    calls++;
    const input = route.request().postDataJSON();
    expect(input.consent).toBe(true);
    expect(input.source).toEqual({
      kind: "text",
      text: "Сырники: 500 г творога. Смешать и обжарить.",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: input.id, result: recognized }),
    });
  });
  try {
    await openImport(page);
    await page
      .getByLabel("Текст рецепта", { exact: true })
      .fill("Сырники: 500 г творога. Смешать и обжарить.");
    await expect(
      page.getByRole("button", { name: "Распознать рецепт", exact: true }),
    ).toBeDisabled();
    expect(calls).toBe(0);
    await page
      .getByRole("checkbox", {
        name: "Разрешаю отправить этот источник в OpenAI для распознавания",
      })
      .check();
    await page
      .getByRole("button", { name: "Распознать рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Сырники из источника", exact: true }),
    ).toBeVisible();
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "Проверить и редактировать", exact: true })
      .click();
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Сырники из источника");
    await page
      .getByLabel("Название рецепта *", { exact: true })
      .fill("Исправленные сырники");
    await page
      .getByLabel("Количество ингредиента 1", { exact: true })
      .fill("450");
    await expect(
      page.getByText("Черновик сохранён на этом устройстве.", { exact: true }),
    ).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await expect(
      page.getByLabel("Название рецепта *", { exact: true }),
    ).toHaveValue("Исправленные сырники");
    await expect(
      page.getByLabel("Количество ингредиента 1", { exact: true }),
    ).toHaveValue("450");
    await expect(
      page.getByText("Проверьте название блюда", { exact: true }),
    ).toBeVisible();
    expect(calls).toBe(1);
    await openImport(page);
    await page
      .getByText("Мои черновики после распознавания", { exact: true })
      .click();
    await page.getByRole("button", { name: /Исправленные сырники ·/ }).click();
    await expect(
      page.getByLabel("Количество ингредиента 1", { exact: true }),
    ).toHaveValue("450");
    expect(calls).toBe(1);
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "Сохранить рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Исправленные сырники", exact: true }),
    ).toBeVisible();
    expect(
      (await backend.query("select title from public.recipes")).rows,
    ).toEqual([{ title: "Исправленные сырники" }]);
    expect(
      Number(
        (
          await backend.query<{ amount: string }>(
            "select amount from public.recipe_ingredients",
          )
        ).rows[0].amount,
      ),
    ).toBe(450);
    expect(
      (await backend.query("select id from storage.objects")).rows,
    ).toHaveLength(0);
  } finally {
    await page.close();
    await backend.close();
  }
});
test("импорт фото: только выбранный JPEG, понятная ошибка настройки и безопасный повтор", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  const ids: string[] = [];
  await page.route("**/functions/v1/recipe-import", async (route) => {
    const input = route.request().postDataJSON();
    ids.push(input.id);
    expect(input.source.kind).toBe("photo");
    expect(input.source.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(Object.keys(input).sort()).toEqual([
      "consent",
      "family_id",
      "id",
      "source",
    ]);
    await route.fulfill({
      status: ids.length === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        ids.length === 1
          ? {
              error: "Распознавание пока не включено. Настройте recipe-import.",
            }
          : { id: input.id, result: recognized },
      ),
    });
  });
  try {
    await openImport(page, "По фото или скриншоту");
    await photo(page, "Фото для распознавания");
    await page
      .getByRole("checkbox", {
        name: "Разрешаю отправить этот источник в OpenAI для распознавания",
      })
      .check();
    await page
      .getByRole("button", { name: "Распознать рецепт", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Распознавание пока не включено",
    );
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "Распознать рецепт", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Проверить и редактировать",
        exact: true,
      }),
    ).toBeVisible();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(
      (await backend.query("select id from storage.objects")).rows,
    ).toHaveLength(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await page.close();
    await backend.close();
  }
});
test("импорт: готовый результат восстанавливается из личной истории без нового ИИ-запроса", async ({
  page,
}) => {
  const backend = await recipeBackend(page);
  let calls = 0;
  await page.route("**/rest/v1/recipe_import_requests?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "11111111-1111-4111-8111-111111111111",
          source_kind: "text",
          created_at: "2026-10-29T00:00:00Z",
          result: recognized,
        },
      ]),
    }),
  );
  await page.route("**/functions/v1/recipe-import", async (route) => {
    calls++;
    await route.abort();
  });
  try {
    await openImport(page);
    await page
      .getByText("Мои последние распознавания", { exact: true })
      .click();
    await page.getByRole("button", { name: /29\.10\.2026.*Текст/ }).click();
    await expect(
      page.getByRole("heading", { name: "Сырники из источника", exact: true }),
    ).toBeVisible();
    expect(calls).toBe(0);
    expect(
      (await backend.query("select id from public.recipes")).rows,
    ).toHaveLength(0);
  } finally {
    await page.close();
    await backend.close();
  }
});
