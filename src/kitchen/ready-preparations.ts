import {
  rows,
  str,
  num,
  today,
  type Row,
  type State,
  type Need,
} from "./model";
import {
  ingredientChoice,
  type IngredientChoices,
} from "./ingredient-matching";
const unfinished = (row: Row) =>
  ![
    "Отменено",
    "Приготовлено",
    "Сделана заготовка",
    "Приготовлено из заготовки",
  ].includes(str(row, "status"));
export function readyPreparations(
  state: State,
  family: string,
  row: Row,
  needs: Need[],
  choices: IngredientChoices,
) {
  const isTask = row.checked_steps !== undefined;
  const menu = rows(state, "menu_items").find(
    (m) =>
      m.family_id === family &&
      m.id === (isTask ? row.menu_id : row.id) &&
      m.recipe_id === row.recipe_id &&
      unfinished(m),
  );
  const tasks = menu
    ? rows(state, "cooking_tasks")
        .filter(
          (t) =>
            t.family_id === family && t.menu_id === menu.id && unfinished(t),
        )
        .sort(
          (a, b) =>
            str(a, "date").localeCompare(str(b, "date")) ||
            a.id.localeCompare(b.id),
        )
    : [];
  const eligible = !!menu && (!isTask || tasks[0]?.id === row.id);
  const preparations = rows(state, "preparations")
    .filter(
      (p) =>
        p.family_id === family &&
        !!str(row, "recipe_id") &&
        p.recipe_id === row.recipe_id &&
        num(p, "quantity") > 0 &&
        (!p.expires_on || str(p, "expires_on") >= today()),
    )
    .sort(
      (a, b) =>
        (str(a, "expires_on") || "9999-12-31").localeCompare(
          str(b, "expires_on") || "9999-12-31",
        ) || a.id.localeCompare(b.id),
    );
  const counts = new Map<string, number>();
  for (const need of needs) {
    if (need.quantity <= 0) continue;
    const source = ingredientChoice(choices, need)?.sourceId;
    if (source?.startsWith("preparation:")) {
      const id = source.slice(12);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const shared = preparations.find((p) => (counts.get(p.id) ?? 0) > 1);
  return {
    menu,
    preparations,
    eligible,
    shared,
    sharedCount: shared ? counts.get(shared.id)! : 0,
    allShared:
      !!shared &&
      counts.get(shared.id) === needs.filter((n) => n.quantity > 0).length,
  };
}
