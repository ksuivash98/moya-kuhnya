import { expect, test } from "vitest";
import { cookingSources } from "../src/kitchen/cooking-sources";
import type { State, Row, Json } from "../src/kitchen/model";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const product = "11111111-1111-4111-8111-111111111111";
const fixture = (): State => ({
  schema_version: 16,
  products: [row(product, { name: "Картошка" })],
  stock_batches: [
    row("stock", { product_id: product, quantity: 300, unit: "г" }),
  ],
  preparations: [
    row("prep", { title: "Куриный бульон", quantity: 2, unit: "порц." }),
  ],
});
test("готовка использует сохранённый подбор и явный коэффициент; исходные остатки не меняются", () => {
  const s = fixture(),
    before = structuredClone(s);
  const result = cookingSources(
    s,
    "f",
    [
      { name: "Готовый куриный бульон", amount: "1200", unit: "мл" },
      { name: "Картофель", amount: " 0,24 ", unit: "кг" },
    ],
    {
      "готовый куриный бульон|мл": { sourceId: "preparation:prep", ratio: 800 },
    },
  );
  expect(result.errors).toEqual([]);
  expect(result.allocations[0].sources).toEqual([
    {
      kind: "preparation",
      id: "prep",
      quantity: "1.5000",
      unit: "порц.",
      ratio: "800.0000",
      version: 1,
    },
  ]);
  expect(result.legacyUsage).toEqual([
    { name: "Картошка", amount: "240.0000", unit: "г" },
  ]);
  expect(result.allocations[1].amount).toBe("0.24");
  expect(result.requiresPreparation).toBe(true);
  expect(s).toEqual(before);
});
test("одна заготовка не засчитывается повторно для разных строк", () => {
  const result = cookingSources(
    fixture(),
    "f",
    [
      { name: "Готовый куриный бульон", amount: "1200", unit: "мл" },
      { name: "Бульон куриный", amount: "800", unit: "мл" },
    ],
    {
      "готовый куриный бульон|мл": { sourceId: "preparation:prep", ratio: 800 },
    },
  );
  expect(result.errors.join(" ")).toContain("не хватает 400");
  expect(
    result.allocations.map((u) =>
      u.sources.reduce((sum, s) => sum + Number(s.quantity), 0),
    ),
  ).toEqual([1.5, 0.5]);
});
test("невалидный расход и неизвестный пересчёт не приводят к молчаливому нулевому списанию", () => {
  expect(
    cookingSources(
      fixture(),
      "f",
      [{ name: "Картофель", amount: "abc", unit: "г" }],
      {},
    ).errors,
  ).toHaveLength(1);
  const result = cookingSources(
    fixture(),
    "f",
    [{ name: "Готовый куриный бульон", amount: "1200", unit: "мл" }],
    { "готовый куриный бульон|мл": { sourceId: "preparation:prep" } },
  );
  expect(result.errors.join(" ")).toContain("не хватает 1200");
  expect(result.allocations[0].sources).toEqual([]);
});
