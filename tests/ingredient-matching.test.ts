import { expect, test } from "vitest";
import {
  ingredientKey,
  ingredientName,
  inventorySources,
  automaticMatch,
  matchIngredients,
  bulkIngredientSuggestions,
  ingredientChoice,
  ingredientRuleKey,
  setIngredientChoice,
  type InventorySource,
} from "../src/kitchen/ingredient-matching";
import type { Json, Need, Row, State } from "../src/kitchen/model";
const row = (id: string, data: Record<string, Json> = {}): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const need = (name: string, quantity = 100, unit = "г"): Need => ({
  name,
  quantity,
  unit,
  available: 0,
  missing: quantity,
});
const source = (
  name: string,
  quantity = 100,
  unit = "г",
  kind: "product" | "preparation" = "product",
  id = "s",
): InventorySource => ({
  id,
  name,
  quantity,
  unit,
  kind,
  expires: "2099-01-01",
});

test("совпадения: порядок слов, е/ё, формы названий; сырое и отварное не смешиваются", () => {
  for (const [a, b] of [
    ["Картофель", "картошка"],
    ["Морковь", "моркови"],
    ["Репчатый лук", "лук"],
    ["Яйца", "яйцо"],
    ["Отварное куриное мясо", "Курица отварная"],
    ["Свёкла", "свекла"],
  ])
    expect(ingredientName(a)).toBe(ingredientName(b));
  expect(
    automaticMatch(need("Отварное куриное мясо"), source("Курица", 200)),
  ).toBe(false);
  expect(
    automaticMatch(
      need("Яичная лапша (сухая)"),
      source("Яичная лапша варёная", 200, "г", "preparation"),
    ),
  ).toBe(false);
  expect(automaticMatch(need("Лук зелёный"), source("Лук", 200))).toBe(false);
  expect(
    automaticMatch(
      need("Готовый куриный бульон", 1200, "мл"),
      source("Бульон куриный", 1500, "мл", "preparation"),
    ),
  ).toBe(true);
});

test("источники: только своя семья, непросроченный положительный остаток; кг/л приводятся к г/мл", () => {
  const state: State = {
    schema_version: 9,
    products: [
      row("p", { name: "Картошка" }),
      row("arch", { name: "Морковь", archived: true }),
      row("foreign", { name: "Картофель", family_id: "other" }),
    ],
    stock_batches: [
      row("a", { product_id: "p", quantity: 0.5, unit: "кг" }),
      row("b", { product_id: "p", quantity: 100, unit: "г" }),
      row("old", {
        product_id: "p",
        quantity: 900,
        unit: "г",
        expires_on: "2000-01-01",
      }),
      row("zero", { product_id: "p", quantity: 0, unit: "г" }),
      row("hidden", { product_id: "arch", quantity: 100, unit: "г" }),
      row("other", {
        product_id: "foreign",
        quantity: 5000,
        unit: "г",
        family_id: "other",
      }),
    ],
    preparations: [
      row("broth", {
        title: "Куриный бульон",
        quantity: 1.2,
        unit: "л",
        expires_on: "2099-01-01",
      }),
      row("expired", {
        title: "Куриный бульон",
        quantity: 10,
        unit: "л",
        expires_on: "2000-01-01",
      }),
      row("empty", { title: "Куриный бульон", quantity: 0, unit: "л" }),
      row("another", {
        title: "Куриный бульон",
        quantity: 20,
        unit: "л",
        family_id: "other",
      }),
    ],
  };
  const sources = inventorySources(state, "f");
  expect(sources).toHaveLength(2);
  expect(sources.find((s) => s.kind === "product")?.quantity).toBe(600);
  expect(sources.find((s) => s.kind === "preparation")).toMatchObject({
    quantity: 1200,
    unit: "мл",
  });
  const matched = matchIngredients(
    [need("Картофель", 240), need("Готовый куриный бульон", 1200, "мл")],
    sources,
    {},
  );
  expect(matched.map((n) => n.available)).toEqual([600, 1200]);
  expect(matched.map((n) => n.missing)).toEqual([0, 0]);
});

test("похожие названия предлагаются, но неоднозначная замена требует выбора", () => {
  const n = need("Растительное масло", 6.4, "мл");
  const sources = [
    source("Масло подсолнечное", 100, "мл", "product", "sun"),
    source("Масло сливочное", 100, "г", "product", "butter"),
  ];
  const initial = matchIngredients([n], sources, {})[0];
  expect(initial.available).toBe(0);
  expect(initial.suggestions.map((s) => s.id)).toContain("sun");
  const chosen = matchIngredients([n], sources, {
    [ingredientKey(n)]: { sourceId: "sun" },
  })[0];
  expect(chosen.available).toBe(100);
  expect(chosen.missing).toBe(0);
});

test("один остаток не засчитывается дважды для разных названий ингредиента", () => {
  const inputs = [need("Лук", 60), need("Репчатый лук", 60)];
  const sources = [source("Лук репчатый", 100)];
  const before = JSON.stringify({ inputs, sources });
  const matched = matchIngredients(inputs, sources, {});
  expect(matched.map((n) => n.available)).toEqual([100, 40]);
  expect(matched.map((n) => n.missing)).toEqual([0, 20]);
  expect(JSON.stringify({ inputs, sources })).toBe(before);
});

test("заготовки в порциях учитываются только с явным пересчётом, остаток распределяется между строками", () => {
  const broth = source("Куриный бульон", 1.5, "порц.", "preparation");
  const first = need("Готовый куриный бульон", 1000, "мл"),
    second = need("Бульон куриный", 400, "мл");
  for (const ratio of [undefined, 0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    const result = matchIngredients([first], [broth], {
      [ingredientKey(first)]: { sourceId: "s", ratio },
    })[0];
    expect(result.available).toBe(0);
    expect(result.conversionRequired).toBe(true);
  }
  const result = matchIngredients([first, second], [broth], {
    [ingredientKey(first)]: { sourceId: "s", ratio: 800 },
    [ingredientKey(second)]: { sourceId: "s", ratio: 800 },
  });
  expect(result[0].available).toBe(1200);
  expect(result[1].available).toBe(200);
  expect(result[1].missing).toBe(200);
});

test("исчезнувший источник и явный отказ от учёта не заменяются другим запасом молча", () => {
  const n = need("Морковь");
  const sources = [source("Морковь", 100)];
  expect(
    matchIngredients([n], sources, {
      [ingredientKey(n)]: { sourceId: "old" },
    })[0],
  ).toMatchObject({ available: 0, missing: 100, unavailable: true });
  expect(
    matchIngredients([n], sources, {
      [ingredientKey(n)]: { sourceId: "none" },
    })[0],
  ).toMatchObject({ available: 0, missing: 100, unavailable: false });
});

test("общий подбор заранее предлагает уникальные варианты и объединяет повторные названия", () => {
  const first = need("Растительное масло", 6.4, "мл"),
    second = need("Масло растительное", 10, "мл");
  const sources = [source("Масло подсолнечное", 100, "мл", "product", "sun")];
  const proposals = bulkIngredientSuggestions(
    matchIngredients([first, second], sources, {}),
    sources,
    {},
  );
  expect(proposals).toHaveLength(1);
  expect(proposals[0].choice).toEqual({ sourceId: "sun" });
  expect(proposals[0].need.quantity).toBeCloseTo(16.4);
  const choices = setIngredientChoice({}, first, proposals[0].choice);
  expect(ingredientChoice(choices, second)).toEqual({ sourceId: "sun" });
  const matched = matchIngredients([first, second], sources, choices);
  expect(matched.map((n) => n.missing)).toEqual([0, 0]);
  expect(matched[1].available).toBeCloseTo(93.6);
  expect(bulkIngredientSuggestions(matched, sources, choices)).toHaveLength(0);
});

test("общий подбор не выбирает равные варианты и не подменяет отварное сырым", () => {
  const oil = need("Растительное масло", 10, "мл");
  const oils = [
    source("Масло подсолнечное", 100, "мл", "product", "a"),
    source("Масло оливковое", 100, "мл", "product", "b"),
  ];
  expect(
    bulkIngredientSuggestions(matchIngredients([oil], oils, {}), oils, {})[0]
      .choice,
  ).toBeUndefined();
  const meat = need("Отварное куриное мясо");
  const raw = [source("Курица", 200)];
  expect(
    bulkIngredientSuggestions(matchIngredients([meat], raw, {}), raw, {})[0]
      .choice,
  ).toBeUndefined();
  const pasta = need("Яичная лапша (сухая)");
  const cooked = [source("Яичная лапша варёная", 200, "г", "preparation")];
  expect(
    bulkIngredientSuggestions(
      matchIngredients([pasta], cooked, {}),
      cooked,
      {},
    )[0].choice,
  ).toBeUndefined();
});

test("ранее сохранённые соответствия переиспользуются, общий выбор сохраняет единицы и устраняет старые дубли", () => {
  const a = need("Растительное масло", 10, "мл"),
    b = need("Масло растительное", 20, "мл"),
    c = need("Масло (растительное)", 20, "мл");
  const legacy = { [ingredientKey(a)]: { sourceId: "old", ratio: 2 } };
  expect(ingredientChoice(legacy, b)).toEqual({ sourceId: "old", ratio: 2 });
  expect(
    ingredientChoice(legacy, need("Масло растительное", 10, "г")),
  ).toBeUndefined();
  const conflict = { ...legacy, [ingredientKey(b)]: { sourceId: "another" } };
  expect(ingredientChoice(conflict, c)).toBeUndefined();
  const next = setIngredientChoice(conflict, c, { sourceId: "new" });
  expect(Object.keys(next)).toEqual([ingredientRuleKey(c)]);
  expect(ingredientChoice(next, a)).toEqual({ sourceId: "new" });
  expect(ingredientChoice(next, b)).toEqual({ sourceId: "new" });
  expect(setIngredientChoice(next, a)).toEqual({});
});

test("порции в общем подборе остаются с явным коэффициентом; подтверждённые решения не заменяются", () => {
  const broth = need("Готовый куриный бульон", 1200, "мл"),
    variant = need("Бульон куриный", 100, "мл");
  const sources = [source("Куриный бульон", 2, "порц.", "preparation")];
  const proposals = bulkIngredientSuggestions(
    matchIngredients([broth], sources, {}),
    sources,
    {},
  );
  expect(proposals[0].choice).toEqual({ sourceId: "s" });
  expect(
    matchIngredients(
      [broth],
      sources,
      setIngredientChoice({}, broth, proposals[0].choice),
    )[0].conversionRequired,
  ).toBe(true);
  const choices = setIngredientChoice({}, broth, { sourceId: "s", ratio: 800 });
  expect(ingredientChoice(choices, variant)).toEqual({
    sourceId: "s",
    ratio: 800,
  });
  expect(
    bulkIngredientSuggestions(
      matchIngredients([broth], sources, choices),
      sources,
      choices,
    ),
  ).toHaveLength(0);
  const declined = setIngredientChoice({}, broth, { sourceId: "none" });
  expect(
    bulkIngredientSuggestions(
      matchIngredients([broth], sources, declined),
      sources,
      declined,
    ),
  ).toHaveLength(0);
});

test("общий подбор находит единственный продукт с маркой и дополнительными словами в названии", () => {
  const milk = need("Молоко", 100, "мл");
  const sources = [
    source("Молоко пастеризованное Домик 2.5%", 1000, "мл", "product", "milk"),
  ];
  const proposals = bulkIngredientSuggestions(
    matchIngredients([milk], sources, {}),
    sources,
    {},
  );
  expect(proposals[0].choice).toEqual({ sourceId: "milk" });
});
