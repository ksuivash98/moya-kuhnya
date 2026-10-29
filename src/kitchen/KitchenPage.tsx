import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { client, configured, errorText } from "../supabase";
import { loadRecipes } from "../recipes/api";
import type { Recipe } from "../recipes/model";
import { loadKitchen } from "./api";
import { type State, names, monthRange, today } from "./model";
import Planning from "./Planning";
import "./kitchen.css";
export type ModuleProps = {
  state: State;
  recipes: Recipe[];
  family: string;
  canEdit: boolean;
  month: string;
  reload: () => Promise<void>;
  notify: (s: string) => void;
};
export default function KitchenPage({
  kind,
  userId,
  familyId,
  canEdit,
  onAuth,
  notify,
}: {
  kind: string;
  userId?: string;
  familyId: string;
  canEdit: boolean;
  onAuth: () => void;
  notify: (s: string) => void;
}) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [state, setState] = useState<State>(),
    [recipes, setRecipes] = useState<Recipe[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const { from, to } = monthRange(month);
  const reload = useCallback(async () => {
    if (!userId || !familyId) {
      setLoading(false);
      return;
    }
    try {
      const [s, r] = await Promise.all([
        loadKitchen(familyId, from, to),
        loadRecipes(familyId, userId),
      ]);
      setState(s);
      setRecipes(r);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [familyId, userId, from, to]);
  useEffect(() => {
    void reload();
    if (!familyId || !userId) return;
    const channel = client()
      .channel(`kitchen-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kitchen_operations",
          filter: `family_id=eq.${familyId}`,
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
  }, [reload, familyId, userId]);
  const heading = (
    <div className="page-heading">
      <div>
        <p className="eyebrow">ВАША СЕМЕЙНАЯ КУХНЯ</p>
        <h1>{names[kind]}</h1>
        <p className="muted">Общие планы и реальные данные вашей семьи.</p>
      </div>
      <label>
        Период
        <input
          aria-label="Месяц"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
    </div>
  );
  if (!configured || !userId || !familyId)
    return (
      <>
        {heading}
        <section className="panel coming-soon">
          <h2>
            {!configured
              ? "Подключите Supabase"
              : !userId
                ? "Войдите в семейное пространство"
                : "Выберите семью"}
          </h2>
          <p>
            Общие данные сохраняются в Supabase. Подключение описано в README.
          </p>
          {!userId ? (
            <button className="primary" onClick={onAuth}>
              Войти
            </button>
          ) : (
            <NavLink to="/settings" className="primary">
              К настройкам семьи
            </NavLink>
          )}
        </section>
      </>
    );
  if (loading && !state)
    return (
      <>
        {heading}
        <div className="panel" role="status">
          Загружаем данные семьи…
        </div>
      </>
    );
  const props: ModuleProps = {
    state: state!,
    recipes,
    family: familyId,
    canEdit,
    month,
    reload,
    notify,
  };
  return (
    <>
      {heading}
      {error && (
        <div className="error" role="alert">
          {error}
          <p>
            Для новых разделов нужно применить миграции из папки
            supabase/migrations в указанном порядке.
          </p>
          <button onClick={() => void reload()}>Повторить</button>
        </div>
      )}
      {state && <Planning kind={kind} {...props} />}
    </>
  );
}
