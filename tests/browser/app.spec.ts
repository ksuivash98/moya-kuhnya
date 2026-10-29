import { expect, test } from "@playwright/test";
test("главная, настройка сервиса, адаптивность и отсутствие фиктивных данных", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать домой" }),
  ).toBeVisible();
  await expect(
    page.getByText("Подключите Supabase", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Создать семейную кухню" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Supabase ещё не подключён.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("тема сохраняется после перезагрузки", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
test("новые разделы честно требуют подключение; неизвестная страница обрабатывается", async ({
  page,
}) => {
  for (const [path, title] of [
    ["menu", "Меню"],
    ["cooking", "План приготовления"],
    ["products", "Мои продукты"],
    ["preparations", "Заготовки"],
    ["shopping", "Покупки"],
    ["budget", "Бюджет"],
    ["assistant", "Помощник"],
    ["analytics", "Аналитика"],
  ]) {
    await page.goto("/" + path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Подключите Supabase", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: "Страница не найдена" }),
  ).toBeVisible();
});
test("настройки содержат подключение, темы и инструкции установки", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Семья и участники" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Подключение Supabase" }),
  ).toBeVisible();
  await expect(page.getByText("На iPhone:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Тёмная", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("раздел рецептов доступен и честно требует подключение и вход", async ({
  page,
}) => {
  await page.goto("/recipes");
  await expect(
    page.getByRole("heading", { name: "Мои рецепты" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Подключите семейную книгу рецептов" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Войти в аккаунт", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
