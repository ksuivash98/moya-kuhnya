import { meals } from "./model";

export type Proposal = {
  recipe_id: string;
  date: string;
  meal: string;
  servings: number;
  reason: string;
};

export function menuError(
  items: Proposal[],
  recipeIds: Set<string>,
  from: string,
  to: string,
): string {
  if (!items.length) return "Добавьте хотя бы одно блюдо в предложение.";
  if (items.length > 100) return "В меню можно добавить до 100 предложений.";
  for (const [index, item] of items.entries()) {
    const prefix = `Предложение ${index + 1}: `;
    if (!recipeIds.has(item.recipe_id))
      return prefix + "выберите доступный рецепт.";
    const date = new Date(item.date + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== item.date ||
      item.date < from ||
      item.date > to
    )
      return prefix + `выберите дату с ${from} по ${to}.`;
    if (!meals.includes(item.meal)) return prefix + "выберите приём пищи.";
    if (
      !Number.isInteger(item.servings) ||
      item.servings < 1 ||
      item.servings > 1000
    )
      return prefix + "укажите целое количество порций от 1 до 1000.";
  }
  return "";
}
