// Общий контракт браузера и Edge Function. Здесь нет ключей или клиентских ID.
export const importUnits = [
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
];
export const importCategories = [
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
];
export type ExtractedRecipe = {
  is_recipe: boolean;
  title: string | null;
  description: string | null;
  category: string | null;
  prep: number | null;
  cook: number | null;
  servings: number | null;
  difficulty: string | null;
  ingredients: {
    name: string;
    amount: string | null;
    unit: string | null;
    note: string;
  }[];
  steps: string[];
  notes: string;
  warnings: string[];
};
const nullableString = { type: ["string", "null"] };
export const extractionSchema = {
  type: "object",
  properties: {
    is_recipe: { type: "boolean" },
    title: nullableString,
    description: nullableString,
    category: { type: ["string", "null"], enum: [...importCategories, null] },
    prep: { type: ["integer", "null"] },
    cook: { type: ["integer", "null"] },
    servings: { type: ["integer", "null"] },
    difficulty: {
      type: ["string", "null"],
      enum: ["Легко", "Средне", "Сложно", null],
    },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: nullableString,
          unit: { type: ["string", "null"], enum: [...importUnits, null] },
          note: { type: "string" },
        },
        required: ["name", "amount", "unit", "note"],
        additionalProperties: false,
      },
    },
    steps: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "is_recipe",
    "title",
    "description",
    "category",
    "prep",
    "cook",
    "servings",
    "difficulty",
    "ingredients",
    "steps",
    "notes",
    "warnings",
  ],
  additionalProperties: false,
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Некорректный ответ распознавания");
  return v as Record<string, unknown>;
}
function string(v: unknown, max: number, nullable = false) {
  return (nullable && v === null) || (typeof v === "string" && v.length <= max);
}
export function validateExtraction(value: unknown): ExtractedRecipe {
  const r = object(value);
  if (
    Object.keys(r).sort().join() !==
      [...extractionSchema.required].sort().join() ||
    typeof r.is_recipe !== "boolean" ||
    !string(r.title, 200, true) ||
    !string(r.description, 10000, true) ||
    !string(r.notes, 10000) ||
    !(r.category === null || importCategories.includes(String(r.category))) ||
    !(
      r.difficulty === null ||
      ["Легко", "Средне", "Сложно"].includes(String(r.difficulty))
    ) ||
    !["prep", "cook", "servings"].every(
      (k) =>
        r[k] === null ||
        (Number.isInteger(r[k]) &&
          Number(r[k]) >= (k === "servings" ? 1 : 0) &&
          Number(r[k]) <= (k === "servings" ? 1000 : 10080)),
    ) ||
    !Array.isArray(r.ingredients) ||
    r.ingredients.length > 100 ||
    !Array.isArray(r.steps) ||
    r.steps.length > 100 ||
    !r.steps.every((s) => string(s, 10000) && String(s).trim()) ||
    !Array.isArray(r.warnings) ||
    r.warnings.length > 30 ||
    !r.warnings.every((s) => string(s, 1000))
  )
    throw new Error("Некорректный ответ распознавания");
  for (const raw of r.ingredients) {
    const i = object(raw);
    if (
      Object.keys(i).sort().join() !== "amount,name,note,unit" ||
      !string(i.name, 200) ||
      !String(i.name).trim() ||
      !string(i.note, 2000) ||
      !(i.unit === null || importUnits.includes(String(i.unit))) ||
      !(
        i.amount === null ||
        (typeof i.amount === "string" &&
          /^\d+(?:[.,]\d{1,4})?$/.test(i.amount) &&
          Number(i.amount.replace(",", ".")) > 0 &&
          Number(i.amount.replace(",", ".")) <= 1e9)
      )
    )
      throw new Error("Некорректные ингредиенты в ответе распознавания");
  }
  return r as ExtractedRecipe;
}
