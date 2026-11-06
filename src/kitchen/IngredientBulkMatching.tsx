import { useState } from "react";
import { groupIngredientNeeds } from "./ingredient-groups";
import { fmt } from "./model";
import IngredientSourceSelect from "./IngredientSourceSelect";
import {
  bulkIngredientSuggestions,
  conversionNeeded,
  sourceAccepted,
  ingredientRuleKey,
  setIngredientChoice,
  type IngredientChoices,
  type IngredientChoice,
  type InventorySource,
  type MatchedNeed,
} from "./ingredient-matching";
export default function IngredientBulkMatching({
  needs,
  sources,
  choices,
  onApply,
  onClose,
}: {
  needs: MatchedNeed[];
  sources: InventorySource[];
  choices: IngredientChoices;
  onApply: (choices: IngredientChoices) => void;
  onClose: () => void;
}) {
  const items = bulkIngredientSuggestions(needs, sources, choices);
  const [draft, setDraft] = useState<
    Record<string, IngredientChoice | undefined>
  >(() =>
    Object.fromEntries(items.map((i) => [ingredientRuleKey(i.need), i.choice])),
  );
  const picked = items.filter((i) => draft[ingredientRuleKey(i.need)]);
  const invalid = picked.some(({ need }) => {
    const c = draft[ingredientRuleKey(need)]!;
    if (c.sourceId === "none") return false;
    const s = sources.find((s) => s.id === c.sourceId);
    return (
      !s || !sourceAccepted(need, s, c) || conversionNeeded(need, s, c.ratio)
    );
  });
  return (
    <section
      className="panel ingredient-bulk-panel"
      aria-label="Общий подбор продуктов"
    >
      <h3>Подбор для всего списка</h3>
      <p className="muted">
        Совпадения собраны автоматически. Проверьте предложения и примените их
        одной кнопкой. Неоднозначные варианты оставлены для выбора; вес и объём
        порции нужно указать один раз.
      </p>
      {!items.length && <p>Все доступные соответствия уже учтены.</p>}
      {groupIngredientNeeds(items.map((item) => item.need)).map((group) => (
        <article className="ingredient-bulk-row" key={group.key}>
          <div>
            <strong>{group.name}</strong>
            <p className="muted">
              Нужно:{" "}
              {group.needs
                .map((need) => `${fmt(need.quantity)} ${need.unit}`)
                .join(" + ")}
            </p>
            {group.needs.length > 1 && (
              <p className="muted">
                Для сложения разных единиц нужен коэффициент пересчёта, например
                вес упаковки.
              </p>
            )}
          </div>
          <div className="ingredient-matches ingredient-bulk-control">
            {group.needs.map((need) => (
              <div key={ingredientRuleKey(need)}>
                {group.needs.length > 1 && (
                  <p className="muted">Для количества в {need.unit}</p>
                )}
                <IngredientSourceSelect
                  emptyLabel="Оставить без изменений"
                  need={need}
                  sources={sources}
                  choice={draft[ingredientRuleKey(need)]}
                  onChange={(c) =>
                    setDraft((d) => ({ ...d, [ingredientRuleKey(need)]: c }))
                  }
                />
              </div>
            ))}
          </div>
        </article>
      ))}
      {invalid && (
        <p className="error" role="status">
          Уточните пересчёт единиц или уберите неподходящий источник.
        </p>
      )}
      <div className="k-actions">
        <button
          type="button"
          className="primary"
          disabled={!picked.length || invalid}
          onClick={() => {
            let next = choices;
            for (const { need } of picked)
              next = setIngredientChoice(
                next,
                need,
                draft[ingredientRuleKey(need)],
              );
            onApply(next);
          }}
        >
          Применить подбор ({picked.length})
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Закрыть подбор
        </button>
      </div>
    </section>
  );
}
