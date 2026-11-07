import { Check, MoreHorizontal } from "lucide-react";
import {
  shoppingGroups,
  shoppingGroupQuantity,
  shoppingQuantity,
} from "./shopping-groups";
import ShoppingCategories, {
  type CategorySuggestion,
} from "./ShoppingCategories";
import { suggestProductCategory } from "./product-category";
import LayoutToggle, { useListLayout } from "../components/ListLayout";
import { useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import type { ModuleProps } from "./KitchenPage";
import Modal from "../components/Modal";
import Fields, { type Field } from "./Fields";
import ProductPicker from "./ProductPicker";
import { loadKitchen, mutate } from "./api";
import { syncShopping } from "./sync-shopping";
import { stableShoppingId } from "./shopping-reconciliation";
import type { PlanScope } from "./plan-requirements";
import {
  rows,
  str,
  num,
  rub,
  fmt,
  today,
  addDays,
  productCategories,
  stockUnits,
  monthRange,
  type Row,
} from "./model";
import { errorText } from "../supabase";
export default function Finance({
  kind,
  userId,
  state,
  family,
  canEdit,
  month,
  reload,
  notify,
}: ModuleProps & { kind: string; userId: string }) {
  const [params] = useSearchParams();
  const requestedFrom = params.get("plan_from") ?? "",
    requestedTo = params.get("plan_to") ?? "";
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const validRequested =
    validDate(requestedFrom) &&
    validDate(requestedTo) &&
    requestedFrom <= requestedTo;
  const initialMode = validRequested
    ? requestedFrom === requestedTo
      ? "day"
      : "range"
    : "month";
  const defaultStart = month === today().slice(0, 7) ? today() : month + "-01";
  const [calculationPeriod, setCalculationPeriod] = useState(initialMode);
  const [from, setFrom] = useState(
    validRequested ? requestedFrom : defaultStart,
  );
  const [rangeEnd, setRangeEnd] = useState(
    validRequested ? requestedTo : addDays(defaultStart, 2),
  );
  useEffect(() => {
    setCalculationPeriod(initialMode);
    setFrom(validRequested ? requestedFrom : defaultStart);
    setRangeEnd(validRequested ? requestedTo : addDays(defaultStart, 2));
  }, [month, requestedFrom, requestedTo]);
  const to =
    calculationPeriod === "day"
      ? from
      : calculationPeriod === "week" && validDate(from)
        ? addDays(from, 6)
        : rangeEnd;
  const dated = calculationPeriod !== "month";
  const periodError =
    dated && (!validDate(from) || !validDate(to) || to < from)
      ? "Укажите корректные даты начала и конца периода."
      : "";
  const planKind = params.get("plan_kind");
  const scope: PlanScope = {
    month,
    ...(dated ? { from, to } : {}),
    ...(planKind === "menu" || planKind === "cooking"
      ? { kind: planKind }
      : {}),
  };
  const [calculationWarnings, setCalculationWarnings] = useState<string[]>([]);
  useEffect(
    () => setCalculationWarnings([]),
    [month, from, to, planKind, calculationPeriod],
  );
  const [layout, setLayout] = useListLayout(kind);
  const [categoryLayout, setCategoryLayout] = useState(() => {
    try {
      return localStorage.getItem("kitchen-shopping-categories") !== "off";
    } catch {
      return true;
    }
  });
  function chooseCategoryLayout(value: boolean) {
    setCategoryLayout(value);
    try {
      localStorage.setItem("kitchen-shopping-categories", value ? "on" : "off");
    } catch {
      /* Вид доступен и без хранилища. */
    }
  }
  const [category, setCategory] = useState("");
  const [categoryReview, setCategoryReview] = useState<
    CategorySuggestion[] | null
  >(null);
  const [groupAction, setGroupAction] = useState<{
    id: string;
    action: "purchase_confirm" | "shopping_save";
  } | null>(null);
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
    if (periodError || busy) return;
    setBusy(true);
    try {
      const result = await syncShopping(family, userId, scope);
      setCalculationWarnings(result.warnings);
      await reload();
      setPage(0);
      notify(
        result.warnings.length
          ? "Список пересчитан. Проверьте позиции с разными единицами ниже."
          : "Список пересчитан с учётом запасов и заготовок. История покупок сохранена.",
      );
    } catch (e) {
      await reload();
      notify(
        `Пересчёт не завершён: ${errorText(e)} Повторите расчёт после обновления данных.`,
      );
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
  const categorySuggestions: CategorySuggestion[] = [];
  const suggestedProducts = new Set<string>();
  if (shopping)
    for (const row of allItems) {
      if (
        str(row, "category") !== "Другое" ||
        suggestedProducts.has(String(row.product_id))
      )
        continue;
      const product = products.find(
        (p) => p.id === row.product_id && !p.archived,
      );
      if (!product) continue;
      const saved = str(product, "category");
      const suggested =
        saved && saved !== "Другое"
          ? saved
          : suggestProductCategory(str(product, "name"));
      if (suggested !== "Другое" && productCategories.includes(suggested)) {
        categorySuggestions.push({
          row,
          name: str(product, "name"),
          category: suggested,
        });
        suggestedProducts.add(product.id);
      }
    }
  const groups = shopping ? shoppingGroups(allItems, products) : [];
  const groupsById = new Map(groups.map((group) => [group.display.id, group]));
  const selectedGroup = groupAction
    ? groupsById.get(groupAction.id)
    : undefined;
  function openShoppingItem(
    row: Row,
    action: "purchase_confirm" | "shopping_save",
  ) {
    const group = groupsById.get(row.id);
    if (group && group.members.length > 1)
      setGroupAction({ id: row.id, action });
    else setDialog({ action, row: group?.members[0] ?? row });
  }
  const list = (
    shopping ? groups.map((group) => group.display) : allItems
  ).filter((r) => !category || str(r, "category") === category);
  const categories = [
    ...new Set([
      ...productCategories,
      ...allItems.map((r) => str(r, "category")),
    ]),
  ].filter(Boolean);
  const checklist = shopping && categoryLayout;
  const sectionTitles: Record<string, string> = {
    Мясо: "Мясо, птица и фарш",
    Овощи: "Овощи, зелень и грибы",
  };
  const sectionOrder = [
    ...new Set([
      "Мясо",
      "Рыба",
      "Овощи",
      "Фрукты",
      ...categories.filter((c) => c !== "Другое"),
      "Другое",
    ]),
  ];
  const sections = sectionOrder
    .map((name) => ({
      name,
      title: sectionTitles[name] ?? name,
      items: list.filter((r) => str(r, "category") === name),
    }))
    .filter((section) => section.items.length);
  function renderItem(r: Row) {
    const name = shopping ? groupsById.get(r.id)!.name : str(r, "title");
    const members = shopping ? groupsById.get(r.id)!.members.length : 1;
    const headingId = `shopping-item-${r.id}`;
    return (
      <article
        className={`k-item finance-item ${checklist ? "shopping-checklist-row" : ""}`}
        key={r.id}
      >
        {checklist &&
          (canEdit ? (
            <button
              type="button"
              className="shopping-check"
              aria-label="Куплено"
              aria-describedby={headingId}
              aria-haspopup="dialog"
              title={`Подтвердить покупку: ${name}`}
              disabled={busy || productBusy}
              onClick={() => openShoppingItem(r, "purchase_confirm")}
            >
              <Check size={13} aria-hidden="true" />
            </button>
          ) : (
            <span
              className="shopping-check shopping-check--readonly"
              aria-hidden="true"
            />
          ))}
        <div className="finance-item-title">
          <span className="pill quiet">{str(r, "category")}</span>
          <h3 id={headingId}>{name}</h3>
          {checklist && members > 1 && (
            <small className="shopping-group-note">
              Объединено позиций: {members}
            </small>
          )}
        </div>
        <strong className="finance-item-quantity">
          {shopping
            ? shoppingGroupQuantity(groupsById.get(r.id)!)
            : rub(num(r, "amount"))}
        </strong>
        {!checklist && shopping && members > 1 && (
          <small>Объединено позиций: {members}</small>
        )}
        <div className="k-actions finance-item-actions">
          {canEdit && (
            <>
              {shopping && !checklist && (
                <button onClick={() => openShoppingItem(r, "purchase_confirm")}>
                  Куплено
                </button>
              )}
              <button
                type="button"
                className={checklist ? "shopping-edit" : undefined}
                aria-label={checklist ? "Изменить / удалить" : undefined}
                aria-describedby={checklist ? headingId : undefined}
                title={checklist ? `Изменить / удалить: ${name}` : undefined}
                aria-haspopup="dialog"
                onClick={() =>
                  shopping
                    ? openShoppingItem(r, "shopping_save")
                    : setDialog({ action: "expense_save", row: r })
                }
              >
                {checklist ? (
                  <MoreHorizontal size={17} aria-hidden="true" />
                ) : (
                  <>Изменить{shopping ? " / удалить" : ""}</>
                )}
              </button>
            </>
          )}
        </div>
      </article>
    );
  }
  return (
    <>
      {selectedGroup && groupAction && (
        <Modal
          title={`Позиции: ${selectedGroup.name}`}
          onClose={() => setGroupAction(null)}
        >
          <p className="muted">
            Всего: {shoppingGroupQuantity(selectedGroup)}. Выберите позицию,
            которую купили или хотите изменить. Сумма на карточке включает все
            позиции ниже.
          </p>
          {selectedGroup.quantities.length > 1 && (
            <p className="notice">
              Разные единицы показаны отдельно: их вес автоматически не
              подставляется.
            </p>
          )}
          <div className="form-stack">
            {selectedGroup.members.map((item) => (
              <div className="k-item" key={item.id}>
                <strong>
                  {str(
                    products.find((p) => p.id === item.product_id),
                    "name",
                  )}
                </strong>
                <p>
                  {shoppingQuantity(
                    selectedGroup.name,
                    num(item, "quantity"),
                    str(item, "unit"),
                  )}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDialog({ action: groupAction.action, row: item });
                    setGroupAction(null);
                  }}
                >
                  {groupAction.action === "purchase_confirm"
                    ? "Куплено"
                    : "Изменить / удалить"}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
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
                const range = monthRange(month);
                const fresh = await loadKitchen(family, range.from, range.to);
                const recipeId = params.get("recipe")!;
                const planned = [
                  ...rows(fresh, "menu_items"),
                  ...rows(fresh, "cooking_tasks"),
                ].some(
                  (r) =>
                    r.recipe_id === recipeId &&
                    (str(r, "month").startsWith(month) ||
                      str(r, "date").startsWith(month)) &&
                    ![
                      "Отменено",
                      "Приготовлено",
                      "Сделана заготовка",
                      "Приготовлено из заготовки",
                    ].includes(str(r, "status")),
                );
                if (!planned)
                  await mutate(
                    family,
                    "menu_save",
                    {
                      id: await stableShoppingId(
                        "recipe-plan",
                        `${family}:${month}:${recipeId}:${[
                          ...rows(fresh, "menu_items"),
                          ...rows(fresh, "cooking_tasks"),
                        ]
                          .filter((r) => r.recipe_id === recipeId)
                          .map((r) => r.id)
                          .sort()
                          .join(",")}`,
                      ),
                      recipe_id: recipeId,
                      servings: params.get("servings") || 4,
                      month: month + "-01",
                      date: "",
                      meal: "Другое",
                      planned_count: 1,
                      status: "Запланировано",
                    },
                    crypto.randomUUID(),
                  );
                const result = await syncShopping(family, userId, { month });
                setCalculationWarnings(result.warnings);
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
      {categoryReview && (
        <ShoppingCategories
          suggestions={categoryReview}
          family={family}
          reload={reload}
          onClose={() => setCategoryReview(null)}
        />
      )}
      {shopping && canEdit && (
        <fieldset className="shopping-period-settings panel" disabled={busy}>
          <legend>Период расчёта продуктов</legend>
          <label>
            Рассчитать за
            <select
              aria-label="Рассчитать за"
              value={calculationPeriod}
              onChange={(e) => setCalculationPeriod(e.target.value)}
            >
              <option value="month">Выбранный месяц</option>
              <option value="day">Один день</option>
              <option value="week">7 дней</option>
              <option value="range">Несколько дней</option>
            </select>
          </label>
          {dated && (
            <label>
              {calculationPeriod === "day" ? "Дата расчёта" : "Начало расчёта"}
              <input
                type="date"
                aria-label={
                  calculationPeriod === "day"
                    ? "Дата расчёта"
                    : "Начало расчёта"
                }
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
          )}
          {calculationPeriod === "range" && (
            <label>
              Конец расчёта
              <input
                type="date"
                aria-label="Конец расчёта"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
              />
            </label>
          )}
          <p className="muted">
            Расчёт заменяет автоматические позиции выбранного месяца {month}.
            Ручные позиции и история покупок сохраняются. Для общего меню на
            несколько дней учитывается вся потребность периода один раз.
          </p>
          {periodError && (
            <p className="error" role="alert">
              {periodError}
            </p>
          )}
        </fieldset>
      )}
      {shopping && (
        <p className="muted">
          Расчёт:{" "}
          {periodError
            ? "уточните даты"
            : dated
              ? `${from} — ${to}`
              : `месяц ${month}`}
          {scope.kind === "menu"
            ? ", меню"
            : scope.kind === "cooking"
              ? ", план приготовления"
              : ", меню и план приготовления"}
          . Учитываются запасы, заготовки и подбор продуктов из меню в этом
          браузере. Старые автоматические строки обновятся при пересчёте.
        </p>
      )}
      {shopping && calculationWarnings.length > 0 && (
        <div className="notice" role="status">
          {calculationWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
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
                  disabled={busy || !navigator.onLine || !!periodError}
                  onClick={() => void generate()}
                >
                  Рассчитать недостающие продукты
                </button>
                {categorySuggestions.length > 0 && (
                  <button
                    className="secondary"
                    disabled={busy || !navigator.onLine}
                    onClick={() => setCategoryReview(categorySuggestions)}
                  >
                    Уточнить категории ({categorySuggestions.length})
                  </button>
                )}
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
          ? "Список учитывает незавершённые блюда и совместимые единицы. Фактическая покупка одновременно создаёт партию и расход. Новый продукт можно создать через «Добавить вручную»."
          : "Все суммы рассчитаны по финансовому журналу. Корректировки сохраняют прежние записи и создают компенсации; прогноз — пропорция текущих расходов по дням, а не обещание."}
      </p>
      <div className="list-options">
        <label>
          Категория
          <select
            aria-label="Категория списка"
            data-shell-filter={busy || productBusy ? undefined : true}
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
        {shopping ? (
          <div className="shopping-view-options">
            <button
              type="button"
              className="secondary shopping-category-toggle"
              aria-pressed={checklist}
              onClick={() => chooseCategoryLayout(true)}
            >
              По категориям
            </button>
            <LayoutToggle
              value={layout}
              active={!checklist}
              onChange={(value) => {
                chooseCategoryLayout(false);
                setLayout(value);
              }}
            />
          </div>
        ) : (
          <LayoutToggle value={layout} onChange={setLayout} />
        )}
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
      {checklist ? (
        <div className="k-list shopping-checklist" aria-label="Нужно купить">
          {sections.map((section) => (
            <section
              key={section.name}
              className="shopping-category-section"
              aria-label={section.title}
            >
              <h2>{section.title}</h2>
              <ul className="shopping-category-items">
                {section.items.map((r) => (
                  <li key={r.id}>{renderItem(r)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div
          className={`k-list ${shopping ? "shopping-grid" : ""} list-layout list-layout--${layout}`}
        >
          {list.slice(page * 20, (page + 1) * 20).map(renderItem)}
        </div>
      )}
      {!checklist && list.length > 20 && (
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
