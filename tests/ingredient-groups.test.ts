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

test("обычные макароны: сорт пшеницы и выбор формы объединяются в общий килограмм", () => {
  const result = combineIngredientNeeds([
    need("Макароны из твёрдых сортов пшеницы", 750, "г"),
    need("Макароны (рожки, спирали или перья)", 0.25, "кг"),
  ]);
  expect(result).toMatchObject([
    { name: "Макароны", quantity: 1000, unit: "г" },
  ]);
  expect(result).toHaveLength(1);
  const matched = matchIngredients(
    result,
    [
      {
        id: "pasta",
        name: "Макароны (рожки, спирали или перья)",
        kind: "product",
        unit: "г",
        quantity: 250,
        expires: "",
      },
    ],
    {},
  );
  expect(matched[0]).toMatchObject({ available: 250, missing: 750 });
  expect(
    ingredientChoice(
      { "rule:из макароны пшеницы сортов твердых|г": { sourceId: "pasta" } },
      result[0],
    ),
  ).toEqual({ sourceId: "pasta" });
});
test("макароны с другой мукой, начинкой и после варки остаются отдельными продуктами", () => {
  const result = combineIngredientNeeds([
    need("Макароны", 100, "г"),
    need("Макароны отварные", 100, "г"),
    need("Макароны без глютена", 100, "г"),
    need("Макароны рисовые", 100, "г"),
    need("Макароны с сыром", 100, "г"),
    need("Макароны цельнозерновые", 100, "г"),
  ]);
  expect(result).toHaveLength(6);
});

test("молочные продукты со служебными уточнениями объединяются, отдельные сорта сыра сохраняются", () => {
  const grouped = combineIngredientNeeds([
    need("Сливки 10–20%", 600, "мл"),
    need("сливки", 150, "мл"),
    need("твёрдый сыр (по желанию)", 250, "г"),
    need("Сыр твёрдый (российский, гауда)", 427.5, "г"),
    need("твёрдый сыр", 705, "г"),
    need("Сыр моцарелла", 337.5, "г"),
    need("Сливочное масло для формочек", 10, "г"),
    need("Сливочное масло", 20, "г"),
  ]);
  expect(grouped).toHaveLength(4);
  expect(grouped).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Сливки", quantity: 750, unit: "мл" }),
      expect.objectContaining({
        name: "Твёрдый сыр",
        quantity: 1382.5,
        unit: "г",
      }),
      expect.objectContaining({
        name: "Сливочное масло",
        quantity: 30,
        unit: "г",
      }),
    ]),
  );
  expect(
    ingredientChoice(
      { "rule:25 сметана|г": { sourceId: "old" } },
      need("Сметана", 10, "г"),
    ),
  ).toEqual({ sourceId: "old" });
  const protectedNames = [
    "Сливки для взбивания",
    "Сливки кокосовые",
    "Сметана без лактозы",
    "Сыр плавленый",
    "Молоко кокосовое",
    "Сливочное масло топлёное",
  ];
  expect(
    combineIngredientNeeds(protectedNames.map((name) => need(name, 1, "г"))),
  ).toHaveLength(6);
});

test("овощи: свежесть и форма названия объединяются, виды и обработка сохраняются", () => {
  const combined = combineIngredientNeeds([
    need("Морковь", 831, "г"),
    need("Морковь свежая", 350, "г"),
    need("Огурцы свежие", 200, "г"),
    need("Огурец", 100, "г"),
  ]);
  expect(combined).toMatchObject([
    { name: "Морковь", quantity: 1181 },
    { name: "Огурцы", quantity: 300 },
  ]);
  const names = [
    "Репчатый лук",
    "Зелёный лук",
    "Цветная капуста",
    "белокочанная капуста",
    "Морковь варёная",
    "Огурцы маринованные",
    "Чеснок (головка)",
    "Чеснок",
  ];
  expect(
    combineIngredientNeeds(names.map((name) => need(name, 1, "г"))),
  ).toHaveLength(8);
});
