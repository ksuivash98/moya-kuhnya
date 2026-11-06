import { combineIngredientNeeds } from "./ingredient-groups";
import { needs, rows, str, type State } from "./model";
export type PlanScope = {
  month: string;
  kind?: "menu" | "cooking";
  from?: string;
  to?: string;
};
export function planRequirements(state: State, scope: PlanScope) {
  const dated = !!scope.from && !!scope.to;
  const inRange = (row: Parameters<typeof str>[0]) =>
    !!str(row, "date") &&
    str(row, "date") >= scope.from! &&
    str(row, "date") <= scope.to!;
  const menu =
    scope.kind === "cooking"
      ? []
      : rows(state, "menu_items").filter((r) =>
          dated ? inRange(r) : str(r, "month") === scope.month + "-01",
        );
  const tasks = rows(state, "cooking_tasks").filter((r) =>
    dated ? inRange(r) : str(r, "date").startsWith(scope.month),
  );
  return combineIngredientNeeds(needs(state, [...menu, ...tasks]));
}
