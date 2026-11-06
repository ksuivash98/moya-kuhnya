import { useState } from "react";
import { fmt, type Need, type State } from "./model";
import {
  ingredientKey,
  inventorySources,
  matchIngredients,
  type IngredientChoices,
  type InventorySource,
} from "./ingredient-matching";

function readChoices(key: string): IngredientChoices {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const choices: IngredientChoices = {};
    for (const [key, v] of Object.entries(value).slice(0, 1000)) {
      const c = v as { sourceId?: unknown; ratio?: unknown };
      if (
        c &&
        typeof c.sourceId === "string" &&
        (c.ratio === undefined ||
          (typeof c.ratio === "number" &&
            Number.isFinite(c.ratio) &&
            c.ratio > 0))
      )
        choices[key] = {
          sourceId: c.sourceId,
          ...(typeof c.ratio === "number" ? { ratio: c.ratio } : {}),
        };
    }
    return choices;
  } catch {
    return {};
  }
}
const sourceLabel = (s: InventorySource) =>
  `${s.name} — ${s.kind === "preparation" ? "заготовка" : "продукт"}, ${fmt(s.quantity)} ${s.unit}`;
export default function IngredientAvailability({
  needs,
  state,
  family,
  userId,
}: {
  needs: Need[];
  state: State;
  family: string;
  userId: string;
}) {
  const storageKey = `kitchen-ingredient-matches:${userId}:${family}`;
  const [stored, setStored] = useState(() => ({
    key: storageKey,
    choices: readChoices(storageKey),
  }));
  const choices =
    stored.key === storageKey ? stored.choices : readChoices(storageKey);
  const sources = inventorySources(state, family);
  const requirements = matchIngredients(needs, sources, choices);
  const save = (next: IngredientChoices) => {
    setStored({ key: storageKey, choices: next });
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Continue in memory when storage is unavailable. */
    }
  };
  if (!requirements.length)
    return (
      <p className="muted">
        Нет незавершённых блюд с количественными ингредиентами.
      </p>
    );
  return (
    <>
      <p className="muted">
        Учитываются непросроченные продукты и заготовки. Похожие названия можно
        подобрать ниже; порции, штуки и упаковки переводятся в г/мл только по
        указанному вами коэффициенту. Один запас распределяется между строками
        без двойного учёта.
      </p>
      {Object.keys(choices).length > 0 && (
        <button type="button" className="text-button" onClick={() => save({})}>
          Сбросить сопоставления ингредиентов
        </button>
      )}
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
            {requirements.map((n) => {
              const key = ingredientKey(n),
                choice = choices[key];
              const selected = sources.find((s) => s.id === choice?.sourceId);
              const similarIds = new Set(n.suggestions.map((s) => s.id));
              const rest = sources.filter((s) => !similarIds.has(s.id));
              return (
                <tr key={key}>
                  <td>
                    <span>{n.name}</span>
                    <details className="ingredient-matches">
                      <summary>
                        {n.suggestions.length
                          ? `Подобрать похожее (${n.suggestions.length})`
                          : "Выбрать запас или заготовку"}
                      </summary>
                      <label>
                        Источник для расчёта
                        <select
                          aria-label={`Источник для ${n.name} (${n.unit})`}
                          value={choice?.sourceId ?? ""}
                          onChange={(e) => {
                            const next = { ...choices };
                            if (e.target.value)
                              next[key] = { sourceId: e.target.value };
                            else delete next[key];
                            save(next);
                          }}
                        >
                          <option value="">Автоматически по названию</option>
                          <option value="none">
                            Не учитывать для этой строки
                          </option>
                          {n.unavailable && (
                            <option value={choice.sourceId}>
                              Выбранный запас недоступен
                            </option>
                          )}
                          {n.suggestions.length > 0 && (
                            <optgroup label="Похожие названия — подтвердите выбор">
                              {n.suggestions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {sourceLabel(s)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {rest.length > 0 && (
                            <optgroup label="Другие запасы и заготовки">
                              {rest.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {sourceLabel(s)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      {selected && selected.unit !== n.unit && (
                        <label>
                          Сколько {n.unit} в 1 {selected.unit}
                          <input
                            type="number"
                            min={0.0001}
                            step="any"
                            aria-label={`Сколько ${n.unit} в 1 ${selected.unit}: ${n.name}`}
                            key={selected.id}
                            defaultValue={choice.ratio ?? ""}
                            onChange={(e) => {
                              const ratio = e.target.valueAsNumber;
                              save({
                                ...choices,
                                [key]: {
                                  sourceId: selected.id,
                                  ...(Number.isFinite(ratio) && ratio > 0
                                    ? { ratio }
                                    : {}),
                                },
                              });
                            }}
                          />
                        </label>
                      )}
                      {n.conversionRequired && (
                        <small>
                          Укажите пересчёт, чтобы учесть этот запас.
                        </small>
                      )}
                      {n.unavailable && (
                        <small>
                          Остаток закончился, продукт удалён или истёк срок
                          годности. Выберите другой источник.
                        </small>
                      )}
                      {!sources.length && (
                        <small>Доступных запасов и заготовок пока нет.</small>
                      )}
                    </details>
                  </td>
                  <td>
                    {fmt(n.quantity)} {n.unit}
                  </td>
                  <td>
                    {fmt(n.available)} {n.unit}
                    {n.matchedSources.length > 0 && (
                      <small className="ingredient-sources">
                        {[
                          ...new Set(
                            n.matchedSources.map(
                              (s) =>
                                `${s.kind === "preparation" ? "Заготовка" : "Продукт"}: ${s.name}`,
                            ),
                          ),
                        ].join("; ")}
                      </small>
                    )}
                  </td>
                  <td>
                    {fmt(n.missing)} {n.unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Подбор сохраняется в этом браузере для вашего аккаунта и семьи и
        применяется к этой таблице. Запасы и заготовки не списываются.
        Автоматический список покупок формируется отдельно в «Покупках».
      </p>
    </>
  );
}
