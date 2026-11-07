import { test, expect } from "vitest";
import { menuInMonth, menuOnDate } from "../src/kitchen/menu-periods";
import { planRequirements } from "../src/kitchen/plan-requirements";
import { type Row, type State } from "../src/kitchen/model";
const row: Row = {
  id: "period",
  family_id: "family",
  version: 1,
  period_start: "2030-01-31",
  period_end: "2030-02-02",
  month: "2030-01-01",
  date: null,
  recipe_id: "recipe",
  servings: 4,
  planned_count: 1,
  status: "Запланировано",
  recipe_snapshot: {
    servings: 4,
    ingredients: [{ name: "Картофель", amount: 300, unit: "г" }],
  },
};
const state: State = { schema_version: 18, menu_items: [row] };
test("период пересекает месяцы и включает крайние даты", () => {
  expect(menuInMonth(row, "2030-01")).toBe(true);
  expect(menuInMonth(row, "2030-02")).toBe(true);
  expect(menuOnDate(row, "2030-02-02")).toBe(true);
  expect(menuOnDate(row, "2030-02-03")).toBe(false);
});
test("порции и ингредиенты общего списка не умножаются на дни", () => {
  for (const scope of [
    { month: "2030-01", from: "2030-01-31", to: "2030-02-02" },
    { month: "2030-02" },
    { month: "2030-02", from: "2030-02-01", to: "2030-02-01" },
  ])
    expect(planRequirements(state, { ...scope, kind: "menu" })).toMatchObject([
      { quantity: 300, unit: "г" },
    ]);
  expect(
    planRequirements(state, {
      month: "2030-02",
      from: "2030-02-03",
      to: "2030-02-04",
      kind: "menu",
    }),
  ).toEqual([]);
});
