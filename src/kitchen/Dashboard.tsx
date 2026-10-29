import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { loadKitchen } from "./api";
import { rows, str, num, today, monthRange, rub, type State } from "./model";
export default function Dashboard({
  family,
  user,
  onChange,
}: {
  family: string;
  user: string;
  onChange?: (s: State) => void;
}) {
  const [state, setState] = useState<State>();
  useEffect(() => {
    let alive = true;
    const load = () => {
      const period = monthRange(today().slice(0, 7));
      void loadKitchen(family, period.from, period.to)
        .then((s) => {
          if (alive) {
            setState(s);
            onChange?.(s);
          }
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("kitchen-synced", load);
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("kitchen-synced", load);
    };
  }, [family, user, onChange]);
  if (!state) return null;
  const expired = rows(state, "stock_batches").filter(
      (b) =>
        num(b, "quantity") > 0 &&
        b.expires_on &&
        str(b, "expires_on") <= today(),
    ).length,
    menus = rows(state, "menu_items").filter(
      (m) => m.date === today() && m.status !== "Отменено",
    );
  return (
    <section className="panel k-section">
      <h2>Сегодня в семье</h2>
      <div className="k-metrics">
        <NavLink to="/menu" className="k-item">
          <span>Блюд на сегодня</span>
          <strong>{menus.length}</strong>
        </NavLink>
        <NavLink to="/preparations" className="k-item">
          <span>Заготовок в наличии</span>
          <strong>
            {
              rows(state, "preparations").filter((p) => num(p, "quantity") > 0)
                .length
            }
          </strong>
        </NavLink>
        <NavLink to="/products" className="k-item">
          <span>Проверьте сроки партий</span>
          <strong>{expired}</strong>
        </NavLink>
        <NavLink to="/shopping" className="k-item">
          <span>Позиций к покупке</span>
          <strong>
            {
              rows(state, "shopping_items").filter((s) => s.status === "open")
                .length
            }
          </strong>
        </NavLink>
        {state.summary && (
          <NavLink to="/budget" className="k-item">
            <span>Расходы месяца</span>
            <strong>{rub(Number(state.summary.spent))}</strong>
            <small>Осталось: {rub(Number(state.summary.remaining))}</small>
          </NavLink>
        )}
      </div>
      {menus.map((m) => (
        <p key={m.id}>
          {str(m, "meal")}: {str(m, "title")} — {str(m, "status")}
        </p>
      ))}
    </section>
  );
}
