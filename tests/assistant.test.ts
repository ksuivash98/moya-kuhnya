import { test, expect } from "vitest";
import {
  askProvider,
  validateProposal,
} from "../supabase/functions/kitchen-assistant/handler";
test("ИИ не принимает неизвестные рецепты, неправильные порции и даты", () => {
  const valid = {
    summary: "План",
    items: [
      {
        recipe_id: "r",
        date: "2099-01-01",
        meal: "Завтрак",
        servings: 4,
        reason: "Есть продукты",
      },
    ],
  };
  expect(
    validateProposal(valid, new Set(["r"]), "2099-01-01", "2099-01-31", true),
  ).toEqual(valid);
  for (const patch of [
    { recipe_id: "foreign" },
    { servings: 0 },
    { date: "2099-02-01" },
    { meal: "invalid" },
  ])
    expect(() =>
      validateProposal(
        { ...valid, items: [{ ...valid.items[0], ...patch }] },
        new Set(["r"]),
        "2099-01-01",
        "2099-01-31",
        true,
      ),
    ).toThrow();
});
test("серверный провайдер запрашивает строгий JSON и не маскирует ошибки", async () => {
  let sent: Record<string, unknown> = {};
  const fake: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ summary: "Совет", items: [] }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  expect(
    await askProvider(
      "test-only-key",
      "test-model",
      { recipes: [] },
      { mode: "recommend" },
      fake,
    ),
  ).toEqual({ summary: "Совет", items: [] });
  expect(sent.max_output_tokens).toBe(4000);
  await expect(
    askProvider(
      "test",
      "model",
      {},
      {},
      async () => new Response("Denied", { status: 429 }),
    ),
  ).rejects.toThrow("отклонил");
});
