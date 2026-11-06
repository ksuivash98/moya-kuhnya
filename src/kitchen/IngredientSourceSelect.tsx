import { useEffect, useRef, useState } from "react";
import { fmt } from "./model";
import {
  conversionNeeded,
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
    if (sent.current && Object.is(sent.current.ratio, ratio)) {
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
  const similarIds = new Set(need.suggestions.map((s) => s.id));
  const rest = sources.filter((s) => !similarIds.has(s.id));
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
          {unavailable && (
            <option value={choice!.sourceId}>Выбранный запас недоступен</option>
          )}
          {need.suggestions.length > 0 && (
            <optgroup label="Похожие названия — подтвердите выбор">
              {need.suggestions.map((s) => (
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
      {selected && selected.unit !== need.unit && (
        <label>
          Сколько {need.unit} в 1 {selected.unit}
          <RatioInput
            key={selected.id}
            ratio={choice?.ratio}
            label={`Сколько ${need.unit} в 1 ${selected.unit}: ${need.name}`}
            onChange={(ratio) =>
              onChange({
                sourceId: selected.id,
                ...(ratio === undefined ? {} : { ratio }),
              })
            }
          />
        </label>
      )}
      {conversionRequired && (
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
