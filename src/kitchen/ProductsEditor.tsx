import { useRef, useState } from "react";
import { errorText } from "../supabase";
import { fmt, num, str, type Row } from "./model";

export default function ProductsEditor({
  products,
  batches,
  onEdit,
  onArchive,
  onClose,
}: {
  products: Row[];
  batches: Row[];
  onEdit: (product: Row) => void;
  onArchive: (product: Row, archived: boolean, key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const filtered = products
    .filter(
      (p) =>
        Boolean(p.archived) === archived &&
        `${str(p, "name")} ${str(p, "category")}`
          .toLocaleLowerCase("ru")
          .includes(query.trim().toLocaleLowerCase("ru")),
    )
    .sort((a, b) => str(a, "name").localeCompare(str(b, "name"), "ru"));
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  return (
    <section className="panel k-section" aria-label="Редактор продуктов">
      <div className="k-toolbar">
        <h2>Редактор продуктов</h2>
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={onClose}
        >
          Закрыть редактор
        </button>
      </div>
      <p className="muted">
        Здесь все названия продуктов, в том числе без запасов. Удаление убирает
        продукт из выбора, сохраняя историю. Восстановить его можно в списке
        «Удалённые».
      </p>
      <div className="k-toolbar">
        <input
          type="search"
          aria-label="Поиск в редакторе продуктов"
          placeholder="Название или категория"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Список продуктов"
          value={archived ? "archived" : "active"}
          onChange={(e) => {
            setArchived(e.target.value === "archived");
            setPage(0);
            setError("");
          }}
        >
          <option value="active">Активные</option>
          <option value="archived">Удалённые</option>
        </select>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!filtered.length && (
        <p className="muted">
          {query
            ? "По вашему запросу продуктов нет."
            : archived
              ? "Удалённых продуктов нет."
              : "Активных продуктов нет."}
        </p>
      )}
      <div className="k-list">
        {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map((p) => {
          const stock = batches.filter(
            (b) => b.product_id === p.id && num(b, "quantity") > 0,
          );
          return (
            <article className="k-item" key={p.id}>
              <span className="pill">{str(p, "category")}</span>
              <h3>{str(p, "name")}</h3>
              <p>
                {stock.length
                  ? `В наличии: ${stock.map((b) => `${fmt(num(b, "quantity"))} ${str(b, "unit")}`).join("; ")}`
                  : "Запасов нет"}
              </p>
              {!archived && stock.length > 0 && (
                <small>
                  Чтобы удалить продукт, сначала используйте или спишите его
                  запасы.
                </small>
              )}
              <div className="k-actions">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => onEdit(p)}
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  className={archived ? "text-button" : "text-button danger"}
                  disabled={!!busy || (!archived && stock.length > 0)}
                  onClick={async () => {
                    if (
                      !archived &&
                      !confirm(
                        `Удалить «${str(p, "name")}» из списка продуктов? История сохранится. Продукт можно восстановить в редакторе.`,
                      )
                    )
                      return;
                    const token = `${p.id}:${p.version}:${!archived}`;
                    if (!keys.current.has(token))
                      keys.current.set(token, crypto.randomUUID());
                    setBusy(p.id);
                    setError("");
                    try {
                      await onArchive(p, !archived, keys.current.get(token)!);
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {busy === p.id
                    ? "Сохраняем…"
                    : archived
                      ? "Восстановить"
                      : "Удалить"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {filtered.length > 20 && (
        <div className="k-toolbar k-section">
          <button
            type="button"
            className="secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Предыдущие продукты
          </button>
          <span>
            Страница {currentPage + 1} из {Math.ceil(filtered.length / 20)}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={(currentPage + 1) * 20 >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Следующие продукты
          </button>
        </div>
      )}
    </section>
  );
}
