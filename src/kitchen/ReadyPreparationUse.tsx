import { useState } from "react";
import { NavLink } from "react-router-dom";
import { mutate } from "./api";
import { errorText } from "../supabase";
import { soupBroth } from "./soup-broth";
import type { IngredientChoices } from "./ingredient-matching";
import { fmt, num, str, today, type Row, type State } from "./model";
export default function ReadyPreparationUse({
  preparations,
  state,
  choices,
  initialId,
  menu,
  servings,
  onSaved,
  onBusy,
  operationKey,
  inactive,
}: {
  preparations: Row[];
  state: State;
  choices: IngredientChoices;
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
  const broth = soupBroth(state, menu, chosen, quantity, choices);
  const [addBroth, setAddBroth] = useState(false);
  const [brothId, setBrothId] = useState("");
  const selectedBroth = broth.candidates.find(
    (p) => p.id === (brothId || broth.preferred?.id),
  );
  const [brothAmount, setBrothAmount] = useState<string | null>(null);
  const brothQuantity = brothAmount ?? broth.suggested(selectedBroth);
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
        if (addBroth) {
          if (state.schema_version < 17) {
            setError(
              "Для совместного списания супа и бульона требуется обновление 017 в Supabase. Остатки не изменены.",
            );
            return;
          }
          const used = Number(brothQuantity.replace(",", "."));
          if (
            !selectedBroth ||
            !/^\d+([.,]\d{1,4})?$/.test(brothQuantity) ||
            used <= 0 ||
            used > num(selectedBroth, "quantity")
          ) {
            setError(
              "Выберите бульон и укажите количество больше нуля, не превышающее его остаток.",
            );
            return;
          }
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
              ...(addBroth && selectedBroth
                ? {
                    additional_broth_confirmed: true,
                    additional_broth: {
                      id: selectedBroth.id,
                      version: selectedBroth.version,
                      quantity: brothQuantity.replace(",", "."),
                      unit: str(selectedBroth, "unit"),
                    },
                  }
                : {}),
            },
            operationKey,
          );
          await onSaved(
            addBroth
              ? "Суп и добавленный бульон списаны вместе. Пункт меню выполнен один раз."
              : "Готовая заготовка использована один раз. Ингредиенты повторно не списывались.",
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
        количество заготовки и бульон, если вы добавляете его при подаче.
        Остальные ингредиенты отдельно не расходуются. Новое приготовление и
        новые заготовки не создаются.
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
              setBrothAmount(null);
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
        {broth.relevant && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={addBroth}
                onChange={(e) => {
                  setAddBroth(e.target.checked);
                  setError("");
                }}
              />
              Добавляю бульон к заготовке супа
            </label>
            <p className="muted">
              Отметьте, если бульон добавляется сейчас. Если он уже был учтён
              при приготовлении супа, повторно списывать его не нужно.
            </p>
            {addBroth && (
              <>
                <label>
                  Бульон для супа
                  <select
                    value={selectedBroth?.id ?? ""}
                    required
                    onChange={(e) => {
                      setBrothId(e.target.value);
                      setBrothAmount(null);
                      setError("");
                    }}
                  >
                    <option value="">Выберите заготовку бульона</option>
                    {broth.candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {str(p, "title")} — {fmt(num(p, "quantity"))}{" "}
                        {str(p, "unit")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Использовать бульона ({str(selectedBroth, "unit")})
                  <input
                    type="number"
                    min="0.0001"
                    max={
                      selectedBroth ? num(selectedBroth, "quantity") : undefined
                    }
                    step="0.0001"
                    required
                    value={brothQuantity}
                    onChange={(e) => setBrothAmount(e.target.value)}
                  />
                </label>
                {selectedBroth &&
                  Number(brothQuantity) > 0 &&
                  Number(brothQuantity) <= num(selectedBroth, "quantity") && (
                    <p className="muted">
                      Останется бульона:{" "}
                      {fmt(
                        num(selectedBroth, "quantity") - Number(brothQuantity),
                      )}{" "}
                      {str(selectedBroth, "unit")}.
                    </p>
                  )}
                {broth.needs.length > 0 && (
                  <p className="muted">
                    По рецепту на выбранные порции:{" "}
                    {broth.needs
                      .map((n) => `${fmt(n.quantity)} ${n.unit}`)
                      .join(" + ")}
                    . Проверьте фактически добавляемое количество.
                  </p>
                )}
                {!broth.candidates.length && (
                  <p className="notice">
                    Нет непросроченного бульона с положительным остатком в
                    заготовках.
                  </p>
                )}
                {state.schema_version < 17 && (
                  <p className="notice">
                    Для совместного списания необходимо обновление 017 в
                    Supabase.
                  </p>
                )}
              </>
            )}
          </>
        )}
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
          {addBroth
            ? "Подтверждаю использование заготовки супа и указанного количества бульона"
            : "Подтверждаю использование готовой заготовки без повторного расхода ингредиентов"}
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
