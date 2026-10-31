import { describe, expect, it } from "vitest";
import { parseRecipeText } from "../src/recipes/local-import";
describe("локальный разбор рецептов", () => {
  it("выделяет ингредиенты с количеством до и после названия, шаги и порции", () => {
    const r = parseRecipeText(
      "Сырники\nПорции: 4\nИнгредиенты:\n500 г творога\nМука — 2 ст. л.\nСоль по вкусу\nПриготовление:\n1. Смешать.\n2. Обжарить.",
    );
    expect(r.title).toBe("Сырники");
    expect(r.servings).toBe(4);
    expect(r.ingredients.map((i) => [i.amount, i.unit])).toEqual([
      ["500", "г"],
      ["2", "ст. л."],
      [null, "по вкусу"],
    ]);
    expect(r.ingredients[1].name).toBe("Мука");
    expect(r.steps).toEqual(["Смешать.", "Обжарить."]);
  });
  it("не выдумывает количество для диапазонов, дробей и неизвестных единиц", () => {
    const source =
      "Суп\nИнгредиенты\n1/2 л воды\n2–3 шт. картофеля\nЩепотка соли\nПриготовление\nВарить.";
    const r = parseRecipeText(source);
    expect(r.ingredients.every((i) => i.amount === null)).toBe(true);
    expect(r.notes).toBe(source);
  });
  it("поддерживает десятичную запятую и явно заданное время", () => {
    const r = parseRecipeText(
      "Каша\nПодготовка: 10 мин\nПриготовление: 20 минут\nИнгредиенты\nМолоко 0,5 л\nПриготовление\nВарить.",
    );
    expect(r.ingredients[0].amount).toBe("0.5");
    expect(r.prep).toBe(10);
    expect(r.cook).toBe(20);
  });
  it("сохраняет неизвестные строки в исходнике и оставляет отсутствующие поля пустыми", () => {
    const r = parseRecipeText(
      "Суп\nОсобый семейный совет\nИнгредиенты\nКартофель\nПриготовление\nВарить.",
    );
    expect(r.notes).toContain("Особый семейный совет");
    expect(r.servings).toBeNull();
    expect(r.cook).toBeNull();
    expect(r.ingredients[0].unit).toBeNull();
  });
  it("отклоняет пустой, слишком длинный текст и текст без рецепта", () => {
    for (const s of ["", "x".repeat(20001), "Привет, мир"])
      expect(() => parseRecipeText(s)).toThrow();
  });
  it("ограничивает количество ингредиентов без молчаливого обрезания", () => {
    expect(() =>
      parseRecipeText(
        "Суп\nИнгредиенты\n" + Array(101).fill("Соль").join("\n"),
      ),
    ).toThrow("максимум");
  });
});
