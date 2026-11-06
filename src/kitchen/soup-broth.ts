import {
  ingredients,
  snapshot,
  rows,
  str,
  num,
  base,
  factor,
  today,
  type Row,
  type State,
  type Need,
} from "./model";
import {
  ingredientName,
  ingredientChoice,
  sourceRatio,
  type IngredientChoices,
} from "./ingredient-matching";
export function soupBroth(
  state: State,
  menu: Row,
  soup: Row | undefined,
  quantity: string,
  choices: IngredientChoices,
) {
  const isBroth = (name: string) =>
    ingredientName(name).split(" ").includes("бульон");
  const requirements = ingredients(menu).filter(
    (i) =>
      isBroth(str(i, "name")) && i.unit !== "по вкусу" && i.amount !== null,
  );
  const candidates = rows(state, "preparations")
    .filter(
      (p) =>
        p.family_id === menu.family_id &&
        p.id !== soup?.id &&
        num(p, "quantity") > 0 &&
        (!p.expires_on || str(p, "expires_on") >= today()) &&
        isBroth(str(p, "title")) &&
        !ingredientName(str(p, "title"))
          .split(" ")
          .some(
            (w) =>
              ["суп", "соус", "салат"].includes(w) ||
              /^(сух|концентр|кубик)/.test(w),
          ),
    )
    .sort(
      (a, b) =>
        (str(a, "expires_on") || "9999-12-31").localeCompare(
          str(b, "expires_on") || "9999-12-31",
        ) || a.id.localeCompare(b.id),
    );
  const used = Number(quantity.replace(",", ".")),
    servings = Number(snapshot(menu).servings);
  const canScale =
    soup?.unit === "порц." &&
    Number.isFinite(used) &&
    used > 0 &&
    Number.isFinite(servings) &&
    servings > 0;
  const needs: Need[] = canScale
    ? requirements.map((i) => ({
        name: str(i, "name"),
        unit: base(str(i, "unit")),
        quantity: (num(i, "amount") * factor(str(i, "unit")) * used) / servings,
        available: 0,
        missing: 0,
      }))
    : [];
  const preferred =
    candidates.find((source) =>
      needs.some(
        (n) =>
          ingredientChoice(choices, n)?.sourceId === `preparation:${source.id}`,
      ),
    ) ?? candidates[0];
  const suggested = (source: Row | undefined): string => {
    if (!source || !needs.length) return "";
    let amount = 0;
    for (const need of needs) {
      const choice = ingredientChoice(choices, need);
      const ratio = sourceRatio(
        need,
        { name: str(source, "title"), unit: str(source, "unit") },
        choice?.sourceId === `preparation:${source.id}`
          ? choice.ratio
          : undefined,
      );
      if (ratio === undefined) return "";
      amount += need.quantity / ratio;
    }
    return Number(amount.toFixed(4)) > 0
      ? Number(amount.toFixed(4)).toString()
      : "";
  };
  return {
    relevant:
      snapshot(menu).category === "Супы" ||
      (Array.isArray(snapshot(menu).categories) &&
        (snapshot(menu).categories as string[]).includes("Супы")) ||
      requirements.length > 0 ||
      ingredientName(str(menu, "title")).split(" ").includes("суп"),
    candidates,
    preferred,
    needs,
    suggested,
  };
}
