import { useState } from "react";
import { NavLink } from "react-router-dom";
import { mutate } from "./api";
import { errorText } from "../supabase";
import { fmt, num, str, today, type Row } from "./model";
export default function ReadyPreparationUse({
  preparations,
  initialId,
  menu,
  servings,
  onSaved,
  onBusy,
  operationKey,
  inactive,
}: {
  preparations: Row[];
  initialId: string;
  menu: Row;
  servings: number;
  onSaved: (message?: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
  operationKey: string;
  inactive: boolean;
}) {
  const [id, setId] = useState(initialId);
  const chosen = preparations.find((p) => p.id === id);
  const initialQuantity = (p: Row | undefined) =>
    p && p.unit === "порц."
      ? String(Math.min(servings, num(p, "quantity")))
      : "";
  const [quantity, setQuantity] = useState(() => initialQuantity(chosen));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || inactive) return;
        setError("");
        const amount = Number(quantity.replace(",", "."));
        if (
          !chosen ||
          !/^\d+([.,]\d{1,4})?$/.test(quantity) ||
          amount <= 0 ||
          amount > num(chosen, "quantity")
        ) {
          setError(
            "Укажите количество больше нуля и не больше остатка выбранной заготовки.",
          );
          return;
        }
        setBusy(true);
        onBusy(true);
        const form = new FormData(e.currentTarget);
        try {
          await mutate(
            menu.family_id,
            "prep_use",
            {
              id: chosen.id,
              version: chosen.version,
              quantity: quantity.replace(",", "."),
              reason: "Использование",
              menu_id: menu.id,
              date: String(form.get("date")),
            },
            operationKey,
          );
          await onSaved(
            "Готовая заготовка использована один раз. Ингредиенты повторно не списывались.",
          );
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <p className="notice">
        Вы используете уже приготовленное блюдо. Спишется только выбранное
        количество заготовки; картофель, мясо и другие ингредиенты отдельно не
        расходуются. Новое приготовление и новые заготовки не создаются.
      </p>
      <fieldset disabled={busy || inactive} className="k-fields">
        <label>
          Готовая заготовка
          <select
            value={chosen ? id : ""}
            required
            onChange={(e) => {
              setId(e.target.value);
              setQuantity(
                initialQuantity(
                  preparations.find((p) => p.id === e.target.value),
                ),
              );
              setError("");
            }}
          >
            <option value="">Выберите заготовку</option>
            {preparations.map((p) => (
              <option key={p.id} value={p.id}>
                {str(p, "title")} — {fmt(num(p, "quantity"))} {str(p, "unit")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Использовать ({str(chosen, "unit")})
          <input
            type="number"
            inputMode="decimal"
            min="0.0001"
            max={chosen ? num(chosen, "quantity") : undefined}
            step="0.0001"
            value={quantity}
            required
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          Дата использования
          <input type="date" name="date" defaultValue={today()} required />
        </label>
        {chosen && (
          <p className="muted">
            В заготовке: {fmt(num(chosen, "quantity"))} {str(chosen, "unit")}. В
            меню запланировано {fmt(servings)} порц. Укажите фактически
            используемое количество: один пункт приготовления будет отмечен
            выполненным; при наличии связанной задачи завершится первая по дате.
          </p>
        )}
        <label className="checkbox-label">
          <input type="checkbox" required />
          Подтверждаю использование готовой заготовки без повторного расхода
          ингредиентов
        </label>
      </fieldset>
      {!chosen && (
        <p className="notice">
          Заготовка закончилась или недоступна. Выберите другую в разделе{" "}
          <NavLink to="/preparations">«Заготовки»</NavLink>.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={inactive || busy || !navigator.onLine || !chosen}
      >
        {busy ? "Используем…" : "Использовать заготовку"}
      </button>
    </form>
  );
}
