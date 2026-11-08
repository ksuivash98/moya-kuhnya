import { base, factor, fmt, num, str, type Need, type Row } from "./model";
import { proteinProduct } from "./protein-products";
import { combineIngredientNeeds } from "./ingredient-groups";
import {
  ingredientChoice,
  ingredientRuleKey,
  matchIngredients,
  sourceRatio,
  type IngredientChoices,
  type InventorySource,
} from "./ingredient-matching";

export function purchasingRuleKey(name: string, unit: string) {
  const rule = proteinProduct(name);
  return rule && (!rule.cooked || base(unit) === "г")
    ? `purchase:${rule.key}|${base(unit)}`
    : ingredientRuleKey({ name, unit });
}
const preferenceKey = (user: string, family: string) =>
  `kitchen-procurement:${user}:${family}`;
export function readChickenYield(user: string, family: string) {
  try {
    const value = Number(localStorage.getItem(preferenceKey(user, family)));
    return value >= 1 && value <= 100 ? value : 75;
  } catch {
    return 75;
  }
}
export function saveChickenYield(user: string, family: string, value: number) {
  if (!Number.isFinite(value) || value < 1 || value > 100) return;
  try {
    localStorage.setItem(preferenceKey(user, family), String(value));
  } catch {
    /* Расчёт доступен и без хранилища. */
  }
}

/** Stock/preparations are allocated strictly before converting unmet cooked chicken to raw fillet. */
export function procurementNeeds(
  needs: Need[],
  sources: InventorySource[],
  choices: IngredientChoices,
  manual: Row[],
  products: Row[],
  yieldPercent = 75,
) {
  const matched = matchIngredients(needs, sources, choices);
  const remaining = new Map(sources.map((s) => [s.id, s.quantity]));
  for (const n of matched) {
    let pending = Math.min(n.quantity, n.available);
    const choice = ingredientChoice(choices, n);
    for (const source of n.matchedSources) {
      const ratio = sourceRatio(
        n,
        source,
        source.id === choice?.sourceId && !n.sourceMismatch
          ? choice.ratio
          : undefined,
      );
      if (!ratio || pending <= 0) continue;
      const take = Math.min(remaining.get(source.id) ?? 0, pending / ratio);
      remaining.set(
        source.id,
        Math.max(0, (remaining.get(source.id) ?? 0) - take),
      );
      pending = Math.max(0, pending - take * ratio);
    }
  }
  const percent =
    Number.isFinite(yieldPercent) && yieldPercent >= 1 && yieldPercent <= 100
      ? yieldPercent
      : 75;
  const cookedManual = manual.filter(
    (r) =>
      base(str(r, "unit")) === "г" &&
      proteinProduct(
        str(
          products.find((p) => p.id === r.product_id),
          "name",
        ),
      )?.cooked,
  );
  const manualLeft = new Map(
    cookedManual.map((r) => [
      r.id,
      num(r, "quantity") * factor(str(r, "unit")),
    ]),
  );
  const regular = [],
    raw: Need[] = [];
  let converted = false;
  for (const n of matched) {
    const rule = proteinProduct(n.name);
    if (!rule?.cooked || n.unit !== "г") {
      regular.push(n);
      continue;
    }
    let missing = n.missing;
    for (const item of cookedManual) {
      const itemRule = proteinProduct(
        str(
          products.find((p) => p.id === item.product_id),
          "name",
        ),
      );
      if (itemRule?.key !== rule.key) continue;
      const take = Math.min(missing, manualLeft.get(item.id) ?? 0);
      missing -= take;
      manualLeft.set(item.id, (manualLeft.get(item.id) ?? 0) - take);
    }
    if (missing <= 1e-8) continue;
    raw.push({
      name: rule.rawName,
      unit: "г",
      quantity: Number(((missing * 100) / percent).toFixed(4)),
      available: 0,
      missing: 0,
    });
    converted = true;
  }
  const leftSources = sources
    .filter((s) => s.kind === "product" && !proteinProduct(s.name)?.cooked)
    .map((s) => ({ ...s, quantity: remaining.get(s.id) ?? 0 }));
  return {
    matched: [
      ...regular,
      ...matchIngredients(combineIngredientNeeds(raw), leftSources, {}),
    ],
    warnings: converted
      ? [
          `Отварное куриное мясо пересчитано в сырое филе приблизительно: выход ${fmt(percent)}%. Заготовки и доступный остаток сырого филе учтены; филе потребуется отварить.`,
        ]
      : [],
  };
}
