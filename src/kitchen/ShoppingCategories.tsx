import { useRef, useState } from "react";
import Modal from "../components/Modal";
import { errorText } from "../supabase";
import { mutate } from "./api";
import { num, str, type Row } from "./model";

export type CategorySuggestion = { row: Row; name: string; category: string };
export default function ShoppingCategories({
  suggestions,
  family,
  reload,
  onClose,
}: {
  suggestions: CategorySuggestion[];
  family: string;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [remaining, setRemaining] = useState(suggestions);
  const [selected, setSelected] = useState(
    () => new Set(suggestions.map((s) => s.row.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keys = useRef(
    new Map(suggestions.map((s) => [s.row.id, crypto.randomUUID()])),
  );
  async function apply() {
    if (busy || !navigator.onLine) return;
    setBusy(true);
    setError("");
    try {
      for (const { row, category } of remaining.filter((s) =>
        selected.has(s.row.id),
      )) {
        await mutate(
          family,
          "shopping_save_categorized",
          {
            id: row.id,
            version: row.version,
            product_id: row.product_id,
            unit: str(row, "unit"),
            quantity: num(row, "quantity"),
            month: str(row, "month"),
            status: "open",
            category,
          },
          keys.current.get(row.id)!,
        );
        setRemaining((items) => items.filter((item) => item.row.id !== row.id));
      }
      await reload();
      onClose();
    } catch (e) {
      setError(
        `${errorText(e)} Уже применённые категории сохранены. Можно повторить оставшиеся или закрыть окно и обновить предложения.`,
      );
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Уточнить категории продуктов"
      onClose={() => !busy && onClose()}
    >
      <p className="muted">
        Предложения для позиций в «Другом». Отметьте изменения: они сохранятся
        для продукта и его открытых покупок. Количества и оплаченная история
        сохраняются. Если «Другое» выбрано намеренно, снимите отметку.
      </p>
      <fieldset className="k-fields form-stack" disabled={busy}>
        {remaining.map(({ row, name, category }) => (
          <label key={row.id} className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.has(row.id)}
              onChange={(e) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (e.target.checked) next.add(row.id);
                  else next.delete(row.id);
                  return next;
                })
              }
            />
            <span>
              {name}: Другое → {category}
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Закрыть
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            busy ||
            !navigator.onLine ||
            !remaining.some((s) => selected.has(s.row.id))
          }
          onClick={() => void apply()}
        >
          {busy ? "Сохраняем…" : "Применить категории"}
        </button>
      </div>
    </Modal>
  );
}
