export const categories = [
  "Супы",
  "Основные блюда",
  "Гарниры",
  "Салаты",
  "Закуски",
  "Выпечка",
  "Десерты",
  "Завтраки",
  "Соусы",
  "Напитки",
  "Заготовки",
  "Другие",
] as const;
export const units = [
  "г",
  "кг",
  "мл",
  "л",
  "шт.",
  "ч. л.",
  "ст. л.",
  "стакан",
  "упаковка",
  "по вкусу",
] as const;
export type Ingredient = {
  id: string;
  name: string;
  amount: string;
  unit: string;
  note: string;
};
export type Step = { id: string; text: string; photo: string };
export type RecipeData = {
  title: string;
  description: string;
  category: string;
  photo: string;
  prep: number;
  cook: number;
  servings: number;
  difficulty: string;
  ingredients: Ingredient[];
  steps: Step[];
  freeze: boolean;
  shelfLife: string;
  storage: string;
  thaw: string;
  notes: string;
  source: string;
  favorite: boolean;
};
export type Recipe = {
  id: string;
  family_id: string;
  data: RecipeData;
  version: number;
  created_at: string;
  views: number;
};
export const blankIngredient = (): Ingredient => ({
  id: crypto.randomUUID(),
  name: "",
  amount: "",
  unit: "г",
  note: "",
});
export const blankStep = (): Step => ({
  id: crypto.randomUUID(),
  text: "",
  photo: "",
});
export const blankRecipe = (): RecipeData => ({
  title: "",
  description: "",
  category: "Основные блюда",
  photo: "",
  prep: 0,
  cook: 30,
  servings: 4,
  difficulty: "Легко",
  ingredients: [blankIngredient()],
  steps: [blankStep()],
  freeze: false,
  shelfLife: "",
  storage: "",
  thaw: "",
  notes: "",
  source: "",
  favorite: false,
});
export function quantity(
  amount: string,
  unit: string,
  original: number,
  target: number,
) {
  if (unit === "по вкусу") return "";
  const n = Number(amount.replace(",", "."));
  if (!amount.trim() || !Number.isFinite(n) || original <= 0 || target <= 0)
    return amount;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(
    (n * target) / original,
  );
}
export function validate(data: RecipeData): string | null {
  if (!data.title.trim() || data.title.length > 200)
    return "Укажите название до 200 символов.";
  if (
    !Number.isInteger(data.servings) ||
    data.servings < 1 ||
    data.servings > 1000
  )
    return "Количество порций должно быть от 1 до 1000.";
  if (
    ![data.prep, data.cook].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 10080,
    )
  )
    return "Время должно быть от 0 до 10080 минут.";
  if (!categories.includes(data.category as (typeof categories)[number]))
    return "Выберите категорию.";
  if (!["Легко", "Средне", "Сложно"].includes(data.difficulty))
    return "Выберите сложность.";
  if (
    !data.ingredients.length ||
    data.ingredients.some(
      (i) =>
        !i.name.trim() ||
        i.name.length > 200 ||
        !units.includes(i.unit as (typeof units)[number]) ||
        (i.unit !== "по вкусу" &&
          (!/^\d+(?:[.,]\d{1,4})?$/.test(i.amount) ||
            !Number.isFinite(Number(i.amount.replace(",", "."))) ||
            Number(i.amount.replace(",", ".")) <= 0 ||
            Number(i.amount.replace(",", ".")) > 1e9)),
    )
  )
    return "Укажите название и положительное количество каждого ингредиента (до 1 млрд, до 4 знаков после запятой).";
  if (!data.steps.length || data.steps.some((s) => !s.text.trim()))
    return "Добавьте хотя бы один шаг и заполните описание каждого шага.";
  if (data.source) {
    try {
      if (!["http:", "https:"].includes(new URL(data.source).protocol))
        return "Источник должен быть HTTP- или HTTPS-ссылкой.";
    } catch {
      return "Проверьте ссылку на источник.";
    }
  }
  return null;
}
export function selectRecipes(
  recipes: Recipe[],
  query: string,
  category: string,
  sort: string,
) {
  const q = query.trim().toLocaleLowerCase("ru");
  return recipes
    .filter(
      (r) =>
        (category === "Все рецепты" ||
          (category === "Избранное"
            ? r.data.favorite
            : r.data.category === category)) &&
        (!q ||
          [r.data.title, ...r.data.ingredients.map((i) => i.name)].some((s) =>
            s.toLocaleLowerCase("ru").includes(q),
          )),
    )
    .sort((a, b) =>
      sort === "Название"
        ? a.data.title.localeCompare(b.data.title, "ru")
        : sort === "Время приготовления"
          ? a.data.prep + a.data.cook - b.data.prep - b.data.cook
          : sort === "Популярность"
            ? b.views - a.views
            : b.created_at.localeCompare(a.created_at),
    );
}
export function moveStep(steps: Step[], index: number, offset: number) {
  const result = [...steps],
    next = index + offset;
  if (index >= 0 && index < result.length && next >= 0 && next < result.length)
    [result[index], result[next]] = [result[next], result[index]];
  return result;
}
export function photoPaths(data: RecipeData) {
  return [
    ...new Set([data.photo, ...data.steps.map((s) => s.photo)].filter(Boolean)),
  ];
}
