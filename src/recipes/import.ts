import {
  validateExtraction,
  type ExtractedRecipe,
} from "../../supabase/functions/_shared/recipe-import";
import {
  blankRecipe,
  blankIngredient,
  blankStep,
  type RecipeData,
} from "./model";
import { client } from "../supabase";
export type { ExtractedRecipe };
export type ImportSource =
  | { kind: "text"; text: string }
  | { kind: "photo"; image: string };
export function importDraft(raw: unknown): {
  data: RecipeData;
  warnings: string[];
} {
  const r = validateExtraction(raw);
  if (!r.is_recipe)
    throw new Error(
      "В источнике не удалось найти рецепт. Выберите более чёткое фото или другой текст.",
    );
  const warnings = [...r.warnings];
  if (!r.title?.trim()) warnings.push("Название не найдено — заполните его.");
  if (r.servings === null)
    warnings.push("Количество порций не указано — заполните его.");
  if (r.prep === null || r.cook === null)
    warnings.push(
      "Время указано не полностью. Укажите минуты; 0 — если этот этап не требуется.",
    );
  if (!r.category)
    warnings.push("Категория не определена, выбрана «Другие». Проверьте её.");
  if (!r.difficulty)
    warnings.push("Сложность не указана, выбрана «Легко». Проверьте её.");
  if (!r.ingredients.length)
    warnings.push("Ингредиенты не найдены — добавьте их.");
  if (!r.steps.length)
    warnings.push("Шаги не найдены — заполните их по источнику.");
  const data = {
    ...blankRecipe(),
    title: r.title ?? "",
    description: r.description ?? "",
    category: r.category ?? "Другие",
    difficulty: r.difficulty ?? "Легко",
    prep: r.prep ?? NaN,
    cook: r.cook ?? NaN,
    servings: r.servings ?? NaN,
    ingredients: r.ingredients.length
      ? r.ingredients.map((i) => {
          if (i.unit === null || (i.amount === null && i.unit !== "по вкусу"))
            warnings.push(
              `«${i.name}»: проверьте количество и единицу измерения.`,
            );
          return {
            ...blankIngredient(),
            name: i.name,
            amount: i.amount ?? "",
            unit: i.unit ?? "",
            note: i.note,
          };
        })
      : [blankIngredient()],
    steps: r.steps.length
      ? r.steps.map((text) => ({ ...blankStep(), text }))
      : [blankStep()],
    notes: r.notes,
  };
  return { data, warnings: [...new Set(warnings)] };
}
export async function recognizeRecipe(
  id: string,
  familyId: string,
  source: ImportSource,
) {
  if (!navigator.onLine)
    throw new Error(
      "Для распознавания требуется интернет. Данные не отправлены.",
    );
  const { data, error } = await client().functions.invoke("recipe-import", {
    body: { id, family_id: familyId, consent: true, source },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response instanceof Response) {
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      if (typeof body?.error === "string") throw new Error(body.error);
    }
    throw new Error(
      "Не удалось связаться с распознаванием. Проверьте интернет и развёртывание функции recipe-import в Supabase. Рецепт не сохранён; повтор использует прежний идентификатор.",
    );
  }
  return validateExtraction(data?.result);
}
export function imageData(blob: Blob): Promise<string> {
  if (blob.size > 3145728)
    return Promise.reject(
      new Error(
        "Фото после сжатия больше 3 МБ. Выберите меньший фрагмент с рецептом.",
      ),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать фотографию"));
    reader.readAsDataURL(blob);
  });
}
