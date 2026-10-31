import { expect, test } from "@playwright/test";
import { recipeBackend } from "../support/recipe-backend";
test.setTimeout(180000);
const source =
  "Сырники\nИнгредиенты\n500 г творога\n2 шт. яйца\nПриготовление\n1. Смешать ингредиенты.\n2. Обжарить на сковороде.";
async function open(page: import("@playwright/test").Page, kind: string) {
  await page.goto("/recipes");
  await page
    .getByRole("button", { name: "Добавить рецепт", exact: true })
    .click();
  await page.getByRole("button", { name: kind, exact: false }).click();
  await expect(page.getByLabel("Способ распознавания")).toHaveValue("local");
}
for (const kind of ["Из текста", "По фото"])
  test(`бесплатный импорт ${kind}: реальный локальный разбор и черновик без API`, async ({
    page,
  }) => {
    const backend = await recipeBackend(page);
    let paid = 0;
    await page.route("**/functions/v1/recipe-import", async (r) => {
      paid++;
      await r.abort();
    });
    try {
      await open(page, kind);
      if (kind === "Из текста")
        await page.getByLabel("Текст рецепта", { exact: true }).fill(source);
      else {
        const png = await page.evaluate((source) => {
          const c = document.createElement("canvas");
          c.width = 1600;
          c.height = 900;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.fillStyle = "black";
          ctx.font = "40px Arial";
          source
            .split("\n")
            .forEach((s, i) => ctx.fillText(s, 60, 90 + i * 85));
          return c.toDataURL("image/png").split(",")[1];
        }, source);
        await page
          .getByLabel("Фото для распознавания", { exact: true })
          .setInputFiles({
            name: "recipe.png",
            mimeType: "image/png",
            buffer: Buffer.from(png, "base64"),
          });
        await expect(
          page.getByText("Обрабатываем…", { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Распознать рецепт", exact: true })
          .click();
        const text = page.getByLabel("Текст рецепта", { exact: true });
        await expect(text).toBeVisible({ timeout: 120000 });
        await expect(text).toHaveValue(/Сырники/i);
        // OCR text is editable before parsing; use the corrected text for deterministic structure.
        await text.fill(source);
      }
      if (kind === "Из текста") await page.context().setOffline(true);
      await page
        .getByRole("button", { name: "Распознать рецепт", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Сырники", exact: true }),
      ).toBeVisible();
      expect(
        (await backend.query("select id from public.recipes")).rows,
      ).toHaveLength(0);
      await page
        .getByRole("button", { name: "Проверить и редактировать", exact: true })
        .click();
      await expect(
        page.getByLabel("Название рецепта *", { exact: true }),
      ).toHaveValue("Сырники");
      await expect(
        page.getByLabel("Количество ингредиента 1", { exact: true }),
      ).toHaveValue("500");
      expect(paid).toBe(0);
    } finally {
      await page.context().setOffline(false);
      await backend.close();
    }
  });
