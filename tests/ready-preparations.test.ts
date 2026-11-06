import { expect, test } from "vitest";
import { readyPreparations } from "../src/kitchen/ready-preparations";
import type { State, Row, Need, Json } from "../src/kitchen/model";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const menu = row("menu", { recipe_id: "recipe", status: "Запланировано" });
const prep = row("prep", {
  recipe_id: "recipe",
  quantity: 4,
  unit: "порц.",
  expires_on: "2099-01-01",
});
const needs: Need[] = ["Картофель", "Морковь", "Репчатый лук"].map((name) => ({
  name,
  unit: "г",
  quantity: 75,
  available: 0,
  missing: 75,
}));
const choices = Object.fromEntries(
  needs.map((n) => [
    n.name.toLowerCase() + "|г",
    {
      sourceId: "preparation:prep",
      ratio: 75,
      allowPreparationSubstitution: true,
    },
  ]),
);
const state: State = {
  schema_version: 9,
  menu_items: [menu],
  preparations: [prep],
};
test("одна готовая заготовка выбранная для нескольких ингредиентов распознаётся как готовое блюдо", () => {
  const result = readyPreparations(state, "f", menu, needs, choices);
  expect(result.eligible).toBe(true);
  expect(result.shared?.id).toBe("prep");
  expect(result.sharedCount).toBe(3);
  expect(result.allShared).toBe(true);
  expect(
    readyPreparations(
      state,
      "f",
      menu,
      [...needs, { ...needs[0], name: "Мясо" }],
      choices,
    ).allShared,
  ).toBe(false);
});
test("заготовка другого рецепта, чужая, нулевая и просроченная не подставляется целым блюдом", () => {
  const result = readyPreparations(
    {
      ...state,
      preparations: [
        { ...prep, recipe_id: "other" },
        { ...prep, id: "foreign", family_id: "other" },
        { ...prep, id: "zero", quantity: 0 },
        { ...prep, id: "expired", expires_on: "2000-01-01" },
      ],
    },
    "f",
    menu,
    needs,
    choices,
  );
  expect(result.preparations).toEqual([]);
  expect(result.shared).toBeUndefined();
});
test("для задач учитывается серверное правило первой активной связанной задачи, отдельная задача не отмечается чужим использованием", () => {
  const first = row("task-a", {
    menu_id: "menu",
    recipe_id: "recipe",
    date: "2026-11-01",
    checked_steps: [],
    status: "Запланировано",
  });
  const later = { ...first, id: "task-b", date: "2026-11-02" };
  const s = { ...state, cooking_tasks: [later, first] };
  expect(readyPreparations(s, "f", first, needs, choices).eligible).toBe(true);
  expect(readyPreparations(s, "f", later, needs, choices).eligible).toBe(false);
  expect(
    readyPreparations(s, "f", { ...first, menu_id: null }, needs, choices)
      .eligible,
  ).toBe(false);
});
