import { useState } from "react";

export default function RecipePicker({
  options,
  initial,
}: {
  options: { value: string; label: string }[];
  initial: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initial);
  const normalize = (s: string) =>
    s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  const matches = options.filter((o) =>
    normalize(o.label).includes(normalize(query)),
  );
  return (
    <div className="form-stack">
      <label>
        Поиск рецепта
        <input
          type="search"
          aria-label="Поиск рецепта"
          placeholder="Начните вводить название рецепта"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected("");
          }}
        />
      </label>
      <label>
        Рецепт
        <select
          name="recipe_id"
          aria-label="Рецепт"
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Выберите рецепт</option>
          {matches.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {!matches.length && (
        <p className="muted">
          Рецепты не найдены. Измените или очистите поиск.
        </p>
      )}
    </div>
  );
}
