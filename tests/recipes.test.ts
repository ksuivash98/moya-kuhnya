import { describe, expect, test } from "vitest";
import {
  blankRecipe,
  blankIngredient,
  blankStep,
  moveStep,
  quantity,
  selectRecipes,
  validate,
  categories,
  units,
  type Recipe,
} from "../src/recipes/model";
function data() {
  const d = blankRecipe();
  d.title = "Сырники";
  d.ingredients = [{ ...blankIngredient(), name: "Творог", amount: "500" }];
  d.steps = [{ ...blankStep(), text: "Смешать и приготовить" }];
  return d;
}
describe("Книга рецептов — расчёты и валидация", () => {
  test("порции пересчитываются без изменения исходных количеств", () => {
    const d = data(),
      before = structuredClone(d);
    expect(quantity("500", "г", 4, 8)).toBe("1 000");
    expect(quantity("2", "шт.", 4, 2)).toBe("1");
    expect(quantity("0,25", "л", 4, 6)).toBe("0,375");
    expect(quantity("", "по вкусу", 4, 8)).toBe("");
    expect(d).toEqual(before);
  });
  test("валидная форма и ошибки обязательных полей", () => {
    expect(validate(data())).toBeNull();
    expect(validate({ ...data(), title: " " })).toBeTruthy();
    expect(validate({ ...data(), servings: 0 })).toBeTruthy();
    expect(validate({ ...data(), steps: [] })).toBeTruthy();
    expect(validate({ ...data(), ingredients: [] })).toBeTruthy();
    expect(validate({ ...data(), source: "javascript:alert(1)" })).toBeTruthy();
  });
  test("единицы, количества, точность и время валидируются", () => {
    for (const amount of ["0", "-1", "abc", "0.12345", "1e3", "1000000001"])
      expect(
        validate({
          ...data(),
          ingredients: [{ ...data().ingredients[0], amount }],
        }),
      ).toBeTruthy();
    expect(
      validate({
        ...data(),
        ingredients: [{ ...data().ingredients[0], amount: "1,125" }],
      }),
    ).toBeNull();
    expect(
      validate({
        ...data(),
        ingredients: [
          { ...data().ingredients[0], unit: "по вкусу", amount: "" },
        ],
      }),
    ).toBeNull();
    expect(validate({ ...data(), prep: NaN })).toBeTruthy();
    expect(validate({ ...data(), cook: -1 })).toBeTruthy();
    expect(categories).toHaveLength(12);
    expect(units).toHaveLength(10);
  });
  test("перестановка шагов сохраняет идентификаторы и не меняет оригинал", () => {
    const a = { ...blankStep(), text: "А" },
      b = { ...blankStep(), text: "Б" };
    const steps = [a, b];
    expect(moveStep(steps, 1, -1)).toEqual([b, a]);
    expect(steps).toEqual([a, b]);
    expect(moveStep(steps, 0, -1)).toEqual(steps);
  });
  test("поиск по названию и ингредиентам, категории, избранное и сортировки", () => {
    const a: Recipe = {
        id: "a",
        family_id: "f",
        created_at: "2026-10-01",
        version: 1,
        views: 2,
        data: data(),
      },
      b: Recipe = {
        ...a,
        id: "b",
        created_at: "2026-10-02",
        views: 10,
        data: {
          ...data(),
          title: "Борщ",
          category: "Супы",
          favorite: true,
          cook: 90,
          ingredients: [
            { ...blankIngredient(), name: "Свёкла", amount: "2", unit: "шт." },
          ],
        },
      };
    expect(
      selectRecipes([a, b], "ТВОРОГ", "Все рецепты", "Дата добавления").map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
    expect(
      selectRecipes([a, b], "", "Избранное", "Дата добавления").map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
    expect(
      selectRecipes([a, b], "", "Супы", "Название").map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      selectRecipes([a, b], "", "Все рецепты", "Время приготовления").map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b"]);
    expect(
      selectRecipes([a, b], "", "Все рецепты", "Популярность").map((r) => r.id),
    ).toEqual(["b", "a"]);
    expect(
      selectRecipes([a, b], "", "Все рецепты", "Название").map((r) => r.id),
    ).toEqual(["b", "a"]);
  });
});
