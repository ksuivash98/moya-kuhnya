import LayoutToggle, { useListLayout } from "../components/ListLayout";
import { useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import type { ModuleProps } from "./KitchenPage";
import Modal from "../components/Modal";
import Fields, { type Field } from "./Fields";
import ProductPicker from "./ProductPicker";
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
  const [params] = useSearchParams();
  const [layout, setLayout] = useListLayout(kind);
  const [category, setCategory] = useState("");
  const [productBusy, setProductBusy] = useState(false);
  useEffect(() => {
    setCategory("");
    setPage(0);
  }, [kind]);
  const [clearRequest, setClearRequest] = useState<{
    key: string;
    month: string;
    items: { id: string; version: number }[];
  } | null>(null);
  const [clearError, setClearError] = useState("");
  async function clearShopping() {
    if (!clearRequest || busy) return;
    setBusy(true);
    setClearError("");
    try {
      await mutate(
        family,
        "shopping_clear",
        { month: clearRequest.month, items: clearRequest.items },
        clearRequest.key,
      );
      await reload();
      setPage(0);
      setClearRequest(null);
      notify(
        "Выбранные позиции убраны из покупок. История оплаченных покупок сохранена.",
      );
    } catch (e) {
      const message = errorText(e);
      setClearError(
        /Действие недоступно/i.test(message)
          ? "Для очистки покупок примените миграцию 012 в Supabase. Список не изменён."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
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
                render:
                  action === "shopping_save" && !dialog?.row
                    ? (initial) => (
                        <ProductPicker
                          label="Продукт"
                          createdHint="Продукт сохранится в справочнике. В покупки он добавится после нажатия «Сохранить» внизу окна."
                          options={products
                            .filter((p) => !p.archived)
                            .map((p) => ({
                              value: p.id,
                              label: str(p, "name"),
                            }))}
                          initial={String(initial ?? "")}
                          onBusy={setProductBusy}
                          onCreate={async (data, key) => {
                            await mutate(
                              family,
                              "product_save",
                              { ...data, minimum: 0, archived: false },
                              key,
                            );
                            await reload();
                          }}
                        />
                      )
                    : undefined,
                options: products
                  .filter((p) => !p.archived)
                  .map((p) => ({ value: p.id, label: str(p, "name") })),
                required: true,
              },
              {
                key: "category",
                label: "Категория",
                options: [
                  {
                    value: "__auto__",
                    label: "Категория продукта / автоматически",
                  },
                  ...opts(productCategories),
                ],
                hint: "Ручной выбор сохранится для продукта и его открытых покупок. Пересчёт его не сбросит.",
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
  const allItems = shopping
    ? rows(state, "shopping_items")
        .filter((r) => str(r, "month").startsWith(month) && r.status === "open")
        .sort((a, b) =>
          str(a, "category").localeCompare(str(b, "category"), "ru"),
        )
    : rows(state, "expenses").filter((r) => str(r, "date").startsWith(month));
  const list = allItems.filter(
    (r) => !category || str(r, "category") === category,
  );
  const categories = [
    ...new Set([
      ...productCategories,
      ...allItems.map((r) => str(r, "category")),
    ]),
  ].filter(Boolean);
  return (
    <>
      {shopping && params.get("recipe") && canEdit && (
        <div className="notice">
          <p>
            Добавить ингредиенты выбранного рецепта? Если его ещё нет в плане
            месяца, будет создан один пункт без даты, затем пересчитан общий
            список. Существующий план не дублируется.
          </p>
          <button
            className="primary"
            disabled={busy || !navigator.onLine}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate(
                  family,
                  "shopping_recipe",
                  {
                    recipe_id: params.get("recipe"),
                    servings: params.get("servings") || 4,
                    month: month + "-01",
                  },
                  crypto.randomUUID(),
                );
                await reload();
                notify("План и покупки обновлены.");
              } catch (e) {
                notify(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить потребность в список
          </button>
        </div>
      )}
      {!shopping && (
        <div className={`k-metrics list-layout list-layout--${layout}`}>
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
                  onClick={() => setDialog({ action: "shopping_save" })}
                >
                  Добавить вручную
                </button>
                <button
                  className="secondary danger"
                  disabled={busy || !navigator.onLine || !allItems.length}
                  onClick={() => {
                    setClearError("");
                    setClearRequest({
                      key: crypto.randomUUID(),
                      month: month + "-01",
                      items: allItems.map((r) => ({
                        id: r.id,
                        version: r.version,
                      })),
                    });
                  }}
                >
                  Очистить покупки
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
      <div className="list-options">
        <label>
          Категория
          <select
            aria-label="Категория списка"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <LayoutToggle value={layout} onChange={setLayout} />
      </div>
      <p className="help-text">
        {shopping
          ? "Фильтр меняет только список «Нужно купить». История, итоги и очистка относятся ко всему выбранному месяцу."
          : "Фильтр меняет только список расходов. Итоги рассчитаны по всему выбранному месяцу."}
      </p>
      {!list.length && (
        <div className="panel k-empty">
          {category
            ? "В этой категории записей нет. Выберите другую или все категории."
            : shopping
              ? "Список покупок пуст. Рассчитайте недостающее по плану или добавьте вручную."
              : "За выбранный месяц расходов нет."}
        </div>
      )}
      <div className={`k-list list-layout list-layout--${layout}`}>
        {list.slice(page * 20, (page + 1) * 20).map((r) => (
          <article className="k-item finance-item" key={r.id}>
            <div className="finance-item-title">
              <span className="pill quiet">{str(r, "category")}</span>
              <h3>
                {shopping
                  ? str(
                      products.find((p) => p.id === r.product_id),
                      "name",
                    )
                  : str(r, "title")}
              </h3>
            </div>
            <strong className="finance-item-quantity">
              {shopping
                ? `${fmt(num(r, "quantity"))} ${str(r, "unit")}`
                : rub(num(r, "amount"))}
            </strong>
            <div className="k-actions finance-item-actions">
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
          <div className={`k-list list-layout list-layout--${layout}`}>
            {rows(state, "purchases")
              .filter((p) => str(p, "date").startsWith(month))
              .map((p) => (
                <div key={p.id} className="k-item finance-history-item">
                  <strong>
                    {str(
                      rows(state, "expenses").find(
                        (e) => e.id === p.expense_id,
                      ),
                      "title",
                    ) || "Покупка"}
                  </strong>
                  <p>
                    {str(p, "date")} · {fmt(num(p, "quantity"))}{" "}
                    {str(p, "unit")} · {rub(num(p, "amount"))} ·{" "}
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
          </div>
        </section>
      )}
      {clearRequest && (
        <Modal
          title="Очистить покупки?"
          onClose={() => !busy && setClearRequest(null)}
        >
          <p className="muted">
            Убрать {clearRequest.items.length} позиций «Нужно купить» за{" "}
            {new Date(clearRequest.month + "T00:00:00Z").toLocaleDateString(
              "ru-RU",
              { month: "long", year: "numeric", timeZone: "UTC" },
            )}
            ?
          </p>
          <p className="notice">
            Очистка относится ко всему месяцу, независимо от фильтра категории.
            Оплаченные покупки, расходы, запасы и другие месяцы сохранятся. При
            новом расчёте по меню недостающие продукты могут появиться снова.
          </p>
          {clearError && (
            <p className="error" role="alert">
              {clearError}
            </p>
          )}
          <div className="shopping-clear-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setClearRequest(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={busy || !navigator.onLine}
              onClick={() => void clearShopping()}
            >
              {busy ? "Очищаем…" : "Очистить список"}
            </button>
          </div>
        </Modal>
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
          externalBusy={productBusy}
          initial={{
            id: crypto.randomUUID(),
            month: monthRange(month).from,
            date: today(),
            product_id: action === "shopping_save" ? "" : products[0]?.id,
            quantity: 1,
            unit: "г",
            amount: 0,
            category: "Другое",
            status: "open",
            ...dialog.row,
            ...(action === "shopping_save" ? { category: "__auto__" } : {}),
          }}
          onClose={() => setDialog(null)}
          onSave={async (d, k) => {
            try {
              await mutate(
                family,
                dialog.action === "shopping_save"
                  ? "shopping_save_categorized"
                  : dialog.action,
                d,
                k,
              );
            } catch (e) {
              if (
                dialog.action === "shopping_save" &&
                /Действие недоступно/i.test(errorText(e))
              )
                throw new Error(
                  "Для выбора категорий покупок примените миграцию 011 в Supabase. Изменения остаются в форме.",
                );
              throw e;
            }
            await reload();
            notify("Операция сохранена без повторного учёта.");
          }}
        />
      )}
    </>
  );
}
