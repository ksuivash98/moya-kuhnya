import { expect, test } from "@playwright/test";

test("Лавандовый вечер: поверхности, формы, фокус и возврат к светлой теме", async ({
  page,
}) => {
  // The configured test server exposes Auth fields without real credentials.
  await page.goto("http://127.0.0.1:4180/");
  const surfaces = () =>
    page.evaluate(() => {
      const color = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!).backgroundColor;
      return {
        page: color("html"),
        sidebar: color(".sidebar"),
        topbar: color(".topbar"),
        card: color(".stat-card"),
      };
    });
  const light = await surfaces();
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect.poll(surfaces).toEqual({
    page: "rgb(37, 39, 48)",
    sidebar: "rgb(45, 48, 59)",
    topbar: "rgb(48, 51, 63)",
    card: "rgb(56, 59, 73)",
  });
  await page.getByRole("button", { name: "Создать семейную кухню" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(56, 59, 73)");
  const input = dialog.locator("input").first();
  await expect(input).toHaveCSS("background-color", "rgb(45, 48, 59)");
  await expect(input).toHaveCSS("color", "rgb(240, 236, 245)");
  await input.focus();
  await expect(input).toHaveCSS("outline-color", "rgb(198, 181, 230)");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect.poll(surfaces).toEqual(light);
});
