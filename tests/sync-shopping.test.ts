import { beforeEach, expect, test, vi } from "vitest";
import type { State, Row, Json } from "../src/kitchen/model";
import { rows } from "../src/kitchen/model";
const api = vi.hoisted(() => ({ loadKitchen: vi.fn(), mutate: vi.fn() }));
vi.mock("../src/kitchen/api", () => api);
vi.mock("../src/kitchen/ingredient-preferences", () => ({
  readIngredientChoices: () => ({}),
}));
import { syncShopping } from "../src/kitchen/sync-shopping";
import { isManagedShopping } from "../src/kitchen/shopping-reconciliation";
const potato = "11111111-1111-4111-8111-111111111111",
  milk = "22222222-2222-4222-8222-222222222222";
const row = (id: string, data: Record<string, Json>): Row => ({
  id,
  family_id: "family",
  version: 1,
  ...data,
});
let state: State;
beforeEach(() => {
  vi.stubGlobal("navigator", {});
  vi.clearAllMocks();
  state = {
    schema_version: 4,
    products: [
      row(potato, { name: "Картошка" }),
      row(milk, { name: "Молоко" }),
    ],
    menu_items: [
      row("plan", {
        month: "2026-11-01",
        servings: 1,
        planned_count: 1,
        status: "Запланировано",
        recipe_snapshot: {
          servings: 1,
          ingredients: [
            { name: "Картофель", amount: 100, unit: "г" },
            { name: "Молоко", amount: 500, unit: "мл" },
          ],
        },
      }),
    ],
    shopping_items: [
      row("old", {
        product_id: potato,
        quantity: 300,
        unit: "г",
        source: "generated",
        status: "open",
        month: "2026-11-01",
      }),
      row("manual", {
        product_id: potato,
        quantity: 50,
        unit: "г",
        source: "manual",
        status: "open",
        month: "2026-11-01",
      }),
      row("paid", {
        product_id: milk,
        quantity: 10,
        unit: "мл",
        source: "generated",
        status: "purchased",
        month: "2026-11-01",
      }),
    ],
    purchases: [row("purchase", { shopping_item_id: "paid" })],
  };
  api.loadKitchen.mockImplementation(async () => structuredClone(state));
  api.mutate.mockImplementation(
    async (_family: string, action: string, data: Record<string, Json>) => {
      expect(action).toBe("shopping_save");
      const all = rows(state, "shopping_items");
      const existing = all.find((r) => r.id === data.id);
      if (existing) {
        expect(existing.status).not.toBe("purchased");
        expect(data.version).toBe(existing.version);
        Object.assign(existing, data, { version: existing.version + 1 });
      } else all.push(row(String(data.id), { ...data, source: "manual" }));
      return { id: data.id };
    },
  );
});
test("повторный пересчёт восстанавливается после потерянного ответа без дублей и сохраняет ручное/оплаченное", async () => {
  const apply = api.mutate.getMockImplementation()!;
  let lost = false;
  api.mutate.mockImplementation(async (...args: unknown[]) => {
    const result = await apply(...args);
    if (!lost && (args[2] as Row).product_id === milk) {
      lost = true;
      throw new Error("Потерян ответ");
    }
    return result;
  });
  const preserved = structuredClone(
    rows(state, "shopping_items").filter(
      (r) => r.id === "manual" || r.id === "paid",
    ),
  );
  await expect(
    syncShopping("family", "user", { month: "2026-11" }),
  ).rejects.toThrow("Потерян ответ");
  await syncShopping("family", "user", { month: "2026-11" });
  const snapshot = structuredClone(state);
  await syncShopping("family", "user", { month: "2026-11" });
  expect(state).toEqual(snapshot);
  expect(
    rows(state, "shopping_items").filter(
      (r) => r.id === "manual" || r.id === "paid",
    ),
  ).toEqual(preserved);
  const managed = rows(state, "shopping_items").filter(
    (r) => r.status === "open" && isManagedShopping(r),
  );
  expect(managed.map((r) => Number(r.quantity)).sort((a, b) => a - b)).toEqual([
    50, 500,
  ]);
  expect(rows(state, "purchases")).toEqual([
    row("purchase", { shopping_item_id: "paid" }),
  ]);
});
test("при нулевом дефиците старые автоматические строки отменяются, ручные и история остаются", async () => {
  state.stock_batches = [
    row("potato-stock", { product_id: potato, quantity: 200, unit: "г" }),
    row("milk-stock", { product_id: milk, quantity: 1000, unit: "мл" }),
  ];
  const stock = structuredClone(state.stock_batches);
  await syncShopping("family", "user", { month: "2026-11" });
  expect(
    rows(state, "shopping_items").find((r) => r.id === "old")?.status,
  ).toBe("cancelled");
  expect(
    rows(state, "shopping_items")
      .filter((r) => r.status === "open")
      .map((r) => r.id),
  ).toEqual(["manual"]);
  expect(
    rows(state, "shopping_items").find((r) => r.id === "paid")?.status,
  ).toBe("purchased");
  expect(state.stock_batches).toEqual(stock);
});
