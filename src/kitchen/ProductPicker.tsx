import { useRef, useState } from "react";
import { errorText } from "../supabase";
import { productCategories, stockUnits } from "./model";

type Option = { value: string; label: string };
export default function ProductPicker({
  options,
  initial,
  onCreate,
  onBusy,
  label = "Какой продукт",
  createdHint = "Продукт сохранится в справочнике. Запас добавится после нажатия «Сохранить» внизу окна.",
}: {
  options: Option[];
  initial: string;
  onCreate: (
    data: { id: string; name: string; category: string; unit: string },
    key: string,
  ) => Promise<void>;
  onBusy: (busy: boolean) => void;
  label?: string;
  createdHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initial);
  const [created, setCreated] = useState<Option[]>([]);
  const [draft, setDraft] = useState<{
    name: string;
    category: string;
    unit: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ id: string; key: string } | null>(null);
  const all = [
    ...options,
    ...created.filter((c) => !options.some((o) => o.value === c.value)),
  ];
  const matches = all.filter(
    (o) =>
      o.label
        .toLocaleLowerCase("ru")
        .includes(query.trim().toLocaleLowerCase("ru")) || o.value === selected,
  );
  return (
    <div className="form-stack">
      <label>
        Поиск продукта
        <input
          type="search"
          aria-label="Поиск продукта"
          placeholder="Начните вводить название"
          value={query}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
          }}
        />
      </label>
      <label>
        {label}
        <select
          name="product_id"
          aria-label={label}
          value={selected}
          required
          disabled={busy}
          onChange={(e) => {
            setSelected(e.target.value);
            setDraft(null);
            setError("");
          }}
        >
          <option value="">Выберите продукт</option>
          {matches.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {!matches.length && (
        <p className="muted">Продукт не найден. Можно создать новый ниже.</p>
      )}
      {!draft ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setSelected("");
            setDraft({ name: query.trim(), category: "Другое", unit: "г" });
            attempt.current = {
              id: crypto.randomUUID(),
              key: crypto.randomUUID(),
            };
            setError("");
          }}
        >
          Создать новый продукт
        </button>
      ) : (
        <section className="panel form-stack" aria-label="Новый продукт">
          <h3>Новый продукт</h3>
          <label>
            Название нового продукта
            <input
              aria-label="Название нового продукта"
              value={draft.name}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Категория нового продукта
            <select
              aria-label="Категория нового продукта"
              value={draft.category}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {productCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Единица учёта нового продукта
            <select
              aria-label="Единица учёта нового продукта"
              value={draft.unit}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            >
              {stockUnits
                .filter((u) => !["кг", "л"].includes(u))
                .map((u) => (
                  <option key={u}>{u}</option>
                ))}
            </select>
          </label>
          <p className="muted">{createdHint}</p>
          <div className="k-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || !draft.name.trim() || !navigator.onLine}
              onClick={async () => {
                const { id, key } = attempt.current!;
                setBusy(true);
                onBusy(true);
                setError("");
                try {
                  const name = draft.name.trim();
                  await onCreate({ id, ...draft, name }, key);
                  setCreated((prev) => [
                    ...prev.filter((p) => p.value !== id),
                    { value: id, label: name },
                  ]);
                  setSelected(id);
                  setQuery("");
                  setDraft(null);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                  onBusy(false);
                }
              }}
            >
              {busy ? "Создаём…" : "Создать и выбрать"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              Отмена создания
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
