import { useState } from "react";
import { Plus } from "lucide-react";
import Fields, { type Field } from "./Fields";
import type { ModuleProps } from "./KitchenPage";
import {
  rows,
  str,
  num,
  fmt,
  today,
  productCategories,
  prepCategories,
  stockUnits,
  type Row,
} from "./model";
import { mutate } from "./api";
import { Photo } from "../recipes/Photos";
export default function Inventory({
  kind,
  state,
  recipes,
  family,
  canEdit,
  reload,
  notify,
}: ModuleProps & { kind: string }) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(0),
    [dialog, setDialog] = useState<{ action: string; row?: Row } | null>(null);
  const prep = kind === "preparations",
    products = rows(state, "products"),
    places = rows(state, "storage_places");
  const options = (a: string[]) => a.map((s) => ({ value: s, label: s }));
  const productOptions = products
    .filter((p) => !p.archived)
    .map((p) => ({ value: p.id, label: str(p, "name") }));
  const placeField: Field = {
    key: "place_id",
    label: "Место хранения",
    options: [
      { value: "", label: "Не указано" },
      ...places.map((p) => ({ value: p.id, label: str(p, "name") })),
    ],
  };
  const action = dialog?.action;
  const fields: Field[] =
    action === "place_save"
      ? [{ key: "name", label: "Название места", required: true }]
      : action === "product_save"
        ? [
            { key: "name", label: "Название продукта", required: true },
            {
              key: "category",
              label: "Категория",
              options: options(productCategories),
            },
            {
              key: "minimum",
              label: "Минимальный остаток в базовой единице",
              type: "number",
              min: 0,
            },
            {
              key: "unit",
              label: "Базовая единица",
              options: options(
                stockUnits.filter((u) => !["кг", "л"].includes(u)),
              ),
            },
            {
              key: "archived",
              label: "Состояние",
              options: [
                { value: "false", label: "Активен" },
                { value: "true", label: "Архив (только при нулевых остатках)" },
              ],
            },
          ]
        : action === "prep_use"
          ? [
              {
                key: "quantity",
                label: `Количество (${str(dialog?.row, "unit")})`,
                type: "number",
                min: 0,
              },
              {
                key: "reason",
                label: "Операция",
                options: options([
                  "Использование",
                  "Перемещение",
                  "Разморозка",
                  "Списание",
                  "Списание просроченного",
                ]),
              },
              placeField,
              {
                key: "expires_on",
                label: "Новый срок годности при разморозке",
                type: "date",
              },
              {
                key: "date",
                label: "Дата использования",
                type: "date",
                required: true,
              },
              {
                key: "menu_id",
                label: "Отметить пункт меню",
                options: [
                  { value: "", label: "Без связи с меню" },
                  ...rows(state, "menu_items")
                    .filter((m) => m.recipe_id === dialog?.row?.recipe_id)
                    .map((m) => ({
                      value: m.id,
                      label: str(m, "title") + " " + str(m, "date"),
                    })),
                ],
              },
            ]
          : prep
            ? [
                { key: "title", label: "Название заготовки", required: true },
                {
                  key: "recipe_id",
                  label: "Связанный рецепт",
                  options: [
                    { value: "", label: "Без рецепта" },
                    ...recipes.map((r) => ({
                      value: r.id,
                      label: r.data.title,
                    })),
                  ],
                },
                {
                  key: "category",
                  label: "Категория",
                  options: options(prepCategories),
                },
                {
                  key: "quantity",
                  label: "Количество",
                  type: "number",
                  min: 0,
                  required: true,
                },
                {
                  key: "unit",
                  label: "Единица",
                  options: options([
                    "порц.",
                    "шт.",
                    "г",
                    "кг",
                    "мл",
                    "л",
                    "упаковка",
                  ]),
                },
                {
                  key: "prepared_on",
                  label: "Дата приготовления",
                  type: "date",
                  required: true,
                },
                {
                  key: "expires_on",
                  label: "Фактический срок годности",
                  type: "date",
                },
                {
                  key: "storage_recommendation",
                  label: "Рекомендуемый срок хранения",
                  type: "textarea",
                },
                placeField,
                { key: "notes", label: "Примечания", type: "textarea" },
              ]
            : [
                {
                  key: "product_id",
                  label: "Продукт",
                  options: productOptions,
                  required: true,
                },
                {
                  key: "quantity",
                  label: "Фактическое количество",
                  type: "number",
                  min: 0,
                  required: true,
                },
                {
                  key: "unit",
                  label: "Единица (количество вводите именно в ней)",
                  options: options(stockUnits),
                },
                {
                  key: "purchased_on",
                  label: "Дата покупки",
                  type: "date",
                  required: true,
                },
                { key: "expires_on", label: "Срок годности", type: "date" },
                placeField,
                {
                  key: "reason",
                  label: "Причина корректировки",
                  options: options([
                    "Ручное добавление",
                    "Ручная корректировка",
                    "Списание",
                    "Списание просроченного",
                    "Удаление партии",
                  ]),
                },
                { key: "notes", label: "Примечания", type: "textarea" },
              ];
  const source = prep
    ? rows(state, "preparations")
    : rows(state, "stock_batches");
  const product = (r: Row) => products.find((p) => p.id === r.product_id);
  const visible = source.filter(
    (r) =>
      num(r, "quantity") > 0 &&
      `${prep ? str(r, "title") : str(product(r), "name")} ${str(product(r), "category")}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")) &&
      (!filter || r.place_id === filter),
  );
  const perPage = 20;
  return (
    <>
      <div className="k-toolbar">
        <input
          aria-label="Поиск запасов"
          placeholder="Поиск по названию и категории"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Место хранения"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Все места хранения</option>
          {places.map((p) => (
            <option value={p.id} key={p.id}>
              {str(p, "name")}
            </option>
          ))}
        </select>
        {canEdit && (
          <>
            <button
              className="primary"
              onClick={() =>
                setDialog({ action: prep ? "prep_save" : "batch_save" })
              }
              disabled={!prep && !productOptions.length}
            >
              <Plus size={17} />
              {prep ? "Добавить заготовку" : "Добавить партию"}
            </button>
            {!prep && (
              <button
                className="secondary"
                onClick={() => setDialog({ action: "product_save" })}
              >
                Новый продукт
              </button>
            )}
            <button
              className="secondary"
              onClick={() => setDialog({ action: "place_save" })}
            >
              Место хранения
            </button>
          </>
        )}
      </div>
      {!visible.length && (
        <div className="panel k-empty">
          {prep
            ? "Заготовок пока нет. Их можно добавить вручную или получить при подтверждении готовки."
            : "Партий пока нет. Сначала добавьте продукт, затем его фактическое количество."}
        </div>
      )}
      <div className="k-list">
        {visible.slice(page * perPage, (page + 1) * perPage).map((r) => (
          <article className="k-item" key={r.id}>
            {prep && (
              <Photo path={str(r, "photo_path")} alt={str(r, "title")} />
            )}
            <span className="pill quiet">
              {prep ? str(r, "category") : str(product(r), "category")}
            </span>
            <h3>{prep ? str(r, "title") : str(product(r), "name")}</h3>
            <strong>
              {fmt(num(r, "quantity"))} {str(r, "unit")}
            </strong>
            <p>
              {str(
                places.find((p) => p.id === r.place_id),
                "name",
              ) || "Место не указано"}{" "}
              · до {str(r, "expires_on") || "не указано"}
            </p>
            {r.expires_on && str(r, "expires_on") < today() && (
              <p className="k-danger">Срок годности истёк</p>
            )}
            {canEdit && (
              <div className="k-actions">
                <button
                  onClick={() =>
                    setDialog({
                      action: prep ? "prep_save" : "batch_save",
                      row: r,
                    })
                  }
                >
                  Изменить / скорректировать
                </button>
                {prep ? (
                  <button
                    onClick={() => setDialog({ action: "prep_use", row: r })}
                  >
                    Использовать / переместить
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      setDialog({ action: "product_save", row: product(r) })
                    }
                  >
                    Карточка продукта
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {visible.length > perPage && (
        <div className="k-pagination">
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          {page + 1} / {Math.ceil(visible.length / perPage)}
          <button
            className="secondary"
            disabled={(page + 1) * perPage >= visible.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее
          </button>
        </div>
      )}
      <section className="panel k-section">
        <h2>История операций</h2>
        <div className="k-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Изменение</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows(state, prep ? "preparation_movements" : "stock_movements")
                .sort((a, b) =>
                  str(b, "created_at").localeCompare(str(a, "created_at")),
                )
                .slice(0, 100)
                .map((m) => (
                  <tr key={m.id}>
                    <td>
                      {new Date(str(m, "created_at")).toLocaleString("ru-RU")}
                    </td>
                    <td>{fmt(num(m, "quantity"))}</td>
                    <td>{str(m, "reason")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Показаны последние 100 движений. Нулевая корректировка убирает партию
          из активного списка, история сохраняется.
        </p>
      </section>
      {dialog && (
        <Fields
          title={
            action === "product_save"
              ? "Карточка продукта"
              : action === "place_save"
                ? "Место хранения"
                : action === "prep_use"
                  ? "Операция с заготовкой"
                  : prep
                    ? "Заготовка"
                    : "Партия продукта"
          }
          fields={fields}
          initial={{
            id: crypto.randomUUID(),
            name: "",
            category: prep ? "Другие" : "Другое",
            minimum: 0,
            unit: prep ? "порц." : "г",
            quantity: 0,
            purchased_on: today(),
            prepared_on: today(),
            date: today(),
            product_id: productOptions[0]?.value,
            reason: "Использование",
            archived: "false",
            ...dialog.row,
          }}
          onClose={() => setDialog(null)}
          onSave={async (d, k) => {
            await mutate(family, dialog.action, d, k);
            await reload();
            notify("Операция сохранена. История и остатки обновлены.");
          }}
        />
      )}
    </>
  );
}
