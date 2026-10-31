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
  it("не выдумывает количество для диапазонов, неточных дробей и неизвестных единиц", () => {
    const source =
      "Суп\nИнгредиенты\n1/3 л воды\n2–3 шт. картофеля\nЩепотка соли\nПриготовление\nВарить.";
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

it("преобразует точные обычные, смешанные и типографские дроби", () => {
  const r = parseRecipeText(
    "Тесто\nИнгредиенты\n1/2 л молока\nМука 1 1/2 стакана\n¼ ч. л. соли\n2½ ст. л. масла\nПриготовление\nСмешать.",
  );
  expect(r.ingredients.map((i) => i.amount)).toEqual([
    "0.5",
    "1.5",
    "0.25",
    "2.5",
  ]);
  expect(r.ingredients.map((i) => i.unit)).toEqual([
    "л",
    "стакан",
    "ч. л.",
    "ст. л.",
  ]);
});
it("не подставляет границы диапазона или неверный знаменатель", () => {
  const r = parseRecipeText(
    "Суп\nИнгредиенты\nВода 1–2 л\nСоль 1/0 г\nМука 1/3 стакана\nПриготовление\nВарить.",
  );
  expect(r.ingredients.every((i) => i.amount === null)).toBe(true);
  expect(r.ingredients[0].name).toBe("Вода");
  expect(r.ingredients[0].note).toContain("1–2");
  expect(r.warnings.join()).toContain("Вода");
});
it("отличает нумерованные ингредиенты от шагов и понимает текст без заголовков", () => {
  const r = parseRecipeText(
    "Каша\nИнгредиенты: молоко 200 мл\n1. Крупа 100 г\nСмешать в кастрюле.\n2. Варить 10 минут.",
  );
  expect(r.ingredients).toHaveLength(2);
  expect(r.ingredients[1].name).toBe("Крупа");
  expect(r.steps).toHaveLength(2);
  const plain = parseRecipeText(
    "Салат\nМасло 1 столовая ложка\nСмешать ингредиенты.",
  );
  expect(plain.ingredients[0].unit).toBe("ст. л.");
  expect(plain.steps).toEqual(["Смешать ингредиенты."]);
});
