import { base, factor, rows, str, type State, type Need } from "./model";
import {
  ingredientChoice,
  inventorySources,
  matchIngredients,
  type IngredientChoices,
  type MatchedNeed,
} from "./ingredient-matching";
export type CookingUsage = { name: string; amount: string; unit: string };
export function cookingSources(
  state: State,
  family: string,
  usage: CookingUsage[],
  choices: IngredientChoices,
) {
  const sources = inventorySources(state, family);
  const errors: string[] = [];
  const needs: Need[] = usage.map((u) => {
    const valid = /^[0-9]+([.,][0-9]{1,4})?$/.test(u.amount.trim());
    const amount = valid ? Number(u.amount.replace(",", ".")) : NaN;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9)
      errors.push(
        `«${u.name}»: укажите неотрицательный расход, до 4 знаков после запятой.`,
      );
    return {
      name: u.name,
      unit: base(u.unit),
      quantity: Number.isFinite(amount) ? amount * factor(u.unit) : 0,
      available: 0,
      missing: 0,
    };
  });
  const matched = matchIngredients(needs, sources, choices);
  const remaining = new Map(sources.map((s) => [s.id, s.quantity]));
  const matchedByRow: MatchedNeed[] = [];
  let cursor = 0;
  const allocations = usage.map((u, index) => {
    const n = needs[index];
    const match = n.quantity > 0 ? matched[cursor++] : undefined;
    matchedByRow.push(
      match ?? {
        ...n,
        matchedSources: [],
        suggestions: [],
        unavailable: false,
        conversionRequired: false,
        sourceMismatch: false,
      },
    );
    const result: {
      kind: string;
      id: string;
      quantity: string;
      unit: string;
      ratio: string;
      version?: number;
    }[] = [];
    if (match) {
      if (match.missing > 1e-8)
        errors.push(
          `Недостаточно для «${u.name}»: не хватает ${Number(match.missing.toFixed(4))} ${n.unit}. Выберите источник или уточните фактический расход.`,
        );
      let pending = n.quantity;
      for (const source of match.matchedSources) {
        const choice = ingredientChoice(choices, n);
        const ratio = source.unit === n.unit ? 1 : Number(choice?.ratio);
        if (
          !Number.isFinite(ratio) ||
          ratio <= 0 ||
          ratio > 1e9 ||
          Math.abs(ratio - Number(ratio.toFixed(4))) > 1e-10
        ) {
          errors.push(
            `«${u.name}»: коэффициент пересчёта должен иметь не более 4 знаков после запятой.`,
          );
          continue;
        }
        const quantity = Number(
          Math.min(remaining.get(source.id) ?? 0, pending / ratio).toFixed(4),
        );
        if (quantity <= 0) continue;
        const id = source.id.split(":")[1];
        result.push({
          kind: source.kind,
          id,
          quantity: quantity.toFixed(4),
          unit: source.unit,
          ratio: ratio.toFixed(4),
          ...(source.kind === "preparation"
            ? {
                version: rows(state, "preparations").find((p) => p.id === id)!
                  .version,
              }
            : {}),
        });
        remaining.set(
          source.id,
          Math.max(0, (remaining.get(source.id) ?? 0) - quantity),
        );
        pending = Math.max(0, pending - quantity * ratio);
      }
      if (!result.length)
        errors.push(`«${u.name}»: расход меньше точности учёта источника.`);
    }
    return { ...u, amount: u.amount.trim().replace(",", "."), sources: result };
  });
  const legacyUsage = allocations.flatMap((u) =>
    u.sources
      .filter((s) => s.kind === "product")
      .map((s) => ({
        name: str(
          rows(state, "products").find((p) => p.id === s.id),
          "name",
        ),
        amount: s.quantity,
        unit: s.unit,
      })),
  );
  return {
    allocations,
    legacyUsage,
    matched,
    matchedByRow,
    sources,
    errors,
    requiresPreparation: allocations.some((u) =>
      u.sources.some((s) => s.kind === "preparation"),
    ),
  };
}
