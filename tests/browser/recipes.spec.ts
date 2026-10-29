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
        .getByText("ИИ-интеграция ещё не подключена.", { exact: false }),
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
