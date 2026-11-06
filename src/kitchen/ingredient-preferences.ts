import type { IngredientChoices } from "./ingredient-matching";
export const ingredientChoicesKey = (userId: string, family: string) =>
  `kitchen-ingredient-matches:${userId}:${family}`;
export function readIngredientChoices(
  userId: string,
  family: string,
): IngredientChoices {
  const key = ingredientChoicesKey(userId, family);
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const choices: IngredientChoices = {};
    for (const [key, v] of Object.entries(value).slice(0, 1000)) {
      const c = v as {
        sourceId?: unknown;
        ratio?: unknown;
        allowPreparationSubstitution?: unknown;
      };
      if (
        c &&
        typeof c.sourceId === "string" &&
        (c.ratio === undefined ||
          (typeof c.ratio === "number" &&
            Number.isFinite(c.ratio) &&
            c.ratio > 0))
      )
        choices[key] = {
          sourceId: c.sourceId,
          ...(typeof c.ratio === "number" ? { ratio: c.ratio } : {}),
          ...(c.allowPreparationSubstitution === true
            ? { allowPreparationSubstitution: true }
            : {}),
        };
    }
    return choices;
  } catch {
    return {};
  }
}
