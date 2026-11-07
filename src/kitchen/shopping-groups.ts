import { base, factor, num, str, type Row } from "./model";
import {
  ingredientDisplayName,
  ingredientRuleKey,
} from "./ingredient-matching";

export type ShoppingGroup = { display: Row; name: string; members: Row[] };
/** Display-only grouping: original rows and their financial operations stay intact. */
export function shoppingGroups(items: Row[], products: Row[]): ShoppingGroup[] {
  const names = new Map(products.map((p) => [p.id, str(p, "name")]));
  const groups = new Map<string, ShoppingGroup>();
  for (const item of items) {
    const name = names.get(String(item.product_id)) ?? "";
    const unit = base(str(item, "unit"));
    const key = JSON.stringify([
      item.family_id,
      item.month,
      item.category,
      name ? ingredientRuleKey({ name, unit }) : item.product_id,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        name: ingredientDisplayName(name) || "Продукт",
        display: { ...item, quantity: 0, unit },
        members: [],
      };
      groups.set(key, group);
    }
    group.display.quantity =
      num(group.display, "quantity") +
      num(item, "quantity") * factor(str(item, "unit"));
    group.members.push(item);
  }
  return [...groups.values()];
}
