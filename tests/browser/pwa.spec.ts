import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
test.describe.configure({ mode: "serial" });

test("production PWA: открытая вкладка получает обновление после закрытия формы", async ({
  page,
}) => {
  const original = await readFile("dist/sw.js", "utf8");
  try {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.ready).updateViaCache,
        ),
      )
      .toBe("none");
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
      const state = window as unknown as Record<string, unknown>;
      state.shellUpdateMarker = true;
      const dialog = document.createElement("dialog");
      dialog.id = "update-test-form";
      dialog.innerHTML = '<form><input value="несохранённые данные"></form>';
      document.body.append(dialog);
      dialog.showModal();
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        state.shellControllerChanged = true;
      });
    });
    await writeFile(
      "dist/sw.js",
      original + `\n// Update regression ${Date.now()}\n`,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        (window as unknown as Record<string, unknown>)
          .shellControllerChanged === true,
    );
    await expect(page.locator("#update-test-form input")).toHaveValue(
      "несохранённые данные",
    );
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).shellUpdateMarker,
      ),
    ).toBe(true);
    await page.evaluate(() =>
      document.getElementById("update-test-form")!.remove(),
    );
    await page.waitForFunction(
      () => !(window as unknown as Record<string, unknown>).shellUpdateMarker,
    );
    await expect(
      page.getByRole("heading", {
        name: /^Добро пожаловать домой/,
      }),
    ).toBeVisible();
  } finally {
    await writeFile("dist/sw.js", original);
  }
});

test("production PWA: фокус на фильтре не блокирует получение новой версии", async ({
  page,
}) => {
  const original = await readFile("dist/sw.js", "utf8");
  try {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
      const state = window as unknown as Record<string, unknown>;
      state.filterUpdateMarker = true;
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Категория для проверки обновления");
      select.setAttribute("data-shell-filter", "true");
      select.innerHTML =
        '<option value="all">Все</option><option value="canned">Консервы</option>';
      document.body.append(select);
      select.value = "canned";
      select.focus();
    });
    await expect(
      page.getByLabel("Категория для проверки обновления"),
    ).toBeFocused();
    await writeFile(
      "dist/sw.js",
      original + `\n// Filter update regression ${Date.now()}\n`,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        (window as unknown as Record<string, unknown>).filterUpdateMarker !==
        true,
    );
    await expect(
      page.getByRole("heading", { name: /^Добро пожаловать домой/ }),
    ).toBeVisible();
  } finally {
    await writeFile("dist/sw.js", original);
  }
});

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
