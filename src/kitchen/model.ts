export type Json =
  | null
  | string
  | number
  | boolean
  | Json[]
  | { [key: string]: Json };
export type Row = {
  id: string;
  family_id: string;
  version: number;
  [key: string]: Json;
};
export type State = {
  schema_version: number;
  summary?: Summary;
  [key: string]: Row[] | number | Summary | undefined;
};
export type Summary = {
  spent: number;
  budget: number;
  remaining: number;
  forecast: number;
  by_category: { category: string; amount: number }[];
  by_month: { month: string; amount: number }[];
};
export const names: Record<string, string> = {
  menu: "Меню",
  cooking: "План приготовления",
  preparations: "Заготовки",
  products: "Мои продукты",
  shopping: "Покупки",
  budget: "Бюджет",
  assistant: "Помощник",
  analytics: "Аналитика",
};
export const meals = ["Завтрак", "Обед", "Ужин", "Перекус", "Другое"];
export const statuses = [
  "Запланировано",
  "В процессе",
  "Перенесено",
  "Отменено",
];
export const stockUnits = [
  "г",
  "кг",
  "мл",
  "л",
  "шт.",
  "ч. л.",
  "ст. л.",
  "стакан",
  "упаковка",
  "порц.",
];
export const productCategories = [
  "Мясо",
  "Рыба",
  "Молочные продукты",
  "Овощи",
  "Фрукты",
  "Крупы",
  "Макароны",
  "Специи",
  "Консервы",
  "Замороженные продукты",
  "Сладости",
  "Напитки",
  "Другое",
];
export const prepCategories = [
  "Мясные",
  "Рыбные",
  "Овощные",
  "Полуфабрикаты",
  "Готовые блюда",
  "Выпечка",
  "Соусы",
  "Другие",
];
export const str = (r: Row | Record<string, Json> | undefined, k: string) =>
  String(r?.[k] ?? "");
export const num = (r: Row | Record<string, Json> | undefined, k: string) =>
  Number(r?.[k] ?? 0);
export const rows = (s: State | undefined, k: string) =>
  Array.isArray(s?.[k]) ? (s![k] as Row[]) : [];
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    from: month + "-01",
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function calendarDays(month: string) {
  const first = month + "-01",
    weekday = (new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - weekday));
}
export const norm = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
export const base = (u: string) => (u === "кг" ? "г" : u === "л" ? "мл" : u);
export const factor = (u: string) => (u === "кг" || u === "л" ? 1000 : 1);
export const fmt = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(n);
export const rub = (n: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(
    n,
  );
export function snapshot(r: Row) {
  return (r.recipe_snapshot ?? {}) as Record<string, Json>;
}
export function ingredients(r: Row) {
  return (snapshot(r).ingredients ?? []) as Record<string, Json>[];
}
export type Need = {
  name: string;
  unit: string;
  quantity: number;
  available: number;
  missing: number;
};
export function needs(s: State, plans: Row[]): Need[] {
  const map = new Map<string, Need>();
  for (const p of plans) {
    let count = 1;
    if (p.planned_count !== undefined) {
      const cooked = rows(s, "cooking_events").filter(
        (e) => e.menu_id === p.id,
      ).length;
      const linked = rows(s, "cooking_tasks").filter(
        (t) =>
          t.menu_id === p.id &&
          !["Приготовлено", "Отменено"].includes(str(t, "status")),
      ).length;
      count = Math.max(0, num(p, "planned_count") - cooked - linked);
    }
    if (
      [
        "Отменено",
        "Приготовлено",
        "Сделана заготовка",
        "Приготовлено из заготовки",
      ].includes(str(p, "status"))
    )
      continue;
    for (const i of ingredients(p)) {
      if (i.amount === null || i.unit === "по вкусу") continue;
      const name = str(i, "name"),
        unit = base(str(i, "unit")),
        key = norm(name) + "|" + unit,
        quantity =
          ((num(i, "amount") * num(p, "servings")) /
            Number(snapshot(p).servings || 1)) *
          factor(str(i, "unit")) *
          count;
      const old = map.get(key);
      if (old) old.quantity += quantity;
      else map.set(key, { name, unit, quantity, available: 0, missing: 0 });
    }
  }
  for (const n of map.values()) {
    const product = rows(s, "products").find(
      (p) => p.name_key === norm(n.name) && !p.archived,
    );
    n.available = rows(s, "stock_batches")
      .filter(
        (b) =>
          b.product_id === product?.id &&
          b.unit === n.unit &&
          (!b.expires_on || str(b, "expires_on") >= today()),
      )
      .reduce((sum, b) => sum + num(b, "quantity"), 0);
    n.missing = Math.max(0, n.quantity - n.available);
  }
  return [...map.values()];
}
