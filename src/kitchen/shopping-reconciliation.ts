import { automaticBaseUnit, isSpoon } from "./unit-conversion";
import { base, factor, num, rows, str, type Row, type State } from "./model";
import {
  ingredientChoice,
  sourceRatio,
  ingredientName,
  ingredientRuleKey,
  inventorySources,
  matchIngredients,
  type IngredientChoices,
  type MatchedNeed,
} from "./ingredient-matching";
import { planRequirements, type PlanScope } from "./plan-requirements";
export const isManagedShopping = (r: Row) =>
  r.source === "generated" ||
  (/^a17e[0-9a-f-]{32}$/i.test(r.id) && r.id[14] === "8");
export async function stableShoppingId(
  namespace: string,
  value: string,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}:${value}`),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  let hex = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (namespace === "shopping") hex = "a17e" + hex.slice(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type ShoppingTarget = {
  product?: Row;
  name: string;
  unit: string;
  quantity: number;
  aliases: Set<string>;
  needs: MatchedNeed[];
};
export function shoppingPlan(
  state: State,
  family: string,
  scope: PlanScope,
  choices: IngredientChoices,
) {
  const products = rows(state, "products").filter(
    (p) => p.family_id === family && !p.archived,
  );
  const items = rows(state, "shopping_items").filter(
    (r) => r.family_id === family && str(r, "month") === scope.month + "-01",
  );
  const manual = items.filter(
    (r) => r.status === "open" && !isManagedShopping(r),
  );
  const productById = new Map(products.map((p) => [p.id, p]));
  const identity = (name: string, unit: string) =>
    ingredientRuleKey({ name, unit });
  const matched = matchIngredients(
    planRequirements(state, scope),
    inventorySources(state, family),
    choices,
  );
  const groups = new Map<string, ShoppingTarget>();
  const scales = new Map<MatchedNeed, number>();
  const errors: string[] = [],
    warnings: string[] = [];
  for (const n of matched) {
    if (n.missing <= 0.00000001) continue;
    const choice = ingredientChoice(choices, n);
    const chosenId = !n.sourceMismatch
      ? choice?.sourceId.match(/^product:([0-9a-f-]{36}):/)?.[1]
      : undefined;
    let product = chosenId ? productById.get(chosenId) : undefined;
    product ??= n.matchedSources
      .filter((s) => s.kind === "product")
      .map((s) => productById.get(s.id.split(":")[1]))
      .find(Boolean);
    const equivalent = products.filter(
      (p) => identity(str(p, "name"), n.unit) === identity(n.name, n.unit),
    );
    product ??=
      equivalent.find((p) => manual.some((i) => i.product_id === p.id)) ??
      equivalent[0];
    if (
      !product &&
      rows(state, "products").some(
        (p) =>
          p.family_id === family &&
          p.archived &&
          identity(str(p, "name"), n.unit) === identity(n.name, n.unit),
      )
    ) {
      errors.push(
        `«${n.name}» находится в архиве. Восстановите продукт в редакторе.`,
      );
      continue;
    }
    let unit = n.unit,
      quantity = n.missing;
    if (isSpoon(n.unit)) {
      const selected = n.matchedSources.find(
        (source) => source.id === choice?.sourceId,
      );
      const manualUnit =
        selected?.unit ??
        choice?.sourceId.match(/^product:[0-9a-f-]{36}:(.+)$/)?.[1];
      const target =
        choice?.ratio !== undefined &&
        manualUnit &&
        ["г", "мл"].includes(manualUnit)
          ? manualUnit
          : automaticBaseUnit(ingredientName(n.name), n.unit);
      if (target) {
        const ratio =
          choice?.ratio !== undefined && target === manualUnit
            ? choice.ratio
            : sourceRatio(n, {
                name: product ? str(product, "name") : n.name,
                unit: target,
              });
        if (ratio !== undefined && ratio > 0) {
          unit = target;
          quantity = n.missing / ratio;
        }
      }
    }
    scales.set(n, quantity / n.missing);
    const key = `${product?.id ?? identity(n.name, unit)}|${unit}`;
    const group = groups.get(key) ?? {
      product,
      name: product ? str(product, "name") : n.name,
      unit,
      quantity: 0,
      aliases: new Set<string>(),
      needs: [],
    };
    group.quantity += quantity;
    group.aliases.add(identity(n.name, unit));
    group.aliases.add(identity(group.name, unit));
    group.needs.push(n);
    groups.set(key, group);
  }
  const remaining = new Map(
    manual.map((r) => [r.id, num(r, "quantity") * factor(str(r, "unit"))]),
  );
  const targets: ShoppingTarget[] = [];
  for (const group of groups.values()) {
    let wanted = group.quantity,
      unknownUnits = false;
    for (const item of manual) {
      const p = productById.get(String(item.product_id));
      if (
        !p ||
        !(
          item.product_id === group.product?.id ||
          group.aliases.has(identity(str(p, "name"), group.unit))
        )
      )
        continue;
      const unit = base(str(item, "unit"));
      let ratio = unit === group.unit ? 1 : undefined;
      if (ratio === undefined) {
        const ratios = group.needs
          .map((n) => {
            const choice = ingredientChoice(choices, n);
            return choice
              ? {
                  ...choice,
                  ratio:
                    choice.ratio === undefined
                      ? undefined
                      : choice.ratio * (scales.get(n) ?? 1),
                }
              : undefined;
          })
          .filter(
            (c) =>
              c?.sourceId === `product:${p.id}:${unit}` &&
              Number.isFinite(c.ratio) &&
              Number(c.ratio) > 0,
          )
          .map((c) => c!.ratio!);
        if (new Set(ratios).size === 1) ratio = ratios[0];
        ratio ??= sourceRatio(
          { name: group.name, unit: group.unit },
          { name: str(p, "name"), unit },
        );
      }
      if (
        ratio === undefined ||
        !Number.isFinite((remaining.get(item.id) ?? 0) * ratio)
      ) {
        unknownUnits = true;
        continue;
      }
      const available = remaining.get(item.id) ?? 0,
        used = Math.min(available, wanted / ratio);
      wanted = Math.max(0, wanted - used * ratio);
      remaining.set(item.id, available - used);
    }
    if (unknownUnits && wanted > 0.00000001) {
      warnings.push(
        `«${group.name}» уже добавлен вручную в другой единице. По плану требуется ещё ${wanted} ${group.unit}. Проверьте количество или единицу ручной позиции: вторая строка автоматически не добавлена.`,
      );
      continue;
    }
    if (Number(wanted.toFixed(4)) > 0)
      targets.push({ ...group, quantity: Number(wanted.toFixed(4)) });
  }
  return { targets, items, products, errors, warnings };
}
