import { useState } from "react";
import type { ModuleProps } from "./KitchenPage";
import { rows, num, str, rub, fmt, monthRange } from "./model";
export default function Analytics({ state, month }: ModuleProps) {
  const [unit, setUnit] = useState("г");
  const range = monthRange(month),
    events = rows(state, "cooking_events").filter((e) =>
      str(e, "cooked_on").startsWith(month),
    ),
    summary = state.summary;
  const popular = new Map<string, number>();
  for (const e of events)
    popular.set(
      String((e.recipe_snapshot as Record<string, unknown>)?.title ?? "Рецепт"),
      (popular.get(
        String(
          (e.recipe_snapshot as Record<string, unknown>)?.title ?? "Рецепт",
        ),
      ) ?? 0) + 1,
    );
  const movements = rows(state, "stock_movements").filter(
    (m) =>
      rows(state, "stock_batches").find((b) => b.id === m.batch_id)?.unit ===
      unit,
  );
  let balance = movements
    .filter((m) => str(m, "created_at").slice(0, 10) < range.from)
    .reduce((n, m) => n + num(m, "quantity"), 0);
  const dynamics = [];
  for (let day = 1; day <= Number(range.to.slice(-2)); day++) {
    const date = month + "-" + String(day).padStart(2, "0");
    balance += movements
      .filter((m) => str(m, "created_at").slice(0, 10) === date)
      .reduce((n, m) => n + num(m, "quantity"), 0);
    dynamics.push({ label: String(day), value: balance });
  }
  function bars(values: { label: string; value: number }[], money = false) {
    const max = Math.max(1, ...values.map((v) => Math.abs(v.value)));
    return (
      <div className="k-bars">
        {values.map((v, i) => (
          <div key={i}>
            <div className="k-bar-label">
              <span>{v.label}</span>
              <strong>{money ? rub(v.value) : fmt(v.value)}</strong>
            </div>
            <div className="k-bar">
              <span style={{ width: `${(Math.abs(v.value) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="k-metrics">
        {[
          { name: "Приготовлений", value: events.length },
          {
            name: "Создано заготовок",
            value: rows(state, "preparations").filter((p) =>
              str(p, "prepared_on").startsWith(month),
            ).length,
          },
          {
            name: "Использовано заготовок (операций)",
            value: rows(state, "preparation_uses").filter((p) =>
              str(p, "used_on").startsWith(month),
            ).length,
          },
        ].map((v) => (
          <div className="panel" key={v.name}>
            <span className="muted">{v.name}</span>
            <strong>{v.value}</strong>
          </div>
        ))}
      </div>
      <div className="k-list">
        <section className="panel">
          <h2>Расходы по категориям</h2>
          {bars(
            summary?.by_category.map((c) => ({
              label: c.category,
              value: Number(c.amount),
            })) ?? [],
            true,
          )}
        </section>
        <section className="panel">
          <h2>Сравнение месяцев</h2>
          {bars(
            summary?.by_month.map((c) => ({
              label: c.month.slice(0, 7),
              value: Number(c.amount),
            })) ?? [],
            true,
          )}
        </section>
        <section className="panel">
          <h2>Популярные приготовленные рецепты</h2>
          {bars([...popular].map(([label, value]) => ({ label, value })))}
        </section>
        <section className="panel">
          <h2>Динамика остатков</h2>
          <label>
            Единица
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {[
                "г",
                "мл",
                "шт.",
                "упаковка",
                "порц.",
                "стакан",
                "ч. л.",
                "ст. л.",
              ].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            Остаток на конец каждого дня по журналу. Несовместимые единицы не
            складываются.
          </p>
          {bars(dynamics)}
        </section>
      </div>
      <section className="panel k-section">
        <h2>Использованные и списанные продукты</h2>
        <div className="k-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Продукт</th>
                <th>Расход</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows(state, "stock_movements")
                .filter(
                  (m) =>
                    num(m, "quantity") < 0 &&
                    str(m, "created_at").startsWith(month),
                )
                .map((m) => {
                  const b = rows(state, "stock_batches").find(
                      (b) => b.id === m.batch_id,
                    ),
                    p = rows(state, "products").find(
                      (p) => p.id === b?.product_id,
                    );
                  return (
                    <tr key={m.id}>
                      <td>{str(m, "created_at").slice(0, 10)}</td>
                      <td>{str(p, "name")}</td>
                      <td>
                        {fmt(-num(m, "quantity"))} {str(b, "unit")}
                      </td>
                      <td>{str(m, "reason")}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
