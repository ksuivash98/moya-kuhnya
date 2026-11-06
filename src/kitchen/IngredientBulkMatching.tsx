import { useState } from "react";
import { fmt } from "./model";
import IngredientSourceSelect from "./IngredientSourceSelect";
import {
  bulkIngredientSuggestions,
  conversionNeeded,
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
    return !s || conversionNeeded(need, s, c.ratio);
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
      {items.map(({ need }) => (
        <article className="ingredient-bulk-row" key={ingredientRuleKey(need)}>
          <div>
            <strong>{need.name}</strong>
            <p className="muted">
              Нужно: {fmt(need.quantity)} {need.unit}
            </p>
          </div>
          <div className="ingredient-matches ingredient-bulk-control">
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
