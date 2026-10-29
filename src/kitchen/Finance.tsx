import { useState } from "react";
import type { ModuleProps } from "./KitchenPage";
import Fields, { type Field } from "./Fields";
import { mutate } from "./api";
import {
  rows,
  str,
  num,
  rub,
  fmt,
  today,
  productCategories,
  stockUnits,
  monthRange,
  type Row,
} from "./model";
import { errorText } from "../supabase";
export default function Finance({
  kind,
  state,
  family,
  canEdit,
  month,
  reload,
  notify,
}: ModuleProps & { kind: string }) {
  const [dialog, setDialog] = useState<{ action: string; row?: Row } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const shopping = kind === "shopping",
    products = rows(state, "products"),
    places = rows(state, "storage_places"),
    budget = rows(state, "monthly_budgets").find(
      (r) => r.month === month + "-01",
    );
  const summary = state.summary ?? {
    spent: 0,
    budget: 0,
    remaining: 0,
    forecast: 0,
  };
  const opts = (values: string[]) =>
    values.map((s) => ({ value: s, label: s }));
  const action = dialog?.action;
  const fields: Field[] =
    action === "budget_save"
      ? [
          {
            key: "month",
            label: "Месяц (первое число)",
            type: "date",
            required: true,
          },
          {
            key: "amount",
            label: "Бюджет, ₽",
            type: "number",
            min: 0,
            step: 0.01,
            required: true,
          },
        ]
      : action === "expense_save"
        ? [
            { key: "title", label: "Расход", required: true },
            {
              key: "category",
              label: "Категория",
              options: opts(productCategories),
            },
            {
              key: "amount",
              label: "Сумма, ₽",
              type: "number",
              step: 0.01,
              min: 0,
              required: true,
            },
            { key: "date", label: "Дата", type: "date", required: true },
            { key: "notes", label: "Примечания", type: "textarea" },
          ]
        : action === "purchase_confirm"
          ? [
              {
                key: "quantity",
                label: "Фактически куплено",
                type: "number",
                min: 0.0001,
                required: true,
              },
              { key: "unit", label: "Единица", options: opts(stockUnits) },
              {
                key: "amount",
                label: "Стоимость всей покупки, ₽",
                type: "number",
                min: 0,
                step: 0.01,
                required: true,
              },
              {
                key: "date",
                label: "Дата покупки",
                type: "date",
                required: true,
              },
              { key: "expires_on", label: "Срок годности", type: "date" },
              {
                key: "place_id",
                label: "Место хранения",
                options: [
                  { value: "", label: "Не указано" },
                  ...places.map((p) => ({
                    value: p.id,
                    label: str(p, "name"),
                  })),
                ],
              },
            ]
          : [
              {
                key: "product_id",
                label: "Продукт",
                options: products
                  .filter((p) => !p.archived)
                  .map((p) => ({ value: p.id, label: str(p, "name") })),
                required: true,
              },
              {
                key: "quantity",
                label: "Количество",
                type: "number",
                min: 0.0001,
                required: true,
              },
              { key: "unit", label: "Единица", options: opts(stockUnits) },
              {
                key: "month",
                label: "Месяц (первое число)",
                type: "date",
                required: true,
              },
              {
                key: "status",
                label: "Состояние",
                options: [
                  { value: "open", label: "Нужно купить" },
                  { value: "cancelled", label: "Удалено из списка" },
                ],
              },
            ];
  async function generate() {
    setBusy(true);
    try {
      await mutate(
        family,
        "shopping_generate",
        { month: month + "-01" },
        crypto.randomUUID(),
      );
      await reload();
      notify("Список пересчитан по меню и плану. История покупок сохранена.");
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const list = shopping
    ? rows(state, "shopping_items")
        .filter((r) => str(r, "month").startsWith(month) && r.status === "open")
        .sort((a, b) =>
          str(a, "category").localeCompare(str(b, "category"), "ru"),
        )
    : rows(state, "expenses").filter((r) => str(r, "date").startsWith(month));
  return (
    <>
      {!shopping && (
        <div className="k-metrics">
          {[
            { name: "Бюджет месяца", value: summary.budget },
            { name: "Потрачено", value: summary.spent },
            { name: "Осталось", value: summary.remaining },
            { name: "Прогноз до конца месяца", value: summary.forecast },
          ].map((m) => (
            <div className="panel" key={m.name}>
              <span className="muted">{m.name}</span>
              <strong>{rub(m.value)}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="k-toolbar">
        {canEdit && (
          <>
            {shopping ? (
              <>
                <button
                  className="primary"
                  disabled={busy || !navigator.onLine}
                  onClick={() => void generate()}
                >
                  Рассчитать недостающие продукты
                </button>
                <button
                  className="secondary"
                  disabled={!products.length}
                  onClick={() => setDialog({ action: "shopping_save" })}
                >
                  Добавить вручную
                </button>
              </>
            ) : (
              <>
                <button
                  className="primary"
                  onClick={() =>
                    setDialog({ action: "budget_save", row: budget })
                  }
                >
                  Установить бюджет
                </button>
                <button
                  className="secondary"
                  onClick={() => setDialog({ action: "expense_save" })}
                >
                  Добавить расход
                </button>
              </>
            )}
          </>
        )}
      </div>
      <p className="muted">
        {shopping
          ? "Список учитывает незавершённые блюда и совместимые единицы. Фактическая покупка одновременно создаёт партию и расход. Новые продукты для ручного списка добавляются в разделе «Продукты»."
          : "Все суммы рассчитаны по финансовому журналу. Корректировки сохраняют прежние записи и создают компенсации; прогноз — пропорция текущих расходов по дням, а не обещание."}
      </p>
      {!list.length && (
        <div className="panel k-empty">
          {shopping
            ? "Список покупок пуст. Рассчитайте недостающее по плану или добавьте вручную."
            : "За выбранный месяц расходов нет."}
        </div>
      )}
      <div className="k-list">
        {list.slice(page * 20, (page + 1) * 20).map((r) => (
          <article className="k-item" key={r.id}>
            <span className="pill quiet">{str(r, "category")}</span>
            <h3>
              {shopping
                ? str(
                    products.find((p) => p.id === r.product_id),
                    "name",
                  )
                : str(r, "title")}
            </h3>
            <strong>
              {shopping
                ? `${fmt(num(r, "quantity"))} ${str(r, "unit")}`
                : rub(num(r, "amount"))}
            </strong>
            <div className="k-actions">
              {canEdit && (
                <>
                  {shopping && (
                    <button
                      onClick={() =>
                        setDialog({ action: "purchase_confirm", row: r })
                      }
                    >
                      Куплено
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setDialog({
                        action: shopping ? "shopping_save" : "expense_save",
                        row: r,
                      })
                    }
                  >
                    Изменить{shopping ? " / удалить" : ""}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {list.length > 20 && (
        <div className="k-pagination">
          <button
            className="secondary"
            disabled={!page}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          {page + 1}
          <button
            className="secondary"
            disabled={(page + 1) * 20 >= list.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </button>
        </div>
      )}
      {shopping && (
        <section className="panel k-section">
          <h2>История покупок</h2>
          {rows(state, "purchases")
            .filter((p) => str(p, "date").startsWith(month))
            .map((p) => (
              <div key={p.id} className="k-item">
                <p>
                  {str(p, "date")} · {fmt(num(p, "quantity"))} {str(p, "unit")}{" "}
                  · {rub(num(p, "amount"))} ·{" "}
                  {p.status === "confirmed" ? "Подтверждено" : "Отменено"}
                </p>
                {canEdit && p.status === "confirmed" && (
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          "Отменить покупку? Остаток и расход будут компенсированы. Использованную покупку отменить нельзя.",
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await mutate(
                          family,
                          "purchase_reverse",
                          { id: p.id },
                          crypto.randomUUID(),
                        );
                        await reload();
                        notify("Покупка компенсирована; история сохранена.");
                      } catch (e) {
                        notify(errorText(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Отменить покупку
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
      {dialog && (
        <Fields
          title={
            action === "budget_save"
              ? "Бюджет месяца"
              : action === "purchase_confirm"
                ? "Подтвердить фактическую покупку"
                : action === "expense_save"
                  ? "Расход"
                  : "Позиция покупок"
          }
          fields={fields}
          initial={{
            id: crypto.randomUUID(),
            month: monthRange(month).from,
            date: today(),
            product_id: products[0]?.id,
            quantity: 1,
            unit: "г",
            amount: 0,
            category: "Другое",
            status: "open",
            ...dialog.row,
          }}
          onClose={() => setDialog(null)}
          onSave={async (d, k) => {
            await mutate(family, dialog.action, d, k);
            await reload();
            notify("Операция сохранена без повторного учёта.");
          }}
        />
      )}
    </>
  );
}
