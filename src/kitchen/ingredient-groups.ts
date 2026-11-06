import { base, factor, type Need } from "./model";
import {
  ingredientDisplayName,
  ingredientName,
  ingredientRuleKey,
} from "./ingredient-matching";
/** Quantities are summed only within compatible units, before allocating inventory. */
export function combineIngredientNeeds(needs: Need[]): Need[] {
  const result = new Map<string, Need>();
  for (const need of needs) {
    const unit = base(need.unit),
      key = ingredientRuleKey({ ...need, unit });
    const quantity = need.quantity * factor(need.unit);
    const previous = result.get(key);
    if (previous) previous.quantity += quantity;
    else
      result.set(key, {
        name: ingredientDisplayName(need.name),
        unit,
        quantity,
        available: 0,
        missing: 0,
      });
  }
  return [...result.values()];
}
/** One displayed product can have several quantities when pack size is unknown. */
export function groupIngredientNeeds<
  T extends Pick<Need, "name" | "unit" | "quantity">,
>(needs: T[]) {
  const groups = new Map<string, { key: string; name: string; needs: T[] }>();
  for (const need of needs) {
    let key = ingredientName(need.name);
    if (key.split(" ").includes("бульон"))
      key = key
        .split(" ")
        .filter((w) => w !== "готовый")
        .join(" ");
    const group = groups.get(key) ?? {
      key,
      name: ingredientDisplayName(need.name),
      needs: [],
    };
    group.needs.push(need);
    groups.set(key, group);
  }
  return [...groups.values()];
}
