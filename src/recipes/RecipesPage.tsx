import "./recipes.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Camera,
  Clock,
  FileText,
  Film,
  Grid2X2,
  Heart,
  Link,
  List,
  PenLine,
  Plus,
  Search,
  Users,
} from "lucide-react";
import Modal from "../components/Modal";
import { client, configured, errorText, supabase } from "../supabase";
import { archiveRecipe, loadRecipes, setFavorite } from "./api";
import { categories, selectRecipes, type Recipe } from "./model";
import RecipeForm from "./RecipeForm";
import RecipeView from "./RecipeView";
import { Photo } from "./Photos";
export default function RecipesPage({
  userId,
  familyId,
  canEdit,
  onAuth,
  onFamily,
  notify,
  onCount,
}: {
  userId?: string;
  familyId: string;
  canEdit: boolean;
  onAuth: () => void;
  onFamily: () => void;
  notify: (s: string) => void;
  onCount: (n: number) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [recipes, setRecipes] = useState<Recipe[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("Все рецепты"),
    [sort, setSort] = useState("Дата добавления"),
    [layout, setLayout] = useState("grid"),
    [chooser, setChooser] = useState(false),
    [importMode, setImportMode] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Recipe | null>(null);
  const request = useRef(0),
    alive = useRef(true);
  const reload = useCallback(async () => {
    if (!userId || !familyId) {
      setLoading(false);
      return;
    }
    const seq = ++request.current;
    setError("");
    try {
      const rows = await loadRecipes(familyId, userId);
      if (!alive.current || seq !== request.current) return;
      setRecipes(rows);
      onCount(rows.length);
    } catch (err) {
      if (alive.current && seq === request.current) setError(errorText(err));
    } finally {
      if (alive.current && seq === request.current) setLoading(false);
    }
  }, [familyId, userId, onCount]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!supabase || !userId || !familyId) return;
    const channel = client()
      .channel(`recipes-${familyId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recipes",
          filter: `family_id=eq.${familyId}`,
        },
        () => void reload(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recipe_favorites",
          filter: `user_id=eq.${userId}`,
        },
        () => void reload(),
      )
      .subscribe();
    const refresh = () => void reload();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const t = setInterval(refresh, 60000);
    return () => {
      void client().removeChannel(channel);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      clearInterval(t);
    };
  }, [userId, familyId, reload]);
  const recipe = recipes.find((r) => r.id === params.get("recipe"));
  const editing = params.has("new") || params.get("edit") === "1";
  async function favorite(r: Recipe) {
    setBusy(true);
    try {
      await setFavorite(r.id, !r.data.favorite);
      setRecipes((prev) =>
        prev.map((v) =>
          v.id === r.id
            ? { ...v, data: { ...v.data, favorite: !r.data.favorite } }
            : v,
        ),
      );
    } catch (err) {
      notify(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const heading = (
    <div className="page-heading recipe-page-heading">
      <div>
        <p className="eyebrow">СОХРАНЯЕМ ВКУСНЫЕ МОМЕНТЫ</p>
        <h1>Мои рецепты</h1>
        <p className="muted">Любимые блюда и маленькие семейные секреты.</p>
      </div>
      {userId && familyId && canEdit && (
        <button
          className="primary"
          disabled={Boolean(error && !recipes.length)}
          onClick={() => setChooser(true)}
        >
          <Plus size={18} />
          Добавить рецепт
        </button>
      )}
    </div>
  );
  const loadFailure = (
    <div className="error" role="alert">
      <strong>Не удалось загрузить рецепты.</strong>
      <p>{error}</p>
      <p>
        Если раздел подключается впервые, примените миграцию{" "}
        <code>202610280002_recipes.sql</code> в Supabase.
      </p>
      <button onClick={() => void reload()}>Повторить</button>
    </div>
  );
  if (!configured || !userId || !familyId)
    return (
      <>
        {heading}
        <section className="panel coming-soon">
          <div className="empty-icon">
            <BookOpen size={36} />
          </div>
          <h2>
            {!configured
              ? "Подключите семейную книгу рецептов"
              : !userId
                ? "Ваши рецепты — для вашей семьи"
                : "Выберите семейное пространство"}
          </h2>
          <p>
            {!configured
              ? "Подключите Supabase и примените миграцию этапа 2 по README."
              : !userId
                ? "Войдите, чтобы сохранять рецепты и открывать их на других устройствах."
                : "Создайте семью или примите приглашение в настройках."}
          </p>
          <button className="primary" onClick={!userId ? onAuth : onFamily}>
            {!userId ? "Войти в аккаунт" : "Создать или выбрать семью"}
          </button>
        </section>
      </>
    );
  if (loading)
    return (
      <>
        {heading}
        <div
          className="recipe-skeletons"
          role="status"
          aria-label="Загрузка рецептов"
        >
          {[1, 2, 3].map((n) => (
            <div key={n} className="panel recipe-skeleton" />
          ))}
          <span className="visually-hidden">Загружаем семейные рецепты…</span>
        </div>
      </>
    );
  if (error && !recipes.length)
    return (
      <>
        {heading}
        {loadFailure}
      </>
    );
  if (editing && canEdit && (params.has("new") || recipe))
    return (
      <RecipeForm
        key={`${userId}:${familyId}:${recipe?.id ?? "new"}`}
        recipe={params.has("new") ? undefined : recipe}
        userId={userId}
        familyId={familyId}
        suggestions={[
          ...new Set(
            recipes.flatMap((r) => r.data.ingredients.map((i) => i.name)),
          ),
        ].sort((a, b) => a.localeCompare(b, "ru"))}
        onCancel={() => setParams(recipe ? { recipe: recipe.id } : {})}
        onSaved={(id, warning) => {
          void reload().then(() => {
            setParams({ recipe: id });
            notify(
              warning
                ? "Рецепт сохранён. Старые файлы не удалось очистить; они остаются приватными."
                : "Рецепт сохранён в семейной базе.",
            );
          });
        }}
      />
    );
  const filtered = selectRecipes(recipes, query, category, sort);
  return (
    <>
      {!recipe && heading}
      {error && loadFailure}
      {recipe ? (
        <RecipeView
          key={recipe.id}
          recipe={recipe}
          canEdit={canEdit}
          busy={busy}
          onBack={() => setParams({})}
          onEdit={() => setParams({ recipe: recipe.id, edit: "1" })}
          onDelete={() => setDeleting(recipe)}
          onFavorite={() => void favorite(recipe)}
          notify={notify}
        />
      ) : params.has("recipe") || editing ? (
        <section className="panel coming-soon">
          <h2>Рецепт недоступен</h2>
          <p>
            Возможно, он удалён, принадлежит другой семье или у вас нет права
            редактирования.
          </p>
          <button className="secondary" onClick={() => setParams({})}>
            Ко всем рецептам
          </button>
        </section>
      ) : (
        <>
          <div className="recipe-toolbar">
            <label className="recipe-search">
              <Search size={18} />
              <input
                aria-label="Поиск рецептов"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название или ингредиент…"
              />
            </label>
            <label className="sort-select">
              <span className="visually-hidden">Сортировка рецептов</span>
              <select
                aria-label="Сортировка рецептов"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="Дата добавления">По дате добавления</option>
                <option value="Название">По названию</option>
                <option value="Время приготовления">
                  По времени приготовления
                </option>
                <option value="Популярность">
                  По популярности (просмотры)
                </option>
              </select>
            </label>
            <div className="view-toggle">
              <button
                className={layout === "grid" ? "selected" : ""}
                aria-label="Карточки"
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                <Grid2X2 size={18} />
              </button>
              <button
                className={layout === "list" ? "selected" : ""}
                aria-label="Компактный список"
                aria-pressed={layout === "list"}
                onClick={() => setLayout("list")}
              >
                <List size={18} />
              </button>
            </div>
          </div>
          <div
            className="recipe-filters"
            role="group"
            aria-label="Категории рецептов"
          >
            {["Все рецепты", "Избранное", ...categories].map((c) => (
              <button
                key={c}
                className={category === c ? "active" : ""}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c === "Избранное" && <Heart size={13} />} {c}
              </button>
            ))}
          </div>
          <div className="recipe-results">
            <span>
              {filtered.length} из {recipes.length} рецептов
            </span>
            {!canEdit && (
              <span>
                У вас доступ только для чтения. Избранное можно сохранять.
              </span>
            )}
          </div>
          {filtered.length ? (
            <div
              className={`recipe-grid ${layout === "list" ? "recipe-list" : ""}`}
            >
              {filtered.map((r) => (
                <article className="recipe-card" key={r.id}>
                  <button
                    className="recipe-image-button"
                    aria-label={`Открыть: ${r.data.title}`}
                    onClick={() => setParams({ recipe: r.id })}
                  >
                    <Photo path={r.data.photo} alt={r.data.title} />
                  </button>
                  <button
                    className={
                      r.data.favorite
                        ? "recipe-card-favorite selected"
                        : "recipe-card-favorite"
                    }
                    aria-label={`${r.data.favorite ? "Убрать из избранного" : "В избранное"}: ${r.data.title}`}
                    disabled={busy}
                    onClick={() => void favorite(r)}
                  >
                    <Heart
                      size={18}
                      fill={r.data.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <div className="recipe-card-content">
                    <span className="recipe-category">{r.data.category}</span>
                    <h2>
                      <button onClick={() => setParams({ recipe: r.id })}>
                        {r.data.title}
                      </button>
                    </h2>
                    <div className="recipe-card-meta">
                      <span>
                        <Clock size={14} />
                        {r.data.prep + r.data.cook} мин
                      </span>
                      <span>
                        <Users size={14} />
                        {r.data.servings} порц.
                      </span>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setParams({ recipe: r.id })}
                    >
                      Посмотреть рецепт →
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel recipe-empty">
              <div className="empty-icon">
                <BookOpen size={35} />
              </div>
              <h2>
                {recipes.length
                  ? "Ничего не нашлось"
                  : "Начните вашу семейную книгу"}
              </h2>
              <p>
                {recipes.length
                  ? "Попробуйте другое название, ингредиент или категорию."
                  : "Добавьте первый рецепт — любимое блюдо, которое собирает всех за столом."}
              </p>
              {recipes.length ? (
                <button
                  className="secondary"
                  onClick={() => {
                    setQuery("");
                    setCategory("Все рецепты");
                  }}
                >
                  Сбросить фильтры
                </button>
              ) : (
                canEdit &&
                !error && (
                  <button
                    className="primary"
                    disabled={Boolean(error && !recipes.length)}
                    onClick={() => setChooser(true)}
                  >
                    <Plus size={17} />
                    Добавить первый рецепт
                  </button>
                )
              )}
            </section>
          )}
        </>
      )}
      {chooser && (
        <Modal title="Как добавим рецепт?" onClose={() => setChooser(false)}>
          <p className="muted">Сохраните своё любимое блюдо.</p>
          <div className="import-options">
            {[
              {
                name: "Вручную",
                hint: "Заполнить ингредиенты и шаги",
                icon: PenLine,
              },
              {
                name: "По фото или скриншоту",
                hint: "Распознавание с помощью ИИ",
                icon: Camera,
              },
              {
                name: "По видео",
                hint: "Извлечение рецепта из видео",
                icon: Film,
              },
              {
                name: "По ссылке",
                hint: "Импорт с сайта или из видео",
                icon: Link,
              },
              {
                name: "Из текста",
                hint: "Преобразование текста в рецепт",
                icon: FileText,
              },
            ].map((o) => (
              <button
                key={o.name}
                onClick={() => {
                  setChooser(false);
                  if (o.name === "Вручную") setParams({ new: "1" });
                  else setImportMode(o.name);
                }}
              >
                <o.icon size={21} />
                <span>
                  <strong>{o.name}</strong>
                  <small>{o.hint}</small>
                </span>
                {o.name !== "Вручную" && (
                  <span className="pill quiet">Позже</span>
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {importMode && (
        <Modal title={importMode} onClose={() => setImportMode("")}>
          <p className="notice">
            ИИ-интеграция ещё не подключена. Файлы и ссылки не отправляются на
            распознавание. Сейчас рецепт можно добавить вручную и загрузить
            фотографии блюда и шагов.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setImportMode("")}>
              Закрыть
            </button>
            <button
              className="primary"
              onClick={() => {
                setImportMode("");
                setParams({ new: "1" });
              }}
            >
              Добавить вручную
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить рецепт?"
          onClose={() => !busy && setDeleting(null)}
        >
          <p className="muted">
            «{deleting.data.title}» исчезнет из книги. Он будет сохранён в
            архиве вместе с ингредиентами и фото, чтобы не повредить связанные
            исторические данные.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Оставить
            </button>
            <button
              className="primary danger-fill"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await archiveRecipe(deleting.id, deleting.version);
                  setDeleting(null);
                  setParams({});
                  await reload();
                  notify(
                    "Рецепт удалён из книги. Исторические данные сохранены.",
                  );
                } catch (err) {
                  notify(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Удаляем…" : "Удалить рецепт"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
