import LayoutToggle, { useListLayout } from "../components/ListLayout";
import { client, check } from "../supabase";
import { NavLink, useSearchParams } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
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
import { Photo, PhotoField } from "../recipes/Photos";
import ProductPicker from "./ProductPicker";
import ProductsEditor from "./ProductsEditor";
export default function Inventory({
  kind,
  state,
  recipes,
  family,
  canEdit,
  reload,
  notify,
}: ModuleProps & { kind: string }) {
  const [params] = useSearchParams();
  const [layout, setLayout] = useListLayout(kind);
  const [category, setCategory] = useState("");
  const [editor, setEditor] = useState(false);
  useEffect(() => {
    setCategory("");
    setFilter("");
    setQuery("");
    setPage(0);
  }, [kind]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null | undefined>();
  const [photoPath, setPhotoPath] = useState("");
  const [photoBusy, setPhotoBusy] = useState(0);
  const [productBusy, setProductBusy] = useState(false);
  const onPhotoBusy = useCallback(
    (n: number) => setPhotoBusy((v) => Math.max(0, v + n)),
    [],
  );
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(0),
    [dialog, setDialog] = useState<{ action: string; row?: Row } | null>(null);
  const prep = kind === "preparations",
    products = rows(state, "products"),
    places = rows(state, "storage_places");
  const expiryDue = !prep && params.get("expiry") === "due";
  const options = (a: string[]) => a.map((s) => ({ value: s, label: s }));
  const productOptions = products
    .filter((p) => !p.archived)
    .map((p) => ({ value: p.id, label: str(p, "name") }));
  const placeField: Field = {
    key: "place_id",
    label: prep ? "Место хранения" : "Где хранится",
    hint: prep
      ? undefined
      : "Выберите холодильник, морозилку или шкаф. Новое место можно создать кнопкой «Добавить место хранения».",
    options: [
      { value: "", label: "Не указано" },
      ...places.map((p) => ({ value: p.id, label: str(p, "name") })),
    ],
  };
  const action = dialog?.action;
  useEffect(() => {
    setPhotoBlob(undefined);
    setPhotoPath(str(dialog?.row, "photo_path"));
    setPhotoBusy(0);
  }, [dialog?.action, dialog?.row?.id]);
  const fields: Field[] =
    action === "place_save"
      ? [
          {
            key: "name",
            label: "Название места",
            required: true,
            hint: "Например: холодильник, морозилка или кухонный шкаф.",
          },
        ]
      : action === "product_save"
        ? [
            {
              key: "name",
              label: "Название продукта",
              required: true,
              hint: "Только название: например, молоко или рис. Количество и срок годности добавляются отдельно в запасе.",
            },
            {
              key: "category",
              label: "Категория продукта",
              hint: "Группа для покупок и учёта: например, молочные продукты, овощи или крупы.",
              options: options(productCategories),
            },
            {
              key: "minimum",
              label: "Желаемый минимальный запас",
              hint: "Необязательно. Сколько хотите держать дома в выбранной единице учёта. Например, 500 г. Сейчас это справочное значение: на расчёт покупок не влияет. 0 — минимум не задан.",
              type: "number",
              min: 0,
            },
            {
              key: "unit",
              label: "Единица учёта продукта",
              hint: "В чём считать запас: г для веса, мл для жидкости, шт. для отдельных предметов. Кг и л пересчитываются в г и мл. Упаковки в граммы автоматически не переводятся.",
              options: options(
                stockUnits.filter((u) => !["кг", "л"].includes(u)),
              ),
            },
            {
              key: "archived",
              label: "Использование продукта",
              hint: "Архив скрывает продукт из выбора, сохраняя историю. Убрать в архив можно только при нулевом остатке.",
              options: [
                { value: "false", label: "Используется" },
                { value: "true", label: "В архиве (когда запас закончился)" },
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
                  label: "Какой продукт",
                  hint: dialog?.row
                    ? "Для сохранённого запаса нельзя менять продукт. Новое название добавьте отдельным запасом."
                    : "Найдите продукт по названию или создайте новый прямо в этом окне.",
                  options: productOptions,
                  render: dialog?.row
                    ? undefined
                    : (initial) => (
                        <ProductPicker
                          options={productOptions}
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
                      ),
                  required: true,
                },
                {
                  key: "quantity",
                  label: dialog?.row
                    ? "Сколько осталось"
                    : "Сколько есть в этой упаковке",
                  hint: dialog?.row
                    ? "Введите новый остаток, а не расход. Например: было 800 г, использовали 300 г — укажите 500 г. Чтобы убрать запас, введите 0."
                    : "Введите количество для одного срока годности и места хранения. Например: 0,5 кг, 500 г или 2 шт. Упаковки с разными сроками добавляйте отдельно.",
                  type: "number",
                  min: 0,
                  required: true,
                },
                {
                  key: "unit",
                  label: "В чём указано количество",
                  hint: "Выберите единицу к числу выше: 0,5 + кг = 500 г. Для уже сохранённого запаса нельзя менять продукт или тип единицы: например, граммы на штуки.",
                  options: options(stockUnits),
                },
                {
                  key: "purchased_on",
                  label: "Когда купили",
                  hint: "Дата покупки этой упаковки или порции продукта.",
                  type: "date",
                  required: true,
                },
                {
                  key: "expires_on",
                  label: "Годен до",
                  type: "date",
                  hint: "Укажите дату с упаковки. Если срок неизвестен, поле можно оставить пустым.",
                },
                placeField,
                {
                  key: "reason",
                  label: "Почему меняете запас",
                  hint: "Причина попадёт в историю. Количество выше всегда означает, сколько осталось после изменения.",
                  options: [
                    {
                      value: "Ручное добавление",
                      label: "Добавляю имеющийся запас",
                    },
                    {
                      value: "Ручная корректировка",
                      label: "Уточняю оставшееся количество",
                    },
                    { value: "Списание", label: "Использовано или испорчено" },
                    {
                      value: "Списание просроченного",
                      label: "Истёк срок годности",
                    },
                    {
                      value: "Удаление партии",
                      label: "Убираю запас — остаток должен быть 0",
                    },
                  ],
                },
                { key: "notes", label: "Примечания", type: "textarea" },
              ];
  const source = prep
    ? rows(state, "preparations")
    : rows(state, "stock_batches");
  const product = (r: Row) => products.find((p) => p.id === r.product_id);
  const categoryOf = (r: Row) =>
    (prep ? str(r, "category") : str(product(r), "category")) ||
    (prep ? "Другие" : "Другое");
  const categories = [
    ...new Set([
      ...(prep ? prepCategories : productCategories),
      ...source.map(categoryOf),
    ]),
  ];
  const visible = source.filter(
    (r) =>
      num(r, "quantity") > 0 &&
      (!expiryDue || (!!r.expires_on && str(r, "expires_on") <= today())) &&
      `${prep ? str(r, "title") : str(product(r), "name")} ${categoryOf(r)}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")) &&
      (!filter || r.place_id === filter) &&
      (!category || categoryOf(r) === category),
  );
  useEffect(() => {
    if (prep && canEdit && params.get("recipe")) {
      const r = recipes.find((r) => r.id === params.get("recipe"));
      if (r)
        setDialog({
          action: "prep_save",
          row: {
            id: crypto.randomUUID(),
            family_id: family,
            version: 0,
            recipe_id: r.id,
            title: r.data.title,
            photo_path: r.data.photo,
            category: "Готовые блюда",
            quantity: 0,
            unit: "порц.",
            prepared_on: today(),
            storage_recommendation: r.data.shelfLife,
          },
        });
    }
  }, [params, prep, canEdit, family]);
  const perPage = 20;
  return (
    <>
      {!prep && (
        <section className="panel stock-help" aria-label="Как вести запасы">
          <h2>Что сюда записывать</h2>
          <p>
            <strong>Создать продукт</strong> — добавить название и настройки,
            например «Молоко». Само по себе это не добавляет молоко в запасы.
          </p>
          <p>
            <strong>Добавить запас</strong> — указать, сколько продукта уже есть
            дома, где он лежит и до какой даты годен. Если название уже есть в
            списке, создавать его повторно не нужно.
          </p>
          <p>
            Упаковки с разными сроками или местами хранения добавляйте отдельно.
            Например: одна пачка творога в холодильнике и другая в морозилке —
            два запаса.
          </p>
          <p>
            Покупку с ценой оформляйте в{" "}
            <NavLink to="/shopping">«Покупках»</NavLink>: там одновременно
            обновятся запасы и расходы. Ручное добавление здесь не записывает
            расход денег.
          </p>
        </section>
      )}
      {expiryDue && (
        <p className="notice">
          Показаны партии со сроком до сегодня включительно.{" "}
          <NavLink to="/products">Показать все запасы</NavLink>
        </p>
      )}
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
        <select
          aria-label="Категория"
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
        <LayoutToggle value={layout} onChange={setLayout} />
        {canEdit && (
          <>
            <button
              className="primary"
              onClick={() =>
                setDialog({ action: prep ? "prep_save" : "batch_save" })
              }
            >
              <Plus size={17} />
              {prep ? "Добавить заготовку" : "Добавить запас"}
            </button>
            {!prep && (
              <button
                className="secondary"
                onClick={() => setEditor((open) => !open)}
                aria-expanded={editor}
              >
                Редактор продуктов
              </button>
            )}
            {!prep && (
              <button
                className="secondary"
                onClick={() => setDialog({ action: "product_save" })}
              >
                Создать продукт
              </button>
            )}
            <button
              className="secondary"
              onClick={() => setDialog({ action: "place_save" })}
            >
              {prep ? "Место хранения" : "Добавить место хранения"}
            </button>
          </>
        )}
      </div>
      {!prep && canEdit && editor && (
        <ProductsEditor
          products={products}
          batches={rows(state, "stock_batches")}
          onClose={() => setEditor(false)}
          onEdit={(row) => setDialog({ action: "product_save", row })}
          onArchive={async (row, archived, key) => {
            await mutate(family, "product_save", { ...row, archived }, key);
            await reload();
            notify(
              archived
                ? "Продукт удалён из списка. История сохранена."
                : "Продукт восстановлен.",
            );
          }}
        />
      )}
      {!visible.length && (
        <div className="panel k-empty">
          {query || filter || category
            ? "По этим условиям запасов нет. Измените поиск, категорию или место хранения."
            : expiryDue
              ? "Партий с истёкшим или истекающим сегодня сроком нет."
              : prep
                ? "Заготовок пока нет. Их можно добавить вручную или получить при подтверждении готовки."
                : "Запасов пока нет. Нажмите «Создать продукт», если названия ещё нет в списке, затем «Добавить запас» и укажите количество."}
        </div>
      )}
      <div
        className={`k-list ${prep ? "" : "products-grid"} list-layout list-layout--${layout}`}
      >
        {visible.slice(page * perPage, (page + 1) * perPage).map((r) => (
          <article
            className={`k-item inventory-item ${prep ? "inventory-item--photo" : ""}`}
            key={r.id}
          >
            {prep && (
              <div className="inventory-item-photo">
                <Photo
                  path={str(r, "photo_path")}
                  alt={str(r, "title")}
                  zoomable
                />
              </div>
            )}
            <div className="inventory-item-title">
              <span className="pill quiet">
                {prep ? str(r, "category") : str(product(r), "category")}
              </span>
              <h3>{prep ? str(r, "title") : str(product(r), "name")}</h3>
            </div>
            <strong className="inventory-item-quantity">
              {!prep && "В наличии: "}
              {fmt(num(r, "quantity"))} {str(r, "unit")}
            </strong>
            <div className="inventory-item-storage">
              <p>
                {str(
                  places.find((p) => p.id === r.place_id),
                  "name",
                ) || "Место не указано"}{" "}
                · {prep ? "до" : "Годен до:"}{" "}
                {str(r, "expires_on") || "не указано"}
              </p>
              {r.expires_on && str(r, "expires_on") < today() && (
                <p className="k-danger">Срок годности истёк</p>
              )}
            </div>
            {canEdit && (
              <div className="k-actions inventory-item-actions">
                <button
                  onClick={() =>
                    setDialog({
                      action: prep ? "prep_save" : "batch_save",
                      row: r,
                    })
                  }
                >
                  {prep ? "Изменить / скорректировать" : "Изменить запас"}
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
                    Настройки продукта
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
        <h2>{prep ? "История операций" : "Как менялись запасы"}</h2>
        <div className="k-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>{prep ? "Продукт / заготовка" : "Продукт"}</th>
                <th>{prep ? "Изменение" : "Добавлено / убыло"}</th>
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
                    <td>
                      {prep
                        ? str(
                            rows(state, "preparations").find(
                              (p) => p.id === m.preparation_id,
                            ),
                            "title",
                          )
                        : str(
                            products.find(
                              (p) =>
                                p.id ===
                                rows(state, "stock_batches").find(
                                  (b) => b.id === m.batch_id,
                                )?.product_id,
                            ),
                            "name",
                          )}
                    </td>
                    <td>
                      {fmt(num(m, "quantity"))}{" "}
                      {str(
                        rows(
                          state,
                          prep ? "preparations" : "stock_batches",
                        ).find(
                          (r) =>
                            r.id === (prep ? m.preparation_id : m.batch_id),
                        ),
                        "unit",
                      )}
                    </td>
                    <td>{str(m, "reason")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          {prep
            ? "Показаны последние 100 движений. Нулевая корректировка убирает партию из активного списка, история сохраняется."
            : "Здесь последние 100 изменений: положительное число — добавили, отрицательное — использовали или списали. Остаток 0 убирает запас из списка, но не удаляет историю."}
        </p>
      </section>
      {dialog && (
        <Fields
          title={
            action === "product_save"
              ? dialog.row
                ? "Настройки продукта"
                : "Создать продукт"
              : action === "place_save"
                ? "Место хранения"
                : action === "prep_use"
                  ? "Операция с заготовкой"
                  : prep
                    ? "Заготовка"
                    : dialog.row
                      ? "Изменить запас"
                      : "Добавить запас"
          }
          description={
            !prep
              ? action === "product_save"
                ? "Здесь задаются только название и настройки продукта. Количество, которое есть дома, внесите через «Добавить запас»."
                : action === "place_save"
                  ? "Это место, где лежат продукты. Например, можно отдельно указать полку холодильника или шкаф."
                  : "Один запас — продукт с одним сроком годности в одном месте. Внесите фактическое количество, которое есть дома; стоимость здесь не учитывается."
              : undefined
          }
          fields={fields}
          externalBusy={photoBusy > 0 || productBusy}
          extra={
            prep && action === "prep_save" ? (
              <PhotoField
                label="Фотография заготовки"
                path={photoPath}
                blob={photoBlob ?? undefined}
                disabled={false}
                onBusy={onPhotoBusy}
                onChange={(blob) => {
                  setPhotoBlob(blob);
                  if (!blob) setPhotoPath("");
                }}
              />
            ) : undefined
          }
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
            product_id: "",
            reason: prep
              ? "Использование"
              : dialog.row
                ? "Ручная корректировка"
                : "Ручное добавление",
            archived: "false",
            ...dialog.row,
          }}
          onClose={() => setDialog(null)}
          onSave={async (d, k) => {
            let uploaded = "";
            try {
              if (action === "prep_save" && photoBlob) {
                uploaded = `${family}/${d.id}/${crypto.randomUUID()}.jpg`;
                const { error } = await client()
                  .storage.from("preparation-photos")
                  .upload(uploaded, photoBlob, {
                    contentType: "image/jpeg",
                    upsert: false,
                  });
                check(error);
                d.photo_path = "prep:" + uploaded;
              } else if (action === "prep_save" && photoBlob === null)
                d.photo_path = "";
              await mutate(family, dialog.action, d, k);
            } catch (e) {
              if (uploaded)
                await client()
                  .storage.from("preparation-photos")
                  .remove([uploaded]);
              throw e;
            }
            await reload();
            notify(
              prep
                ? "Операция сохранена. История и остатки обновлены."
                : action === "product_save"
                  ? dialog.row
                    ? "Настройки продукта сохранены."
                    : "Продукт создан. Теперь нажмите «Добавить запас», чтобы указать количество дома."
                  : action === "place_save"
                    ? "Место хранения добавлено."
                    : "Остаток сохранён. Изменение записано в историю.",
            );
          }}
        />
      )}
    </>
  );
}
