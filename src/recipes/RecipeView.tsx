import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChefHat,
  Clock,
  Heart,
  Pencil,
  ShoppingBasket,
  Snowflake,
  Trash2,
  Users,
} from "lucide-react";
import { quantity, type Recipe } from "./model";
import { Photo } from "./Photos";
import { viewRecipe } from "./api";
import { errorText } from "../supabase";
export default function RecipeView({
  recipe,
  canEdit,
  busy,
  onBack,
  onEdit,
  onDelete,
  onFavorite,
  notify,
}: {
  recipe: Recipe;
  canEdit: boolean;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  notify: (s: string) => void;
}) {
  const navigate = useNavigate();
  const d = recipe.data,
    [servings, setServings] = useState(String(d.servings));
  const counted = useRef("");
  useEffect(() => {
    if (counted.current === recipe.id) return;
    counted.current = recipe.id;
    void viewRecipe(recipe.id).catch((e) => notify(errorText(e)));
  }, [recipe.id, notify]);
  const n = Number(servings),
    valid = Number.isInteger(n) && n >= 1 && n <= 1000;
  return (
    <article className="recipe-detail">
      <button className="text-button back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        Ко всем рецептам
      </button>
      <div className="detail-title">
        <div>
          <span className="pill quiet">{d.category}</span>
          <h1>{d.title}</h1>
        </div>
        <div className="detail-actions">
          <button
            className={
              d.favorite
                ? "icon-button favorite selected"
                : "icon-button favorite"
            }
            aria-label={d.favorite ? "Убрать из избранного" : "В избранное"}
            disabled={busy}
            onClick={onFavorite}
          >
            <Heart fill={d.favorite ? "currentColor" : "none"} />
          </button>
          {canEdit && (
            <>
              <button className="secondary" onClick={onEdit}>
                <Pencil size={16} />
                Редактировать
              </button>
              <button
                className="icon-button danger"
                aria-label="Удалить рецепт"
                onClick={onDelete}
              >
                <Trash2 size={19} />
              </button>
            </>
          )}
        </div>
      </div>
      <Photo path={d.photo} alt={d.title} className="detail-cover" />
      <div className="detail-meta">
        <span>
          <Clock size={17} />
          {d.prep + d.cook} мин
        </span>
        <span>
          <Users size={17} />
          {d.servings} порц.
        </span>
        <span>
          <ChefHat size={17} />
          {d.difficulty}
        </span>
        {d.freeze && (
          <span>
            <Snowflake size={17} />
            Можно замораживать
          </span>
        )}
      </div>
      <p className="recipe-description">{d.description}</p>
      <div className="recipe-detail-columns">
        <section className="panel ingredients-view">
          <div className="section-heading">
            <h2>Ингредиенты</h2>
            <label className="servings-picker">
              Порции
              <input
                aria-label="Пересчитать на порции"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
              />
            </label>
          </div>
          {!valid && (
            <p className="error">
              Укажите целое число от 1 до 1000. Пока показаны исходные
              количества.
            </p>
          )}
          <p className="muted text-sm">
            Исходный рецепт — на {d.servings} порц. Пересчёт не изменяет
            сохранённые количества.
          </p>
          <ul className="ingredient-list">
            {d.ingredients.map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{i.name}</strong>
                  {i.note && <small>{i.note}</small>}
                </div>
                <span>
                  {i.unit === "по вкусу"
                    ? "по вкусу"
                    : `${quantity(i.amount, i.unit, d.servings, valid ? n : d.servings)} ${i.unit}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel preparation-view">
          <h2>Готовим вместе</h2>
          <p className="muted">
            Подготовка: {d.prep} мин · Приготовление: {d.cook} мин
          </p>
          <ol className="recipe-steps">
            {d.steps.map((s, i) => (
              <li key={s.id}>
                <span className="step-number">{i + 1}</span>
                <div>
                  <p>{s.text}</p>
                  {s.photo && <Photo path={s.photo} alt={`Шаг ${i + 1}`} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="recipe-detail-columns">
        <section className="panel storage-view">
          <h2>Хранение</h2>
          <dl>
            <dt>Можно замораживать</dt>
            <dd>{d.freeze ? "Да" : "Нет"}</dd>
            <dt>Срок хранения</dt>
            <dd>{d.shelfLife || "Не указан"}</dd>
            <dt>Условия</dt>
            <dd>{d.storage || "Не указаны"}</dd>
            <dt>После разморозки</dt>
            <dd>{d.thaw || "Не указано"}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>На заметку</h2>
          <p className="recipe-notes">{d.notes || "Примечаний пока нет."}</p>
          {d.source && (
            <a
              className="text-button source-link"
              href={d.source}
              target="_blank"
              rel="noreferrer noopener"
            >
              Открыть источник ↗
            </a>
          )}
          <div className="related-actions">
            {[
              { label: "Добавить в меню", section: "Меню", icon: CalendarDays },
              {
                label: "Добавить в план приготовления",
                section: "План приготовления",
                icon: BookOpen,
              },
              {
                label: "Добавить ингредиенты в покупки",
                section: "Покупки",
                icon: ShoppingBasket,
              },
              {
                label: "Создать заготовку",
                section: "Заготовки",
                icon: Snowflake,
              },
            ].map((a) => (
              <button
                key={a.label}
                className="secondary"
                onClick={() =>
                  a.section === "Меню"
                    ? navigate(`/menu?recipe=${recipe.id}`)
                    : a.section === "План приготовления"
                      ? navigate(`/cooking?recipe=${recipe.id}`)
                      : notify(
                          `Раздел «${a.section}» ещё не реализован. Запись не создана.`,
                        )
                }
              >
                <a.icon size={17} />
                {a.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </article>
  );
}
