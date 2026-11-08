import { proteinProduct } from "./protein-products";
import { base, factor, fmt, num, str, type Row } from "./model";
import { ingredientDisplayName, ingredientName } from "./ingredient-matching";

export type ShoppingGroup = {
  display: Row;
  name: string;
  members: Row[];
  quantities: { quantity: number; unit: string }[];
};
/** Display-only grouping: original rows and their financial operations stay intact. */
export function shoppingGroups(items: Row[], products: Row[]): ShoppingGroup[] {
  const names = new Map(products.map((p) => [p.id, str(p, "name")]));
  const groups = new Map<string, ShoppingGroup>();
  for (const item of items) {
    const name = names.get(String(item.product_id)) ?? "";
    const protein = proteinProduct(name);
    const unit = base(str(item, "unit"));
    const displayUnit = protein?.cooked ? `${unit} готового` : unit;
    const key = JSON.stringify([
      item.family_id,
      item.month,
      item.category,
      name ? (protein?.key ?? ingredientName(name)) : item.product_id,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        name:
          protein?.purchaseName ?? (ingredientDisplayName(name) || "Продукт"),
        display: { ...item, quantity: 0, unit },
        members: [],
        quantities: [],
      };
      groups.set(key, group);
    }
    const quantity = num(item, "quantity") * factor(str(item, "unit"));
    const total = group.quantities.find((q) => q.unit === displayUnit);
    if (total) total.quantity += quantity;
    else group.quantities.push({ unit: displayUnit, quantity });
    group.display.quantity = group.quantities[0].quantity;
    group.members.push(item);
  }
  return [...groups.values()];
}

export function shoppingQuantity(name: string, quantity: number, unit: string) {
  if (ingredientName(name) === "сушеный укроп" && unit === "шт.") {
    const last = quantity % 10,
      hundred = quantity % 100;
    const label = !Number.isInteger(quantity)
      ? "веточки"
      : hundred >= 11 && hundred <= 14
        ? "веточек"
        : last === 1
          ? "веточка"
          : last >= 2 && last <= 4
            ? "веточки"
            : "веточек";
    return `${fmt(quantity)} ${label}`;
  }
  return `${fmt(quantity)} ${unit}`;
}
export function shoppingGroupQuantity(group: ShoppingGroup) {
  const order: Record<string, number> = { г: 0, мл: 1, "шт.": 2, упаковка: 3 };
  return [...group.quantities]
    .sort(
      (a, b) =>
        (order[a.unit] ?? 4) - (order[b.unit] ?? 4) ||
        a.unit.localeCompare(b.unit, "ru"),
    )
    .map((q) => shoppingQuantity(group.name, q.quantity, q.unit))
    .join(" + ");
}
