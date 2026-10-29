import { test, expect } from "vitest";
import {
  createImportHandler,
  recognize,
  validateInput,
  sourceHash,
  MAX_BODY,
  type ImportDependencies,
} from "../supabase/functions/recipe-import/handler";
import {
  validateExtraction,
  type ExtractedRecipe,
} from "../supabase/functions/_shared/recipe-import";
import { importDraft } from "../src/recipes/import";
import { validate } from "../src/recipes/model";
export const extracted: ExtractedRecipe = {
  is_recipe: true,
  title: "Сырники",
  description: "Завтрак",
  category: "Завтраки",
  prep: 10,
  cook: 20,
  servings: 4,
  difficulty: null,
  ingredients: [{ name: "Творог", amount: "500", unit: "г", note: "" }],
  steps: ["Смешать и обжарить"],
  notes: "",
  warnings: [],
};
const input = {
  id: "11111111-1111-4111-8111-111111111111",
  family_id: "22222222-2222-4222-8222-222222222222",
  consent: true,
  source: { kind: "text", text: "Творог 500 г. Приготовить сырники." },
};
const request = (body: unknown = input) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
test("контракт распознавания сохраняет неизвестные значения и не принимает чужие поля", () => {
  expect(validateExtraction(extracted)).toEqual(extracted);
  for (const patch of [
    { title: "x".repeat(201) },
    { servings: 0 },
    { cook: -1 },
    { photo: "https://evil.test" },
    { ingredients: [{ name: "Мука", amount: "2", unit: "ведро", note: "" }] },
    { ingredients: [{ name: "Мука", amount: "-1", unit: "г", note: "" }] },
  ])
    expect(() => validateExtraction({ ...extracted, ...patch })).toThrow();
  const draft = importDraft({
    ...extracted,
    servings: null,
    prep: null,
    ingredients: [
      { name: "Мука", amount: null, unit: null, note: "стакан без объёма" },
    ],
  });
  expect(Number.isNaN(draft.data.servings)).toBe(true);
  expect(draft.data.ingredients[0].amount).toBe("");
  expect(draft.data.ingredients[0].unit).toBe("");
  expect(draft.data.photo).toBe("");
  expect(validate(draft.data)).toBeTruthy();
  expect(draft.warnings.join(" ")).toContain("Количество порций");
  expect(() => importDraft({ ...extracted, is_recipe: false })).toThrow(
    "найти рецепт",
  );
});
test("вход требует согласия, ограничивает объём и принимает только встроенное JPEG", async () => {
  expect(validateInput(input).source).toEqual(input.source);
  for (const patch of [
    { consent: false },
    { id: "bad" },
    { family_id: null },
    { source: { kind: "text", text: " " } },
    { source: { kind: "text", text: "x".repeat(20001) } },
    { source: { kind: "photo", image: "https://internal.test/image" } },
    { source: { kind: "photo", image: "data:image/jpeg;base64,dGVzdA==" } },
  ])
    expect(() => validateInput({ ...input, ...patch })).toThrow();
  expect(
    validateInput({
      ...input,
      source: { kind: "photo", image: "data:image/jpeg;base64,/9j/2Q==" },
    }).source.kind,
  ).toBe("photo");
  const hash = await sourceHash(validateInput(input).source);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).toBe(await sourceHash(validateInput(input).source));
});
test("провайдер получает только источник и строгую схему, ошибки и незавершённые ответы не маскируются", async () => {
  let sent: Record<string, unknown> = {};
  const fake: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(extracted) }] },
      ],
    });
  };
  expect(
    await recognize(
      "server-only-test",
      "test-model",
      { kind: "text", text: "сырники" },
      fake,
    ),
  ).toEqual(extracted);
  expect(sent.store).toBe(false);
  expect(JSON.stringify(sent)).not.toContain("family_id");
  expect((sent.text as { format: { strict: boolean } }).format.strict).toBe(
    true,
  );
  await recognize(
    "server-only-test",
    "vision-model",
    { kind: "photo", image: "data:image/jpeg;base64,/9j/2Q==" },
    fake,
  );
  expect(JSON.stringify(sent)).toContain("input_image");
  await expect(
    recognize(
      "test",
      "m",
      { kind: "text", text: "r" },
      async () => new Response("", { status: 429 }),
    ),
  ).rejects.toThrow("отклонил");
  await expect(
    recognize("test", "m", { kind: "text", text: "r" }, async () =>
      Response.json({ status: "incomplete", output: [] }),
    ),
  ).rejects.toThrow("завершено");
});
function setup(overrides: Partial<ImportDependencies> = {}) {
  let calls = 0;
  const state = {
    fresh: true,
    status: "pending",
    result: undefined as unknown,
  };
  const deps: ImportDependencies = {
    origin: "https://example.test",
    enabled: true,
    authenticate: async (token) =>
      token === "Bearer test" ? { userId: "u", token } : null,
    reserve: async () => ({ ...state }),
    complete: async (_actor, _input, result) => {
      state.fresh = false;
      state.status = result ? "ready" : "failed";
      state.result = result;
    },
    recognize: async () => {
      calls++;
      return extracted;
    },
    ...overrides,
  };
  return { handle: createImportHandler(deps), calls: () => calls };
}
test("Edge-поток проверяет сессию, согласие, квоту и лимит до вызова платного провайдера", async () => {
  const s = setup();
  expect(
    (await s.handle(new Request("https://example.test", { method: "POST" })))
      .status,
  ).toBe(401);
  expect((await s.handle(request({ ...input, consent: false }))).status).toBe(
    400,
  );
  expect(
    (
      await s.handle(
        new Request("https://example.test", {
          method: "POST",
          headers: { Authorization: "Bearer test" },
          body: "x".repeat(MAX_BODY + 1),
        }),
      )
    ).status,
  ).toBe(413);
  expect(s.calls()).toBe(0);
  const quota = setup({
    reserve: async () => {
      throw new Error("quota");
    },
  });
  expect((await quota.handle(request())).status).toBe(403);
  expect(quota.calls()).toBe(0);
  const disabled = setup({ enabled: false });
  expect((await disabled.handle(request())).status).toBe(503);
  expect(disabled.calls()).toBe(0);
});
test("повтор готового запроса возвращает результат без повторной оплаты; сбой не создаёт рецепт", async () => {
  const s = setup();
  expect((await s.handle(request())).status).toBe(200);
  expect((await s.handle(request())).status).toBe(200);
  expect(s.calls()).toBe(1);
  let attempts = 0;
  const failed = setup({
    recognize: async () => {
      attempts++;
      throw new Error("timeout");
    },
  });
  expect((await failed.handle(request())).status).toBe(502);
  expect((await failed.handle(request())).status).toBe(409);
  expect(attempts).toBe(1);
});
