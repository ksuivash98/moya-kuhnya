import { useEffect, useRef, useState } from "react";
import { fmt } from "./model";
import { isSpoon } from "./unit-conversion";
import {
  conversionNeeded,
  automaticSourceConversion,
  sourceMatchesIngredient,
  sourceAccepted,
  type IngredientChoice,
  type InventorySource,
  type MatchedNeed,
} from "./ingredient-matching";
export const sourceLabel = (s: InventorySource) =>
  `${s.name} — ${s.kind === "preparation" ? "заготовка" : "продукт"}, ${fmt(s.quantity)} ${s.unit}`;
function RatioInput({
  ratio,
  label,
  onChange,
}: {
  ratio?: number;
  label: string;
  onChange: (ratio?: number) => void;
}) {
  const [text, setText] = useState(ratio === undefined ? "" : String(ratio));
  const sent = useRef<{ ratio: number | undefined } | undefined>(undefined);
  useEffect(() => {
    if (
      sent.current &&
      (sent.current.ratio === undefined || Object.is(sent.current.ratio, ratio))
    ) {
      sent.current = undefined;
      return;
    }
    sent.current = undefined;
    setText(ratio === undefined ? "" : String(ratio));
  }, [ratio]);
  return (
    <input
      type="number"
      min={0.0001}
      step="any"
      aria-label={label}
      value={text}
      onBlur={() => {
        if (!Number.isFinite(Number(text)) || Number(text) <= 0)
          setText(ratio === undefined ? "" : String(ratio));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        const next = Number.isFinite(n) && n > 0 ? n : undefined;
        sent.current = { ratio: next };
        onChange(next);
      }}
    />
  );
}
export default function IngredientSourceSelect({
  need,
  sources,
  choice,
  onChange,
  emptyLabel = "Автоматически по названию",
}: {
  need: MatchedNeed;
  sources: InventorySource[];
  choice?: IngredientChoice;
  onChange: (choice?: IngredientChoice) => void;
  emptyLabel?: string;
}) {
  const selected = sources.find((s) => s.id === choice?.sourceId);
  const effective =
    selected ??
    (!choice && need.matchedSources.length === 1
      ? need.matchedSources[0]
      : undefined);
  const automatic = effective
    ? automaticSourceConversion(need, effective)
    : undefined;
  const resolved = choice?.ratio ?? automatic?.ratio;
  const reverse =
    !!effective && isSpoon(need.unit) && ["г", "мл"].includes(effective.unit);
  const inputUnit = reverse ? effective!.unit : need.unit;
  const sourceUnit = reverse ? need.unit : effective?.unit;
  const eligible = sources.filter(
    (source) =>
      source.kind === "preparation" || sourceMatchesIngredient(need, source),
  );
  const differentPreparation =
    selected?.kind === "preparation" &&
    !sourceMatchesIngredient(need, selected);
  const mismatch = !!selected && !sourceAccepted(need, selected, choice);
  const similarIds = new Set(
    need.suggestions
      .filter((s) => sourceMatchesIngredient(need, s))
      .map((s) => s.id),
  );
  const rest = eligible.filter((s) => !similarIds.has(s.id));
  const unavailable = !!choice && choice.sourceId !== "none" && !selected;
  const conversionRequired =
    !!selected && conversionNeeded(need, selected, choice?.ratio);
  return (
    <>
      <label>
        Источник для расчёта
        <select
          aria-label={`Источник для ${need.name} (${need.unit})`}
          value={choice?.sourceId ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value
                ? choice?.sourceId === e.target.value
                  ? choice
                  : { sourceId: e.target.value }
                : undefined,
            )
          }
        >
          <option value="">{emptyLabel}</option>
          <option value="none">Не учитывать для этой строки</option>
          {mismatch && selected?.kind !== "preparation" && (
            <option value={choice!.sourceId} disabled>
              Не подходит: {selected!.name}
            </option>
          )}
          {unavailable && (
            <option value={choice!.sourceId}>Выбранный запас недоступен</option>
          )}
          {need.suggestions.length > 0 && (
            <optgroup label="Похожие названия — подтвердите выбор">
              {need.suggestions
                .filter((s) => sourceMatchesIngredient(need, s))
                .map((s) => (
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
                  {s.kind === "preparation" && !sourceMatchesIngredient(need, s)
                    ? choice?.sourceId === s.id &&
                      choice.allowPreparationSubstitution
                      ? " — замена подтверждена"
                      : " — подтвердите замену"
                    : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {differentPreparation && (
        <>
          <small>
            Название и состав отличаются. Подтвердите, что используете эту
            заготовку как замену ингредиента. Если блюдо уже готово целиком,
            используйте его в разделе «Заготовки».
          </small>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={choice?.allowPreparationSubstitution === true}
              onChange={(e) =>
                onChange({
                  ...choice,
                  sourceId: selected!.id,
                  allowPreparationSubstitution: e.target.checked,
                })
              }
            />
            Подтверждаю замену ингредиента «{need.name}» этой заготовкой
          </label>
        </>
      )}
      {effective && !mismatch && effective.unit !== need.unit && (
        <label>
          Сколько {inputUnit} в 1 {sourceUnit}
          <RatioInput
            key={effective.id}
            ratio={
              resolved === undefined
                ? undefined
                : reverse
                  ? 1 / resolved
                  : resolved
            }
            label={`Сколько ${inputUnit} в 1 ${sourceUnit}: ${need.name}`}
            onChange={(ratio) =>
              onChange({
                sourceId: effective.id,
                ...(choice?.sourceId === effective.id &&
                choice.allowPreparationSubstitution
                  ? { allowPreparationSubstitution: true }
                  : {}),
                ...(ratio === undefined
                  ? {}
                  : { ratio: reverse ? 1 / ratio : ratio }),
              })
            }
          />
        </label>
      )}
      {effective &&
        !mismatch &&
        effective.unit !== need.unit &&
        choice?.ratio === undefined &&
        automatic && (
          <small className="automatic-conversion-note">
            Автопересчёт: {automatic.description}.{" "}
            {automatic.approximate
              ? isSpoon(need.unit) || isSpoon(effective.unit)
                ? "Ориентировочное значение для мерной ложки без горки; можно поправить вручную."
                : "Ориентировочная плотность продукта; можно поправить вручную."
              : "Можно поправить вручную."}
          </small>
        )}
      {mismatch && !differentPreparation && (
        <small>
          Название или состояние продукта не соответствует ингредиенту. Выберите
          подходящий источник.
        </small>
      )}
      {!mismatch && conversionRequired && (
        <small>Укажите пересчёт, чтобы учесть этот запас.</small>
      )}
      {unavailable && (
        <small>
          Остаток закончился, продукт удалён или истёк срок годности. Выберите
          другой источник.
        </small>
      )}
      {!sources.length && (
        <small>Доступных запасов и заготовок пока нет.</small>
      )}
    </>
  );
}
