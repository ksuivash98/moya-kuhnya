import { expect, test } from "vitest";
import { shoppingGroups } from "../src/kitchen/shopping-groups";
import type { Row } from "../src/kitchen/model";
const row = (id: string, data: Record<string, string | number>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const products = [
  row("dry", { name: "макароны (сухие)" }),
  row("shapes", { name: "Макароны (рожки, спирали или перья)" }),
];
const items = [
  row("first", {
    product_id: "dry",
    quantity: 450,
    unit: "г",
    month: "2030-04-01",
    category: "Макароны",
    source: "manual",
  }),
  row("second", {
    product_id: "shapes",
    quantity: 250,
    unit: "г",
    month: "2030-04-01",
    category: "Макароны",
    source: "manual",
  }),
];
test("сохранённые ручные позиции макарон отображаются одной карточкой 700 г без изменения исходных строк", () => {
  const snapshot = structuredClone(items);
  const groups = shoppingGroups(items, products);
  expect(groups).toHaveLength(1);
  expect(groups[0].name).toBe("Макароны");
  expect(groups[0].display).toMatchObject({ quantity: 700, unit: "г" });
  expect(groups[0].members).toEqual(items);
  expect(items).toEqual(snapshot);
});
test("граммы и килограммы совместимы, разные категории, месяцы и неизвестные единицы не смешиваются", () => {
  expect(
    shoppingGroups(
      [{ ...items[0], quantity: 0.45, unit: "кг" }, items[1]],
      products,
    )[0].display.quantity,
  ).toBe(700);
  for (const change of [
    { unit: "упаковка" },
    { category: "Другое" },
    { month: "2030-05-01" },
    { family_id: "other" },
  ] as Record<string, string>[])
    expect(
      shoppingGroups([items[0], { ...items[1], ...change }], products),
    ).toHaveLength(2);
});
