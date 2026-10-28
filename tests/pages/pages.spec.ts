import { expect, test } from "@playwright/test";
test("Pages: ресурсы, навигация, прямые ссылки и PWA в подпапке", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/moya-kuhnya/");
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать домой" }),
  ).toBeVisible();
  const links = await page
    .locator('script[src],link[rel="stylesheet"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("src") || n.getAttribute("href")),
    );
  expect(links.length).toBeGreaterThan(1);
  expect(links.every((url) => url?.startsWith("/moya-kuhnya/"))).toBe(true);
  await page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .getByRole("link", { name: "Рецепты", exact: true })
    .click();
  await expect(page).toHaveURL(/\/moya-kuhnya\/recipes$/);
  await expect(
    page.getByRole("heading", { name: "Рецепты", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/moya-kuhnya/recipes")).status()).toBe(404);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Рецепты", exact: true }),
  ).toBeVisible();
  await page.goto("/moya-kuhnya/auth/callback?code=test");
  await expect(
    page.getByRole("heading", { name: "Вход в аккаунт", exact: true }),
  ).toBeVisible();
  await page.goto("/moya-kuhnya/");
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )!.href;
    return (await fetch(url)).json();
  });
  expect(manifest.start_url).toBe("/moya-kuhnya/");
  expect(manifest.scope).toBe("/moya-kuhnya/");
  expect(
    manifest.icons.every((i: { src: string }) =>
      i.src.startsWith("/moya-kuhnya/"),
    ),
  ).toBe(true);
  const scope = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return new URL(r.scope).pathname;
  });
  expect(scope).toBe("/moya-kuhnya/");
  expect(errors).toEqual([]);
});
