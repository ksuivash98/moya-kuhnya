import { purchasingRuleKey, readChickenYield } from "./procurement";
import { suggestProductCategory } from "./product-category";
import { loadKitchen, mutate } from "./api";
import { client, check } from "../supabase";
import { monthRange, num, rows, str, type Row } from "./model";
import { readIngredientChoices } from "./ingredient-preferences";
import { ingredientName } from "./ingredient-matching";
import {
  isManagedShopping,
  shoppingPlan,
  stableShoppingId,
} from "./shopping-reconciliation";
import type { PlanScope } from "./plan-requirements";
export async function syncShopping(
  family: string,
  userId: string,
  scope: PlanScope,
  chickenYield = readChickenYield(userId, family),
) {
  if (navigator.locks)
    return navigator.locks.request(
      `kitchen-shopping:${family}:${scope.month}`,
      () => reconcile(family, userId, scope, chickenYield),
    );
  return reconcile(family, userId, scope, chickenYield);
}
async function reconcile(
  family: string,
  userId: string,
  scope: PlanScope,
  chickenYield: number,
) {
  const range = monthRange(scope.month);
  const state = await loadKitchen(family, range.from, range.to);
  const plan = shoppingPlan(
    state,
    family,
    scope,
    readIngredientChoices(userId, family),
    chickenYield,
  );
  if (plan.errors.length) throw new Error(plan.errors.join(" "));
  const cycle = rows(state, "purchases")
    .filter((p) => p.family_id === family)
    .map((p) => p.id)
    .sort()
    .join(",");
  // UUIDv8 IDs mark reconciled rows because the existing RPC creates source=manual.
  // The same ID and optimistic version prevent duplicate inserts on retries/devices.
  const owned = plan.items.filter(
    (r) => r.status === "open" && isManagedShopping(r),
  );
  const keep = new Set<string>();
  const save = async (
    row: Row | undefined,
    id: string,
    productId: string,
    unit: string,
    quantity: number,
    status: string,
  ) => {
    if (
      row &&
      row.product_id === productId &&
      str(row, "unit") === unit &&
      num(row, "quantity") === quantity &&
      row.status === status &&
      str(row, "category") ===
        str(
          plan.products.find((p) => p.id === productId),
          "category",
        )
    )
      return;
    await mutate(
      family,
      "shopping_save",
      {
        id,
        product_id: productId,
        unit,
        quantity,
        month: scope.month + "-01",
        status,
        ...(row ? { version: row.version } : {}),
      },
      crypto.randomUUID(),
    );
  };
  const created = new Map<string, Row>();
  for (const target of plan.targets) {
    let product = target.product ?? created.get(ingredientName(target.name));
    if (!product) {
      const id = await stableShoppingId(
        "product",
        `${family}:${ingredientName(target.name)}`,
      );
      const category = await client().rpc("suggest_product_category", {
        p_name: target.name,
      });
      check(category.error);
      const suggested = suggestProductCategory(target.name);
      const productCategory =
        suggested !== "Другое" ? suggested : String(category.data || "Другое");
      await mutate(
        family,
        "product_save",
        {
          id,
          name: target.name,
          unit: target.unit,
          category: productCategory,
          minimum: 0,
          archived: false,
        },
        crypto.randomUUID(),
      );
      product = {
        id,
        family_id: family,
        version: 1,
        name: target.name,
        category: productCategory,
      };
      created.set(ingredientName(target.name), product);
    }
    const candidates = owned.filter(
      (r) =>
        !keep.has(r.id) &&
        str(r, "unit") === target.unit &&
        (r.product_id === product!.id ||
          target.aliases.has(
            purchasingRuleKey(
              str(
                plan.products.find((p) => p.id === r.product_id),
                "name",
              ),
              target.unit,
            ),
          )),
    );
    const existing =
      candidates.find((r) => r.product_id === product!.id) ?? candidates[0];
    const id =
      existing?.id ??
      (await stableShoppingId(
        "shopping",
        `${family}:${scope.month}:${product.id}:${target.unit}:${cycle}`,
      ));
    const old = existing ?? plan.items.find((r) => r.id === id);
    if (old?.status === "purchased")
      throw new Error(
        "Покупка уже подтверждена. Обновите список и пересчитайте снова.",
      );
    await save(old, id, product.id, target.unit, target.quantity, "open");
    keep.add(id);
  }
  // Only app-generated open rows are retired. Manual entries and purchase history stay intact.
  for (const old of owned.filter((r) => !keep.has(r.id)))
    await save(
      old,
      old.id,
      String(old.product_id),
      str(old, "unit"),
      num(old, "quantity"),
      "cancelled",
    );
  return { warnings: plan.warnings };
}
