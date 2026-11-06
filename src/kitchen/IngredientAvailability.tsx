import { useState } from "react";
import {
  combineIngredientNeeds,
  groupIngredientNeeds,
} from "./ingredient-groups";
import {
  ingredientChoicesKey,
  readIngredientChoices,
} from "./ingredient-preferences";
import IngredientSourceSelect from "./IngredientSourceSelect";
import IngredientBulkMatching from "./IngredientBulkMatching";
import { fmt, type Need, type State } from "./model";
import {
  ingredientKey,
  automaticSourceConversion,
  ingredientChoice,
  ingredientRuleKey,
  setIngredientChoice,
  inventorySources,
  matchIngredients,
  type IngredientChoices,
} from "./ingredient-matching";

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
  const [bulkOpen, setBulkOpen] = useState(false);
  const storageKey = ingredientChoicesKey(userId, family);
  const [stored, setStored] = useState(() => ({
    key: storageKey,
    choices: readIngredientChoices(userId, family),
  }));
  const choices =
    stored.key === storageKey
      ? stored.choices
      : readIngredientChoices(userId, family);
  const sources = inventorySources(state, family);
  const requirements = matchIngredients(
    combineIngredientNeeds(needs),
    sources,
    choices,
  );
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
        Учитываются непросроченные продукты и заготовки. Подберите весь список
        одной кнопкой; одинаковые и повторные названия используют сохранённое
        соответствие. Один запас не засчитывается дважды.
      </p>
      <div className="k-toolbar">
        <button
          type="button"
          className="secondary"
          onClick={() => setBulkOpen((open) => !open)}
          aria-expanded={bulkOpen}
        >
          Подобрать все продукты
        </button>
        <span className="muted">
          Сопоставлено:{" "}
          {requirements.filter((n) => n.matchedSources.length > 0).length} из{" "}
          {requirements.length}
        </span>
        {Object.keys(choices).length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => save({})}
          >
            Сбросить сопоставления ингредиентов
          </button>
        )}
      </div>
      {bulkOpen && (
        <IngredientBulkMatching
          key={needs.map(ingredientRuleKey).join(";")}
          needs={requirements}
          sources={sources}
          choices={choices}
          onClose={() => setBulkOpen(false)}
          onApply={(next) => {
            save(next);
            setBulkOpen(false);
          }}
        />
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
          {groupIngredientNeeds(requirements).map((group) => (
            <tbody key={group.key} aria-label={`Ингредиент: ${group.name}`}>
              {group.needs.map((n, index) => {
                const key = ingredientKey(n);
                const choice = ingredientChoice(choices, n);
                const automaticNotes = n.matchedSources.flatMap((source) => {
                  if (
                    source.unit === n.unit ||
                    (choice?.sourceId === source.id &&
                      choice.ratio !== undefined)
                  )
                    return [];
                  const converted = automaticSourceConversion(n, source);
                  return converted?.approximate ? [converted.description] : [];
                });
                return (
                  <tr key={key}>
                    {index === 0 && (
                      <td rowSpan={group.needs.length}>
                        <span className="ingredient-product-name">
                          {group.name}
                        </span>
                        <details className="ingredient-matches">
                          <summary>Изменить источник</summary>
                          {group.needs.map((need) => (
                            <div key={ingredientKey(need)}>
                              {group.needs.length > 1 && (
                                <p className="muted">
                                  Для количества в {need.unit}
                                </p>
                              )}
                              <IngredientSourceSelect
                                need={need}
                                sources={sources}
                                choice={ingredientChoice(choices, need)}
                                onChange={(c) =>
                                  save(setIngredientChoice(choices, need, c))
                                }
                              />
                            </div>
                          ))}
                        </details>
                        {group.needs.length > 1 && (
                          <small className="ingredient-sources">
                            Для сложения разных единиц нужен коэффициент
                            пересчёта, например вес упаковки.
                          </small>
                        )}
                      </td>
                    )}
                    <td>
                      {fmt(n.quantity)} {n.unit}
                    </td>
                    <td>
                      {fmt(n.available)} {n.unit}
                      {automaticNotes.length > 0 && (
                        <small className="ingredient-sources">
                          Автопересчёт:{" "}
                          {[...new Set(automaticNotes)].join("; ")}. Значения
                          ориентировочные.
                        </small>
                      )}
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
          ))}
        </table>
      </div>
      <p className="muted">
        Подбор сохраняется в этом браузере для вашего аккаунта и семьи и
        применяется к этой таблице и пересчёту в «Покупках». Запасы и заготовки
        не списываются. Для обновления сохранённого списка покупок нажмите
        «Рассчитать недостающие продукты».
      </p>
    </>
  );
}
