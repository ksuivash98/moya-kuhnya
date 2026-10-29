import { useState, useEffect } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import Fields, { type Field } from "./Fields";
import Modal from "../components/Modal";
import {
  type State,
  type Row,
  type Json,
  rows,
  str,
  num,
  meals,
  statuses,
  today,
  monthRange,
  calendarDays,
  addDays,
  snapshot,
  ingredients,
  needs,
  fmt,
} from "./model";
import { mutate } from "./api";
import { errorText } from "../supabase";
export default function Planning({
  kind,
  state,
  recipes,
  family,
  canEdit,
  month,
  reload,
  notify,
}: {
  kind: string;
  state: State;
  recipes: { id: string; data: { title: string } }[];
  family: string;
  canEdit: boolean;
  month: string;
  reload: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [params] = useSearchParams();
  const [mode, setMode] = useState("Месяц"),
    [anchor, setAnchor] = useState(today()),
    [dialog, setDialog] = useState<{
      action: string;
      row?: Row;
      day?: string;
      recipeId?: string;
    } | null>(() =>
      canEdit && params.get("recipe")
        ? {
            action: kind === "menu" ? "menu_save" : "task_save",
            recipeId: params.get("recipe")!,
          }
        : null,
    ),
    [cooking, setCooking] = useState<Row | null>(null),
    [confirmBusy, setConfirmBusy] = useState(false);
  const range = monthRange(month);
  const menu = rows(state, "menu_items").filter(
    (r) => str(r, "month") === range.from,
  );
  const tasks = rows(state, "cooking_tasks").filter((r) =>
    str(r, "date").startsWith(month),
  );
  const active = rows(state, kind === "menu" ? "menu_items" : "cooking_tasks");
  useEffect(
    () => setAnchor(month === today().slice(0, 7) ? today() : month + "-01"),
    [month],
  );
  const options = recipes.map((r) => ({ value: r.id, label: r.data.title }));
  if (dialog?.row && !options.some((o) => o.value === dialog.row?.recipe_id))
    options.push({
      value: str(dialog.row, "recipe_id"),
      label: str(dialog.row, "title") + " (снимок)",
    });
  const places = rows(state, "storage_places").map((r) => ({
    value: r.id,
    label: str(r, "name"),
  }));
  const recipeField: Field = {
    key: "recipe_id",
    label: "Рецепт",
    options,
    required: true,
  };
  const common: Field[] = [
    recipeField,
    { key: "date", label: "Дата", type: "date", required: kind === "cooking" },
    {
      key: "servings",
      label: "Количество порций",
      type: "number",
      min: 0.0001,
      max: 1000,
      required: true,
    },
    { key: "notes", label: "Примечания", type: "textarea" },
  ];
  const fields =
    dialog?.action === "menu_repeat"
      ? [
          {
            key: "count",
            label: "Сколько повторов",
            type: "number",
            min: 1,
            max: 31,
            step: 1,
            required: true,
          },
          {
            key: "interval",
            label: "Через сколько дней",
            type: "number",
            min: 1,
            max: 365,
            step: 1,
            required: true,
          },
        ]
      : dialog?.action === "task_save"
        ? [
            ...common,
            {
              key: "menu_id",
              label: "Связать с меню",
              options: [
                { value: "", label: "Отдельное приготовление" },
                ...menu.map((r) => ({
                  value: r.id,
                  label:
                    str(r, "title") + " · " + (str(r, "date") || "без даты"),
                })),
              ],
            },
            {
              key: "planned_preparations",
              label: "Планируемые заготовки, порц.",
              type: "number",
              min: 0,
            },
            {
              key: "place_id",
              label: "Место хранения",
              options: [{ value: "", label: "Не выбрано" }, ...places],
            },
            {
              key: "status",
              label: "Статус",
              options: ["Запланировано", "В процессе", "Отменено"].map((s) => ({
                value: s,
                label: s,
              })),
            },
          ]
        : [
            ...common,
            {
              key: "month",
              label: "Месяц списка (первое число)",
              type: "date",
              required: true,
            },
            {
              key: "meal",
              label: "Приём пищи",
              options: meals.map((s) => ({ value: s, label: s })),
            },
            {
              key: "planned_count",
              label: "Запланировано приготовлений",
              type: "number",
              step: 1,
              min: 1,
              max: 100,
              required: true,
            },
            {
              key: "status",
              label: "Статус",
              options: statuses.map((s) => ({ value: s, label: s })),
            },
          ];
  async function save(action: string, d: Record<string, unknown>, key: string) {
    const result = await mutate(family, action, d, key);
    await reload();
    notify(
      result.queued
        ? "Изменения сохранены на устройстве и ожидают синхронизации."
        : "Изменения сохранены в семейной базе.",
    );
  }
  function card(r: Row) {
    const completed = [
      "Приготовлено",
      "Сделана заготовка",
      "Приготовлено из заготовки",
    ].includes(str(r, "status"));
    return (
      <article className="k-item" key={r.id}>
        <span className="pill quiet">{str(r, "meal") || str(r, "date")}</span>
        <h3>{str(r, "title")}</h3>
        <p>
          {fmt(num(r, "servings"))} порц. · {str(r, "status")}
          {r.planned_count ? ` · ${num(r, "planned_count")} приготовл.` : ""}
        </p>
        {r.planned_preparations && num(r, "planned_preparations") > 0 ? (
          <small>Заготовки: {fmt(num(r, "planned_preparations"))} порц.</small>
        ) : null}
        <div className="k-actions">
          <NavLink to={`/recipes?recipe=${r.recipe_id}`}>Рецепт ↗</NavLink>
          {canEdit && (
            <>
              <button
                onClick={() =>
                  setDialog({
                    action: kind === "menu" ? "menu_save" : "task_save",
                    row: r,
                  })
                }
                disabled={completed}
              >
                Изменить
              </button>
              {kind === "menu" && (
                <>
                  <button
                    onClick={() => setDialog({ action: "menu_repeat", row: r })}
                  >
                    Повторить
                  </button>
                  <button
                    disabled={completed}
                    onClick={() =>
                      setDialog({
                        action: "task_save",
                        row: {
                          ...r,
                          id: crypto.randomUUID(),
                          version: 0,
                          menu_id: r.id,
                          date: r.date || today(),
                          status: "Запланировано",
                          planned_preparations: 0,
                          checked_steps: [],
                        },
                      })
                    }
                  >
                    В план готовки
                  </button>
                </>
              )}
              <button
                disabled={completed || r.status === "Отменено"}
                onClick={() => setCooking(r)}
              >
                Подтвердить готовку
              </button>
            </>
          )}
        </div>
        {kind === "cooking" && (
          <details>
            <summary>Шаги приготовления</summary>
            {((snapshot(r).steps ?? []) as Record<string, Json>[]).map((s) => (
              <label className="checkbox-label" key={String(s.id)}>
                <input
                  type="checkbox"
                  disabled={!canEdit || completed || confirmBusy}
                  checked={((r.checked_steps ?? []) as string[]).includes(
                    String(s.id),
                  )}
                  onChange={async (e) => {
                    setConfirmBusy(true);
                    try {
                      const checked = new Set(
                        (r.checked_steps ?? []) as string[],
                      );
                      if (e.target.checked) checked.add(String(s.id));
                      else checked.delete(String(s.id));
                      await save(
                        "task_save",
                        { ...r, checked_steps: [...checked] },
                        crypto.randomUUID(),
                      );
                    } catch (err) {
                      notify(errorText(err));
                    } finally {
                      setConfirmBusy(false);
                    }
                  }}
                />
                {String(s.description)}
              </label>
            ))}
          </details>
        )}
      </article>
    );
  }
  let days = calendarDays(month);
  if (mode === "Неделя") {
    const day = (new Date(anchor + "T12:00:00Z").getUTCDay() + 6) % 7;
    days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i - day));
  }
  if (mode === "День") days = [anchor];
  const requirements = needs(
    state,
    kind === "cooking"
      ? tasks
      : [
          ...menu,
          ...rows(state, "cooking_tasks").filter((t) =>
            str(t, "date").startsWith(month),
          ),
        ],
  );
  return (
    <>
      <div className="k-toolbar">
        <div className="recipe-filters">
          {(kind === "menu"
            ? ["Месяц", "Неделя", "День", "Список без дат"]
            : ["Список", "Неделя", "День"]
          ).map((m) => (
            <button
              key={m}
              className={mode === m ? "active" : ""}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {canEdit && (
          <button
            className="primary"
            disabled={!recipes.length}
            onClick={() =>
              setDialog({ action: kind === "menu" ? "menu_save" : "task_save" })
            }
          >
            <Plus size={17} />
            Добавить блюдо
          </button>
        )}
      </div>
      {!recipes.length && (
        <p className="notice">
          Сначала сохраните хотя бы один рецепт в семейной книге.
        </p>
      )}
      {["Неделя", "День"].includes(mode) && (
        <div className="k-date-nav">
          <button
            className="icon-button"
            aria-label="Назад по датам"
            onClick={() =>
              setAnchor(addDays(anchor, mode === "Неделя" ? -7 : -1))
            }
          >
            <ChevronLeft />
          </button>
          <input
            type="date"
            aria-label="Выбранный день"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label="Вперёд по датам"
            onClick={() =>
              setAnchor(addDays(anchor, mode === "Неделя" ? 7 : 1))
            }
          >
            <ChevronRight />
          </button>
        </div>
      )}
      {mode === "Список без дат" ? (
        <div className="k-list">
          {menu.filter((r) => !r.date).map(card)}
          {!menu.some((r) => !r.date) && (
            <div className="panel">
              Добавьте блюда без даты, чтобы распределить их по календарю позже.
              При назначении даты изменяется та же запись.
            </div>
          )}
        </div>
      ) : kind === "cooking" && !["Неделя", "День"].includes(mode) ? (
        <div className="k-list">
          {tasks.map(card)}
          {!tasks.length && (
            <div className="panel">
              План пока пуст. Добавьте блюда на нужные дни.
            </div>
          )}
        </div>
      ) : (
        <div className={`k-calendar ${mode === "День" ? "one-day" : ""}`}>
          {days.map((day) => (
            <section
              key={day}
              className={`k-day ${day.startsWith(month) ? "" : "outside"} ${day === today() ? "is-today" : ""}`}
            >
              <header>
                <strong>
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    weekday: "short",
                    timeZone: "UTC",
                  }).format(new Date(day + "T12:00:00Z"))}
                </strong>
                {canEdit && (
                  <button
                    aria-label={`Добавить блюдо ${day}`}
                    onClick={() =>
                      setDialog({
                        action: kind === "menu" ? "menu_save" : "task_save",
                        day,
                      })
                    }
                  >
                    <Plus size={16} />
                  </button>
                )}
              </header>
              {active.filter((r) => r.date === day).map(card)}
            </section>
          ))}
        </div>
      )}
      <section className="panel k-section">
        <h2>Ингредиенты плана</h2>
        <p className="muted">
          Единицы г/кг и мл/л объединяются; остальные считаются отдельно. «По
          вкусу» уточните при готовке. Просроченные партии не учитываются.
        </p>
        {requirements.length ? (
          <div className="k-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Продукт</th>
                  <th>Нужно</th>
                  <th>Есть дома</th>
                  <th>Докупить</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((n) => (
                  <tr key={n.name + n.unit}>
                    <td>{n.name}</td>
                    <td>
                      {fmt(n.quantity)} {n.unit}
                    </td>
                    <td>
                      {fmt(n.available)} {n.unit}
                    </td>
                    <td>
                      {fmt(n.missing)} {n.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            Нет незавершённых блюд с количественными ингредиентами.
          </p>
        )}
      </section>
      <section className="panel k-section">
        <h2>История приготовления</h2>
        {rows(state, "cooking_events")
          .filter((e) => str(e, "cooked_on").startsWith(month))
          .map((e) => (
            <details key={e.id}>
              <summary>
                {String(snapshot(e).title ?? "Приготовленное блюдо")} ·{" "}
                {str(e, "cooked_on")} · {fmt(num(e, "servings"))} порц.
              </summary>
              <p>
                Съели: {fmt(num(e, "eaten"))}, холодильник:{" "}
                {fmt(num(e, "fridge"))}, морозилка: {fmt(num(e, "frozen"))}.
              </p>
              <p className="muted">
                Снимок рецепта и фактический расход сохранены в истории.
              </p>
              {((e.usage ?? []) as Record<string, Json>[]).map((i, index) => (
                <p key={index}>
                  {str(i, "name")} — {fmt(num(i, "amount"))} {str(i, "unit")}
                </p>
              ))}
            </details>
          ))}
      </section>
      {dialog && (
        <Fields
          offlineAllowed={
            dialog.action === "menu_save" || dialog.action === "task_save"
          }
          title={
            dialog.action === "menu_repeat"
              ? "Повторить блюдо"
              : dialog.action === "task_save"
                ? "План приготовления"
                : "Блюдо в меню"
          }
          fields={fields}
          initial={{
            id: crypto.randomUUID(),
            recipe_id: dialog.recipeId ?? recipes[0]?.id,
            month: range.from,
            date: dialog.day ?? (kind === "cooking" ? today() : ""),
            meal: "Ужин",
            servings: 4,
            planned_count: 1,
            status: "Запланировано",
            planned_preparations: 0,
            checked_steps: [],
            ...dialog.row,
            ...(dialog.action === "task_save" ? { month: undefined } : {}),
            count: 1,
            interval: 7,
          }}
          onClose={() => setDialog(null)}
          onSave={(d, k) => save(dialog.action, d, k)}
        />
      )}
      {cooking && (
        <CookingConfirm
          row={cooking}
          family={family}
          onClose={() => setCooking(null)}
          onSaved={async () => {
            setCooking(null);
            await reload();
            notify(
              "Приготовление подтверждено. Расход и заготовки сохранены один раз.",
            );
          }}
        />
      )}
    </>
  );
}
function CookingConfirm({
  row,
  family,
  onClose,
  onSaved,
}: {
  row: Row;
  family: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [usage, setUsage] = useState(() =>
    ingredients(row).map((i) => ({
      name: str(i, "name"),
      unit: i.unit === "по вкусу" ? "г" : str(i, "unit"),
      amount:
        i.unit === "по вкусу"
          ? "0"
          : String(
              Math.round(
                ((num(i, "amount") * num(row, "servings")) /
                  Number(snapshot(row).servings || 1)) *
                  10000,
              ) / 10000,
            ),
    })),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key] = useState(crypto.randomUUID());
  return (
    <Modal
      title="Что сделано с приготовленным блюдом?"
      onClose={() => !busy && onClose()}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await mutate(
              family,
              "cook_confirm",
              {
                ...Object.fromEntries(f),
                task_id: row.checked_steps !== undefined ? row.id : "",
                menu_id: row.checked_steps === undefined ? row.id : row.menu_id,
                version: row.version,
                usage,
                usage_confirmed: true,
              },
              key,
            );
            await onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="k-fields">
          <label>
            Дата
            <input type="date" name="date" defaultValue={today()} required />
          </label>
          {[
            {
              key: "servings",
              label: "Фактически приготовлено",
              value: num(row, "servings"),
            },
            { key: "eaten", label: "Съели", value: num(row, "servings") },
            { key: "fridge", label: "В холодильник", value: 0 },
            { key: "frozen", label: "В морозилку", value: 0 },
          ].map((f) => (
            <label key={f.key}>
              {f.label}, порц.
              <input
                type="number"
                name={f.key}
                min={0}
                step="0.0001"
                defaultValue={f.value}
                required
              />
            </label>
          ))}
          <label>
            Годен в холодильнике до
            <input type="date" name="fridge_expiry" />
          </label>
          <label>
            Годен в морозилке до
            <input type="date" name="frozen_expiry" />
          </label>
          <p className="muted">
            Сроки не заполняются автоматически: укажите подтверждённые вами
            даты. Сумма распределения должна совпасть с фактическими порциями.
          </p>
          <h3>Проверьте фактический расход</h3>
          <p className="muted">
            Если продукт не использован, явно укажите 0. Количество «по вкусу»
            автоматически не списывается. При нехватке пополните запасы или
            укажите фактический расход.
          </p>
          {usage.map((u, index) => (
            <div key={index} className="k-usage-row">
              <label>
                {u.name}
                <input
                  aria-label={`Расход: ${u.name}`}
                  inputMode="decimal"
                  value={u.amount}
                  onChange={(e) =>
                    setUsage((prev) =>
                      prev.map((x, i) =>
                        i === index ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                  required
                />
              </label>
              <label>
                Единица
                <select
                  value={u.unit}
                  onChange={(e) =>
                    setUsage((prev) =>
                      prev.map((x, i) =>
                        i === index ? { ...x, unit: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {[
                    "г",
                    "кг",
                    "мл",
                    "л",
                    "шт.",
                    "ч. л.",
                    "ст. л.",
                    "стакан",
                    "упаковка",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <label>
            Примечания
            <textarea name="notes" />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" required />
            Подтверждаю расход и распределение порций
          </label>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !navigator.onLine}>
          {busy ? "Подтверждаем…" : "Подтвердить приготовление"}
        </button>
      </form>
    </Modal>
  );
}
