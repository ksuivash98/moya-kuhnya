import { expect, test } from "vitest";
import { automaticConversion } from "../src/kitchen/unit-conversion";
import {
  automaticMatch,
  matchIngredients,
  ingredientKey,
  type InventorySource,
} from "../src/kitchen/ingredient-matching";
import { cookingSources } from "../src/kitchen/cooking-sources";
import { shoppingPlan } from "../src/kitchen/shopping-reconciliation";
import type { Need, Row, State, Json } from "../src/kitchen/model";
const need = (name: string, quantity: number, unit: string): Need => ({
  name,
  quantity,
  unit,
  available: 0,
  missing: 0,
});
const source = (
  name: string,
  quantity: number,
  unit: string,
  id = "salt",
): InventorySource => ({
  id,
  name,
  quantity,
  unit,
  kind: "product",
  expires: "",
});
const id = "11111111-1111-4111-8111-111111111111";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const state = (quantity = 190): State => ({
  schema_version: 16,
  products: [row(id, { name: "соль", unit: "г" })],
  stock_batches: [row("stock", { product_id: id, quantity, unit: "г" })],
  menu_items: [
    row("plan", {
      month: "2026-11-01",
      servings: 1,
      planned_count: 1,
      status: "Запланировано",
      recipe_snapshot: {
        servings: 1,
        ingredients: [{ name: "Соль", amount: "1.125", unit: "ч. л." }],
      },
    }),
  ],
});
test("соль: 1,125 чайной ложки автоматически учитывает запас в граммах", () => {
  const n = need("Соль", 1.125, "ч. л."),
    s = source("соль", 190, "г");
  expect(automaticMatch(n, s)).toBe(true);
  const result = matchIngredients([n], [s], {})[0];
  expect(result.conversionRequired).toBe(false);
  expect(result.available).toBeCloseTo(190 / 6);
  expect(result.missing).toBe(0);
  expect(automaticConversion(n, s)?.description).toBe("1 ч. л. ≈ 6 г");
});
test("стандартные объёмы ложек и отдельные массы разных продуктов", () => {
  expect(
    automaticConversion(
      { name: "Соль", unit: "ст. л." },
      { name: "Соль", unit: "г" },
    )?.ratio,
  ).toBeCloseTo(1 / 18);
  expect(
    automaticConversion(
      { name: "Сахар", unit: "ч. л." },
      { name: "Сахар", unit: "г" },
    )?.ratio,
  ).toBeCloseTo(1 / 4);
  expect(
    automaticConversion(
      { name: "Мука", unit: "ч. л." },
      { name: "Мука", unit: "г" },
    )?.ratio,
  ).toBeCloseTo(1 / 3);
  expect(
    automaticConversion(
      { name: "Масло растительное", unit: "ч. л." },
      { name: "Масло растительное", unit: "мл" },
    )?.ratio,
  ).toBe(0.2);
  expect(
    automaticConversion(
      { name: "Масло растительное", unit: "г" },
      { name: "Масло растительное", unit: "мл" },
    )?.ratio,
  ).toBe(0.92);
});
test("вес упаковки, штуки, стакана, порции и незнакомого продукта не предполагается", () => {
  for (const unit of ["упаковка", "шт.", "стакан", "порц."])
    expect(
      automaticConversion({ name: "Соль", unit }, { name: "Соль", unit: "г" }),
    ).toBeUndefined();
  expect(
    automaticConversion(
      { name: "Паприка", unit: "ч. л." },
      { name: "Паприка", unit: "г" },
    ),
  ).toBeUndefined();
  expect(
    automaticConversion(
      { name: "Соль крупная", unit: "ч. л." },
      { name: "Соль крупная", unit: "г" },
    ),
  ).toBeUndefined();
  expect(
    automaticConversion(
      { name: "Соль", unit: "ч. л." },
      { name: "Сахар", unit: "г" },
    ),
  ).toBeUndefined();
});
test("ручной коэффициент и явный отказ имеют приоритет над автоматическим", () => {
  const n = need("Соль", 1, "ч. л."),
    s = source("соль", 10, "г");
  expect(
    matchIngredients([n], [s], {
      [ingredientKey(n)]: { sourceId: s.id, ratio: 1 / 5 },
    })[0].available,
  ).toBe(2);
  expect(
    matchIngredients([n], [s], { [ingredientKey(n)]: { sourceId: "none" } })[0]
      .missing,
  ).toBe(1);
});
test("граммы и ложки разных запасов распределяются один раз с собственными коэффициентами", () => {
  const result = matchIngredients(
    [need("Соль", 2, "ч. л."), need("Соль", 3, "г")],
    [source("соль", 6, "г", "grams"), source("соль", 1, "ч. л.", "spoon")],
    {},
  );
  expect(result[0].missing).toBe(0);
  expect(result[1].missing).toBe(3);
});
test("готовка записывает физические 6,75 г без дробного коэффициента в серверном протоколе", () => {
  const s = state(),
    before = structuredClone(s);
  const result = cookingSources(
    s,
    "f",
    [{ name: "Соль", amount: "1.125", unit: "ч. л." }],
    {},
  );
  expect(result.errors).toEqual([]);
  expect(result.allocations[0]).toMatchObject({
    unit: "г",
    amount: "6.7500",
    sources: [{ id, quantity: "6.7500", unit: "г", ratio: "1.0000" }],
  });
  expect(s).toEqual(before);
  const custom = cookingSources(
    s,
    "f",
    [{ name: "Соль", amount: "1.125", unit: "ч. л." }],
    { "соль|ч. л.": { sourceId: `product:${id}:г`, ratio: 1 / 7 } },
  );
  expect(custom.errors).toEqual([]);
  expect(custom.allocations[0]).toMatchObject({
    unit: "г",
    amount: "7.8750",
    sources: [{ quantity: "7.8750", ratio: "1.0000" }],
  });
});
test("недостающее для покупки автоматически переводится в граммы и покрывается ручной строкой", () => {
  const s = state(3);
  const result = shoppingPlan(s, "f", { month: "2026-11" }, {});
  expect(result.targets.map((t) => [t.quantity, t.unit])).toEqual([
    [3.75, "г"],
  ]);
  s.shopping_items = [
    row("manual", {
      product_id: id,
      quantity: 4,
      unit: "г",
      status: "open",
      source: "manual",
      month: "2026-11-01",
    }),
  ];
  expect(shoppingPlan(s, "f", { month: "2026-11" }, {}).targets).toHaveLength(
    0,
  );
});
