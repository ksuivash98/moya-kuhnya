import { expect, test } from "vitest";
import { menuError, type Proposal } from "../src/kitchen/assistant-menu";

const item: Proposal = {
  recipe_id: "recipe",
  date: "2026-11-05",
  meal: "Обед",
  servings: 4,
  reason: "Есть продукты",
};
const validate = (items: Proposal[]) =>
  menuError(items, new Set(["recipe"]), "2026-11-01", "2026-11-30");

test("правки меню проверяются до отправки, включая пустые и невозможные значения", () => {
  expect(validate([item])).toBe("");
  expect(validate([])).toContain("хотя бы одно");
  for (const patch of [
    { date: "" },
    { date: "2026-11-31" },
    { date: "2026-12-01" },
    { servings: NaN },
    { servings: 0 },
    { servings: 1.5 },
    { servings: 1001 },
    { meal: "Неизвестный" },
    { recipe_id: "archived" },
  ])
    expect(validate([item, { ...item, ...patch }])).toContain("Предложение 2:");
  expect(
    validate([
      { ...item, date: "2026-11-01", servings: 1 },
      { ...item, date: "2026-11-30", servings: 1000 },
    ]),
  ).toBe("");
});
