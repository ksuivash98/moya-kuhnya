import { expect, test } from "@playwright/test";
test("production PWA: manifest, service worker и оболочка офлайн", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    if (!link) throw new Error("Нет manifest");
    return await (await fetch(link.href)).json();
  });
  expect(manifest.name).toBe("Моя кухня");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toHaveLength(2);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать домой" }),
  ).toBeVisible();
  await expect(
    page.getByText("Нет подключения.", { exact: false }),
  ).toBeVisible();
  await context.setOffline(false);
});
