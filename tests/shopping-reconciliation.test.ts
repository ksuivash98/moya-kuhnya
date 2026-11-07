import { expect, test } from "vitest";
import {
  shoppingPlan,
  stableShoppingId,
  isManagedShopping,
} from "../src/kitchen/shopping-reconciliation";
import {
  matchIngredients,
  ingredientKey,
  type InventorySource,
} from "../src/kitchen/ingredient-matching";
import {
  rows,
  type Row,
  type State,
  type Need,
  type Json,
} from "../src/kitchen/model";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const product = "11111111-1111-4111-8111-111111111111";
const state = (extra: Partial<State> = {}): State => ({
  schema_version: 4,
  products: [row(product, { name: "Картошка", unit: "г" })],
  menu_items: [
    row("plan", {
      month: "2026-11-01",
      date: "2026-11-06",
      servings: 1,
      planned_count: 1,
      status: "Запланировано",
      recipe_snapshot: {
        servings: 1,
        ingredients: [{ name: "Картофель", amount: 240, unit: "г" }],
      },
    }),
  ],
  ...extra,
});
const scope = { month: "2026-11" };
const item = (id: string, quantity: number, unit = "г", source = "manual") =>
  row(id, {
    product_id: product,
    quantity,
    unit,
    month: "2026-11-01",
    status: "open",
    source,
  });
test("покупки используют тот же остаток, исключают покрытые запасы и заготовки", () => {
  const s = state({
    stock_batches: [
      row("stock", { product_id: product, quantity: 300, unit: "г" }),
    ],
  });
  expect(shoppingPlan(s, "f", scope, {}).targets).toHaveLength(0);
  s.stock_batches = [];
  s.preparations = [
    row("prep", { title: "Картофель", quantity: 300, unit: "г" }),
  ];
  expect(shoppingPlan(s, "f", scope, {}).targets).toHaveLength(0);
});
test("ручная совместимая покупка покрывает потребность, старая автоматическая не удваивает её", () => {
  const s = state({
    shopping_items: [
      item("manual", 0.1, "кг"),
      item("old", 240, "г", "generated"),
    ],
  });
  const result = shoppingPlan(s, "f", scope, {});
  expect(result.targets.map((t) => [t.product?.id, t.quantity])).toEqual([
    [product, 140],
  ]);
  expect(rows(s, "shopping_items").map((r) => r.quantity)).toEqual([0.1, 240]);
});
test("штуки и граммы не пересчитываются произвольно и не создают вторую строку", () => {
  const result = shoppingPlan(
    state({ shopping_items: [item("manual", 2, "шт.")] }),
    "f",
    scope,
    {},
  );
  expect(result.targets).toHaveLength(0);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain("другой единице");
});
test("период из меню ограничивает потребность, оплаченные позиции не покрывают недостающие запасы", () => {
  const s = state({
    shopping_items: [{ ...item("paid", 999), status: "purchased" }],
  });
  expect(
    shoppingPlan(s, "f", { ...scope, from: "2026-11-07", to: "2026-11-07" }, {})
      .targets,
  ).toHaveLength(0);
  expect(
    shoppingPlan(s, "f", { ...scope, from: "2026-11-06", to: "2026-11-06" }, {})
      .targets[0].quantity,
  ).toBe(240);
});
test("подтверждённый похожий продукт используется вместо нового имени из рецепта", () => {
  const s = state({
    schema_version: 4,
    products: [row(product, { name: "Молодой картофель" })],
    stock_batches: [
      row("stock", { product_id: product, quantity: 100, unit: "г" }),
    ],
  });
  const result = shoppingPlan(s, "f", scope, {
    "картофель|г": { sourceId: `product:${product}:г` },
  });
  expect(result.targets.map((t) => [t.product?.id, t.quantity])).toEqual([
    [product, 140],
  ]);
});
test("идентификаторы пересчёта стабильны, ручные и оплаченные строки различимы", async () => {
  const id = await stableShoppingId(
    "shopping",
    "family:month:product:unit:cycle",
  );
  expect(id).toBe(
    await stableShoppingId("shopping", "family:month:product:unit:cycle"),
  );
  expect(id).not.toBe(
    await stableShoppingId(
      "shopping",
      "family:month:product:unit:next-purchase",
    ),
  );
  expect(isManagedShopping(item(id, 20))).toBe(true);
  expect(isManagedShopping(item(product, 20))).toBe(false);
  expect(isManagedShopping(item("old", 20, "г", "generated"))).toBe(true);
});
test("суп не заменяет картофель, бульон не заменяет мясо даже при старом ручном выборе", () => {
  const need = (name: string, unit = "г"): Need => ({
    name,
    unit,
    quantity: 100,
    available: 0,
    missing: 100,
  });
  const source = (id: string, name: string, unit = "г"): InventorySource => ({
    id,
    name,
    unit,
    kind: "preparation",
    quantity: 500,
    expires: "",
  });
  for (const [n, s] of [
    [need("Картофель"), source("s", "Куриный суп с картофелем")],
    [need("Отварное куриное мясо"), source("s", "Куриный бульон", "мл")],
  ] as const) {
    const result = matchIngredients([n], [s], {
      [ingredientKey(n)]: { sourceId: s.id, ratio: 10 },
    })[0];
    expect(result.sourceMismatch).toBe(true);
    expect(result.missing).toBe(100);
    expect(result.available).toBe(0);
  }
});
test("при ошибочном старом выборе применяется корректный автоматический запас без чужого коэффициента", () => {
  const n: Need = {
    name: "Картофель",
    unit: "г",
    quantity: 100,
    available: 0,
    missing: 100,
  };
  const sources: InventorySource[] = [
    {
      id: "bad",
      name: "Суп с картофелем",
      unit: "порц.",
      quantity: 5,
      kind: "preparation",
      expires: "",
    },
    {
      id: "good",
      name: "Картошка",
      unit: "г",
      quantity: 150,
      kind: "product",
      expires: "",
    },
  ];
  const result = matchIngredients([n], sources, {
    [ingredientKey(n)]: { sourceId: "bad", ratio: 200 },
  })[0];
  expect(result.available).toBe(150);
  expect(result.missing).toBe(0);
});

test("сметана с жирностью и примечанием количества объединяется с приблизительным пересчётом мл в г", () => {
  const s = state({
    products: [row(product, { name: "Сметана 25%", unit: "г" })],
    menu_items: [
      row("plan", {
        month: "2026-11-01",
        servings: 1,
        planned_count: 1,
        status: "Запланировано",
        recipe_snapshot: {
          servings: 1,
          ingredients: [
            { name: "сметана 25%", amount: 375, unit: "г" },
            { name: "сметана", amount: 402.5, unit: "г" },
            { name: "сметана (100–125 г)", amount: 75, unit: "мл" },
          ],
        },
      }),
    ],
  });
  const plan = shoppingPlan(s, "f", scope, {});
  expect(plan.targets).toHaveLength(1);
  expect(plan.targets[0]).toMatchObject({ quantity: 852.5, unit: "г" });
  expect(plan.warnings).toContain(
    "Сметана: мл пересчитаны в г приблизительно, 1 мл ≈ 1 г.",
  );
});
