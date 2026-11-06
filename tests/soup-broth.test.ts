import { expect, test } from "vitest";
import { soupBroth } from "../src/kitchen/soup-broth";
import type { Row, State, Json } from "../src/kitchen/model";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "f",
  version: 1,
  ...data,
});
const soup = row("soup", { title: "Суп", unit: "порц.", quantity: 4 });
const menu = row("menu", {
  title: "Суп",
  recipe_snapshot: {
    category: "Супы",
    servings: 4,
    ingredients: [
      { name: "Готовый куриный бульон", amount: "1200", unit: "мл" },
    ],
  },
});
const broth = row("broth", {
  title: "Куриный бульон",
  unit: "мл",
  quantity: 1500,
  expires_on: "2099-01-01",
});
const state: State = { schema_version: 17, preparations: [soup, broth] };
test("бульон рассчитывается пропорционально фактически используемым порциям супа", () => {
  const result = soupBroth(state, menu, soup, "2", {});
  expect(result.needs[0].quantity).toBe(600);
  expect(result.suggested(result.preferred)).toBe("600");
  expect(soupBroth(state, menu, soup, "1", {}).suggested(broth)).toBe("300");
});
test("для неизвестного веса порции и супа в граммах количество бульона вводится явно", () => {
  const portion = { ...broth, unit: "порц.", quantity: 2 };
  const s = { ...state, preparations: [soup, portion] };
  expect(soupBroth(s, menu, soup, "2", {}).suggested(portion)).toBe("");
  expect(
    soupBroth(s, menu, soup, "2", {
      "готовый куриный бульон|мл": {
        sourceId: "preparation:broth",
        ratio: 600,
      },
    }).suggested(portion),
  ).toBe("1");
  expect(
    soupBroth(state, menu, { ...soup, unit: "г" }, "500", {}).suggested(broth),
  ).toBe("");
});
test("не предлагаются сам суп, чужие, нулевые и просроченные заготовки", () => {
  const s = {
    ...state,
    preparations: [
      { ...soup, title: "Бульон суп" },
      { ...broth, id: "expired", expires_on: "2000-01-01" },
      { ...broth, id: "zero", quantity: 0 },
      { ...broth, id: "foreign", family_id: "other" },
      broth,
    ],
  };
  expect(soupBroth(s, menu, soup, "1", {}).candidates.map((p) => p.id)).toEqual(
    ["broth"],
  );
  const borscht = {
    ...menu,
    title: "Борщ",
    recipe_snapshot: { category: "Супы", servings: 4, ingredients: [] },
  };
  expect(soupBroth(state, borscht, soup, "1", {}).relevant).toBe(true);
});
