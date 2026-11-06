import { useState } from "react";
import {
  ingredientChoicesKey,
  readIngredientChoices,
} from "./ingredient-preferences";
import IngredientSourceSelect from "./IngredientSourceSelect";
import IngredientBulkMatching from "./IngredientBulkMatching";
import { fmt, type Need, type State } from "./model";
import {
  ingredientKey,
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
          <tbody>
            {requirements.map((n) => {
              const key = ingredientKey(n),
                choice = ingredientChoice(choices, n);
              return (
                <tr key={key}>
                  <td>
                    <span>{n.name}</span>
                    <details className="ingredient-matches">
                      <summary>Изменить источник</summary>
                      <IngredientSourceSelect
                        need={n}
                        sources={sources}
                        choice={choice}
                        onChange={(c) =>
                          save(setIngredientChoice(choices, n, c))
                        }
                      />
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
        применяется к этой таблице и пересчёту в «Покупках». Запасы и заготовки
        не списываются. Для обновления сохранённого списка покупок нажмите
        «Рассчитать недостающие продукты».
      </p>
    </>
  );
}
