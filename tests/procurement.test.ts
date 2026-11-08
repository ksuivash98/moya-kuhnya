import { expect, test } from "vitest";
import { proteinProduct } from "../src/kitchen/protein-products";
import { shoppingPlan } from "../src/kitchen/shopping-reconciliation";
import {
  shoppingGroups,
  shoppingGroupQuantity,
} from "../src/kitchen/shopping-groups";
import {
  matchIngredients,
  ingredientChoice,
} from "../src/kitchen/ingredient-matching";
import type { Json, Row, State } from "../src/kitchen/model";
const rawId = "11111111-1111-4111-8111-111111111111",
  cookedId = "22222222-2222-4222-8222-222222222222";
const row = (id: string, fields: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...fields,
});
const state = (): State => ({
  schema_version: 18,
  products: [
    row(rawId, { name: "Куриное филе", unit: "г", category: "Мясо" }),
    row(cookedId, {
      name: "Отварное куриное мясо",
      unit: "г",
      category: "Мясо",
    }),
  ],
  menu_items: [
    row("menu", {
      month: "2030-04-01",
      date: "2030-04-01",
      servings: 1,
      planned_count: 1,
      status: "Запланировано",
      recipe_snapshot: {
        servings: 1,
        ingredients: [
          { name: "куриное филе", amount: 225, unit: "г" },
          { name: "Отварное куриное мясо", amount: 180, unit: "г" },
        ],
      },
    }),
  ],
});
const scope = { month: "2030-04" };
test("закупочное филе: сырое и недостающее отварное объединяются с выходом 75%", () => {
  const result = shoppingPlan(state(), "f", scope, {});
  expect(result.targets).toHaveLength(1);
  expect(result.targets[0]).toMatchObject({
    quantity: 465,
    unit: "г",
    product: { id: rawId },
  });
  expect(result.warnings.join(" ")).toContain("выход 75%");
  expect(shoppingPlan(state(), "f", scope, {}, 80).targets[0].quantity).toBe(
    450,
  );
});
test("заготовка используется первой, сырой остаток не вычитается дважды", () => {
  const s = {
    ...state(),
    stock_batches: [
      row("stock", { product_id: rawId, quantity: 300, unit: "г" }),
    ],
    preparations: [
      row("prep", { title: "Отварное куриное мясо", quantity: 90, unit: "г" }),
    ],
  };
  const before = structuredClone(s);
  expect(shoppingPlan(s, "f", scope, {}).targets).toMatchObject([
    { quantity: 45, product: { id: rawId } },
  ]);
  expect(s).toEqual(before);
  const covered = {
    ...s,
    preparations: [
      row("prep", { title: "Отварное куриное мясо", quantity: 180, unit: "г" }),
    ],
  };
  expect(shoppingPlan(covered, "f", scope, {}).targets).toHaveLength(0);
});
test("ручная покупка готового мяса покрывает только готовую часть, ручное сырое покрывает общий дефицит сырья", () => {
  const s = {
    ...state(),
    shopping_items: [
      row("ready-manual", {
        product_id: cookedId,
        quantity: 60,
        unit: "г",
        month: "2030-04-01",
        category: "Мясо",
        status: "open",
        source: "manual",
      }),
      row("raw-manual", {
        product_id: rawId,
        quantity: 100,
        unit: "г",
        month: "2030-04-01",
        category: "Мясо",
        status: "open",
        source: "manual",
      }),
    ],
  };
  expect(shoppingPlan(s, "f", scope, {}).targets).toMatchObject([
    { quantity: 285, product: { id: rawId } },
  ]);
  const groups = shoppingGroups(
    s.shopping_items,
    (s as State).products as Row[],
  );
  expect(groups).toHaveLength(1);
  expect(groups[0].name).toBe("Куриное филе для блюд и салатов");
  expect(shoppingGroupQuantity(groups[0])).toContain("60 г готового");
  expect(shoppingGroupQuantity(groups[0])).toContain("100 г");
});
test("закупочные названия сохраняют назначение, части и форму продукта", () => {
  expect(proteinProduct("Куриное филе для салатов")?.key).toBe(
    proteinProduct("филе курицы")?.key,
  );
  expect(proteinProduct("куриная грудка без кости")?.key).toBe(
    "chicken-fillet",
  );
  expect(proteinProduct("филе куриной грудки без кожи и костей")?.key).toBe(
    "chicken-fillet",
  );
  expect(proteinProduct("Куриная грудка на кости")).toBeUndefined();
  expect(proteinProduct("Куриный бульон")).toBeUndefined();
  expect(proteinProduct("Куриный суповой набор")?.key).toBe("chicken-broth");
  expect(proteinProduct("Курица для бульона")?.key).not.toBe("chicken-fillet");
  expect(proteinProduct("Свинина для отбивных")?.key).not.toBe(
    proteinProduct("Свинина для борща")?.key,
  );
  expect(proteinProduct("Филе минтая")?.key).toBe(
    proteinProduct("Минтай филе")?.key,
  );
  expect(proteinProduct("Фарш куриный")).toBeUndefined();
  const matched = matchIngredients(
    [
      {
        name: "Отварное куриное мясо",
        quantity: 180,
        unit: "г",
        available: 0,
        missing: 0,
      },
    ],
    [
      {
        id: "raw",
        name: "Куриное филе",
        quantity: 500,
        unit: "г",
        kind: "product",
        expires: "",
      },
    ],
    {},
  );
  expect(matched[0].available).toBe(0);
  expect(matched[0].missing).toBe(180);
});

test("варианты отварного филе учитывают готовую заготовку, старый выбор сырого источника сохраняется", () => {
  const s = state();
  const plan = (s.menu_items as Row[])[0];
  (plan.recipe_snapshot as Record<string, Json>).ingredients = [
    { name: "Отварное куриное филе", amount: 180, unit: "г" },
  ];
  s.preparations = [
    row("prep", { title: "Отварное куриное мясо", quantity: 180, unit: "г" }),
  ];
  expect(shoppingPlan(s, "f", scope, {}).targets).toHaveLength(0);
  expect(
    ingredientChoice(
      { "rule:блюд для и курица салатов филе|г": { sourceId: "raw" } },
      {
        name: "Куриное филе",
        unit: "г",
        quantity: 1,
        available: 0,
        missing: 1,
      },
    ),
  ).toEqual({ sourceId: "raw" });
});
