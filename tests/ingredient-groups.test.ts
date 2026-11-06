import { expect, test } from "vitest";
import {
  combineIngredientNeeds,
  groupIngredientNeeds,
} from "../src/kitchen/ingredient-groups";
import {
  ingredientChoice,
  setIngredientChoice,
  ingredientRuleKey,
  matchIngredients,
} from "../src/kitchen/ingredient-matching";
import type { Need } from "../src/kitchen/model";
const need = (name: string, quantity: number, unit: string): Need => ({
  name,
  quantity,
  unit,
  available: 0,
  missing: 0,
});
test("масло для зажарки объединяется с обычным маслом, количество суммируется до учёта запасов", () => {
  const combined = combineIngredientNeeds([
    need("Растительное масло", 80.8, "мл"),
    need("Растительное масло для зажарки", 67.5, "мл"),
  ]);
  expect(combined).toHaveLength(1);
  expect(combined[0].quantity).toBeCloseTo(148.3);
  expect(combined[0].name).toBe("Растительное масло");
  const matched = matchIngredients(
    combined,
    [
      {
        id: "oil",
        name: "Растительное масло",
        quantity: 100,
        unit: "мл",
        kind: "product",
        expires: "",
      },
    ],
    {},
  );
  expect(matched[0].missing).toBeCloseTo(48.3);
});
test("порядок слов, регистр и совместимые единицы объединяются, исходные данные не меняются", () => {
  const input = [
    need("масло растительное (для жарки)", 0.05, "л"),
    need("Растительное масло", 10, "мл"),
  ];
  const snapshot = structuredClone(input);
  const result = combineIngredientNeeds(input);
  expect(result.map((n) => [n.name, n.quantity, n.unit])).toEqual([
    ["масло растительное", 60, "мл"],
  ]);
  expect(input).toEqual(snapshot);
});
test("кукуруза в граммах и упаковках — одна группа с двумя количествами без выдуманного веса", () => {
  const combined = combineIngredientNeeds([
    need("консервированная кукуруза", 150, "г"),
    need("Консервированная кукуруза", 1.5, "упаковка"),
  ]);
  const groups = groupIngredientNeeds(combined);
  expect(groups).toHaveLength(1);
  expect(groups[0].needs.map((n) => [n.quantity, n.unit])).toEqual([
    [150, "г"],
    [1.5, "упаковка"],
  ]);
});
test("отварное мясо, сырое филе и смесь для панировки не объединяются с отдельными компонентами", () => {
  const input = [
    need("Отварное куриное мясо", 1385, "г"),
    need("куриное филе", 225, "г"),
    need("Смесь для панировки", 30, "г"),
    need("Смесь", 10, "г"),
  ];
  expect(groupIngredientNeeds(combineIngredientNeeds(input))).toHaveLength(4);
});
test("сохранённое ранее соответствие масла для зажарки переиспользуется после объединения", () => {
  const n = need("Растительное масло", 10, "мл");
  const legacy = {
    "rule:для зажарки масло растительное|мл": { sourceId: "oil" },
  };
  expect(ingredientChoice(legacy, n)).toEqual({ sourceId: "oil" });
  expect(setIngredientChoice(legacy, n, { sourceId: "new" })).toEqual({
    [ingredientRuleKey(n)]: { sourceId: "new" },
  });
  const mixture = need("Смесь для панировки и жарки", 10, "г");
  const unchanged = { [ingredientRuleKey(mixture)]: { sourceId: "mixture" } };
  expect(ingredientChoice(unchanged, mixture)).toEqual({ sourceId: "mixture" });
  expect(setIngredientChoice(unchanged, mixture)).toEqual({});
});
