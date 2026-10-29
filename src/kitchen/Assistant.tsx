import { useEffect, useState } from "react";
import { client, check, errorText } from "../supabase";
import type { ModuleProps } from "./KitchenPage";
import {
  type Row,
  type Json,
  needs,
  norm,
  fmt,
  rows,
  monthRange,
} from "./model";
type Proposal = {
  recipe_id: string;
  date: string;
  meal: string;
  servings: number;
  reason: string;
};
export default function Assistant({
  state,
  recipes,
  family,
  month,
  reload,
  notify,
}: ModuleProps) {
  const [prefs, setPrefs] = useState({
      likes: "",
      excluded: "",
      restrictions: "",
      servings: "4",
      notes: "",
      ai_consent: false,
    }),
    [mode, setMode] = useState("recommend"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      id: string;
      summary: string;
      items: Proposal[];
    } | null>(null),
    [include, setInclude] = useState(false),
    [count, setCount] = useState(20);
  useEffect(() => {
    let alive = true;
    void client()
      .auth.getUser()
      .then(async ({ data }) => {
        if (!data.user) return;
        const p = await client()
          .from("family_preferences")
          .select("preferences")
          .eq("family_id", family)
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (alive && p.data) {
          const value = p.data.preferences;
          setPrefs((prev) => ({ ...prev, ...value }));
        }
      });
    return () => {
      alive = false;
    };
  }, [family]);
  const candidates = recipes
    .filter(
      (r) =>
        !r.data.ingredients.some((i) =>
          prefs.excluded.split(/[,\n]/).map(norm).includes(norm(i.name)),
        ),
    )
    .map((r) => {
      const plan = {
        id: r.id,
        family_id: family,
        version: 1,
        servings: Number(prefs.servings) || r.data.servings,
        status: "Запланировано",
        recipe_snapshot: {
          servings: r.data.servings,
          ingredients: r.data.ingredients.map((i) => ({
            ...i,
            amount: i.unit === "по вкусу" ? null : Number(i.amount),
          })),
        },
      } as Row;
      const n = needs(state, [plan]);
      return {
        recipe: r,
        need: n,
        missing: n.filter((i) => i.missing > 0).length,
      };
    });
  return (
    <>
      <section className="panel">
        <h2>Что приготовить по учтённым запасам</h2>
        <p className="muted">
          Это расчёт по вашим данным, не ответ ИИ. «По вкусу» и несовместимые
          единицы проверьте самостоятельно.
        </p>
        {[0, 1, 2].map((group) => (
          <div key={group} className="k-section">
            <h3>
              {group === 0
                ? "Можно приготовить по учтённым количествам"
                : group === 1
                  ? "Не хватает 1–2 ингредиентов"
                  : "Нужны дополнительные покупки"}
            </h3>
            {candidates
              .filter((c) =>
                group === 0
                  ? c.missing === 0
                  : group === 1
                    ? c.missing > 0 && c.missing <= 2
                    : c.missing > 2,
              )
              .slice(0, 20)
              .map((c) => (
                <div className="k-item" key={c.recipe.id}>
                  <strong>{c.recipe.data.title}</strong>
                  <p>
                    {c.missing
                      ? c.need
                          .filter((i) => i.missing > 0)
                          .map((i) => `${i.name}: ${fmt(i.missing)} ${i.unit}`)
                          .join("; ")
                      : "Учтённых продуктов достаточно; используйте ближайшие по сроку партии."}
                  </p>
                </div>
              ))}
          </div>
        ))}
      </section>
      <section className="panel k-section">
        <h2>Мои семейные предпочтения</h2>
        <p className="muted">
          Каждый участник заполняет собственные предпочтения. Ограничения не
          отправляются внешнему ИИ без отдельного согласия автора.
        </p>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { data } = await client().auth.getUser();
              if (!data.user) throw new Error("Войдите в аккаунт");
              const { error } = await client()
                .from("family_preferences")
                .upsert({
                  family_id: family,
                  user_id: data.user.id,
                  preferences: prefs,
                  updated_at: new Date().toISOString(),
                });
              check(error);
              notify("Предпочтения и согласие сохранены.");
            } catch (err) {
              notify(errorText(err));
            }
          }}
        >
          {[
            { key: "likes", label: "Любимые блюда" },
            {
              key: "excluded",
              label: "Нелюбимые / исключённые ингредиенты (через запятую)",
            },
            {
              key: "restrictions",
              label: "Указанные вами ограничения питания",
            },
            { key: "servings", label: "Размер порций / количество человек" },
            { key: "notes", label: "Дополнительные пожелания" },
          ].map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                value={prefs[f.key as keyof typeof prefs] as string}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, [f.key]: e.target.value }))
                }
                maxLength={2000}
              />
            </label>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={prefs.ai_consent}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, ai_consent: e.target.checked }))
              }
            />
            Разрешаю отправлять мои предпочтения, включая ограничения, внешнему
            ИИ для семейных рекомендаций. Согласие можно отозвать здесь.
          </label>
          <button className="secondary">Сохранить предпочтения</button>
        </form>
      </section>
      <section className="panel k-section">
        <h2>Серверный ИИ-помощник</h2>
        <p className="notice">
          Требуется отдельное развёртывание Edge Function и разрешение владельца
          на платного провайдера. Ключ хранится только на сервере. До настройки
          ИИ-запросы не выполняются; импорт рецептов из файлов и ссылок пока не
          реализован.
        </p>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              !confirm(
                "Отправить данные рецептов и запасов внешнему ИИ? Запрос может быть платным. Данные меню не изменятся без отдельного подтверждения.",
              )
            )
              return;
            setBusy(true);
            setError("");
            setResult(null);
            const input = {
              mode,
              ...monthRange(month),
              people: Number(prefs.servings),
              excluded: include && prefs.ai_consent ? prefs.excluded : "",
              include_preferences: include,
              count,
            };
            try {
              const response = await client().functions.invoke(
                "kitchen-assistant",
                { body: { id: crypto.randomUUID(), family_id: family, input } },
              );
              if (response.error) {
                let message =
                  "ИИ не подключён или запрос недоступен. Проверьте развёртывание Edge Function и серверные настройки.";
                const context = response.error.context as Response | undefined;
                if (context?.json) {
                  try {
                    const body = await context.json();
                    message = body.error ?? message;
                  } catch {}
                }
                throw new Error(message);
              }
              setResult({ id: response.data.id, ...response.data.result });
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Задача
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="recommend">Что приготовить?</option>
              <option value="menu">Предложить меню на месяц</option>
              <option value="preparations">Планирование заготовок</option>
              <option value="savings">Как сэкономить</option>
            </select>
          </label>
          <label>
            Количество предложений
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.valueAsNumber)}
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />
            Использовать предпочтения только тех участников, которые сохранили
            согласие
          </label>
          <button className="primary" disabled={busy || !navigator.onLine}>
            {busy ? "Запрашиваем…" : "Запросить ИИ (внешний сервис)"}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {result && (
          <div className="k-section">
            <h3>Предварительный просмотр</h3>
            <p>{result.summary}</p>
            {result.items.map((p, i) => (
              <div key={i} className="k-item">
                <strong>
                  {recipes.find((r) => r.id === p.recipe_id)?.data.title ??
                    "Рекомендация"}
                </strong>
                <p>{p.reason}</p>
                {mode === "menu" && (
                  <p>
                    {p.meal} · {p.servings} порц.
                  </p>
                )}
                {mode === "menu" && (
                  <div className="form-grid">
                    <label>
                      Дата
                      <input
                        type="date"
                        value={p.date}
                        onChange={(e) =>
                          setResult(
                            (r) =>
                              r && {
                                ...r,
                                items: r.items.map((x, n) =>
                                  n === i ? { ...x, date: e.target.value } : x,
                                ),
                              },
                          )
                        }
                      />
                    </label>
                    <label>
                      Рецепт
                      <select
                        value={p.recipe_id}
                        onChange={(e) =>
                          setResult(
                            (r) =>
                              r && {
                                ...r,
                                items: r.items.map((x, n) =>
                                  n === i
                                    ? { ...x, recipe_id: e.target.value }
                                    : x,
                                ),
                              },
                          )
                        }
                      >
                        {recipes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.data.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <button
                  className="text-button danger"
                  onClick={() =>
                    setResult(
                      (r) =>
                        r && { ...r, items: r.items.filter((_, n) => n !== i) },
                    )
                  }
                >
                  Удалить предложение
                </button>
              </div>
            ))}
            {mode === "menu" && (
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Добавить показанные блюда в семейное меню?"))
                    return;
                  setBusy(true);
                  try {
                    const { error } = await client().rpc("apply_ai_menu", {
                      p_family: family,
                      p_id: result.id,
                      p_key: crypto.randomUUID(),
                      p_items: result.items,
                    });
                    check(error);
                    await reload();
                    setResult(null);
                    notify("Предложенное меню принято и сохранено атомарно.");
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Подтвердить добавление в меню
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
