import { lazy, Suspense } from "react";
import { useRecipeCount } from "./recipes/useRecipeCount";
import Modal from "./components/Modal";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import {
  ChefHat,
  House,
  BookOpen,
  CalendarDays,
  CookingPot,
  Snowflake,
  ShoppingBasket,
  Carrot,
  Wallet,
  Sparkles,
  ChartNoAxesCombined,
  Settings,
  Moon,
  Sun,
  ArrowUpRight,
  Plus,
  X,
  LogOut,
  Users,
  Menu,
  Check,
  Mail,
  ShieldCheck,
  WifiOff,
  Download,
  Heart,
  ArrowRight,
} from "lucide-react";
import {
  check,
  client,
  configured,
  errorText,
  roleNames,
  supabase,
} from "./supabase";
const KitchenPage = lazy(() => import("./kitchen/KitchenPage"));
const RecipesPage = lazy(() => import("./recipes/RecipesPage"));
type Membership = {
  family_id: string;
  role: string;
  child_can_edit: boolean;
  families: { name: string };
};
type Member = {
  user_id: string;
  role: string;
  child_can_edit: boolean;
  profiles: { display_name: string };
};
type Activity = { id: string; action: string; created_at: string };
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const sections = [
  {
    path: "/",
    name: "Главная",
    icon: House,
    description: "Всё самое важное — под рукой",
  },
  {
    path: "/recipes",
    name: "Рецепты",
    icon: BookOpen,
    description: "Любимые блюда вашей семьи",
    stage: 2,
  },
  {
    path: "/menu",
    name: "Меню",
    icon: CalendarDays,
    description: "Планы на вкусную неделю",
    stage: 3,
  },
  {
    path: "/cooking",
    name: "План приготовления",
    icon: CookingPot,
    description: "Готовьте спокойно и без спешки",
    stage: 3,
  },
  {
    path: "/preparations",
    name: "Заготовки",
    icon: Snowflake,
    description: "Забота о завтрашнем дне",
    stage: 3,
  },
  {
    path: "/shopping",
    name: "Покупки",
    icon: ShoppingBasket,
    description: "Ничего не забыть в магазине",
    stage: 4,
  },
  {
    path: "/products",
    name: "Продукты",
    icon: Carrot,
    description: "Знайте, что есть дома",
    stage: 4,
  },
  {
    path: "/budget",
    name: "Бюджет",
    icon: Wallet,
    description: "Заботливое планирование расходов",
    stage: 5,
  },
  {
    path: "/assistant",
    name: "ИИ-помощник",
    icon: Sparkles,
    description: "Помощь с ежедневными решениями",
    stage: 6,
  },
  {
    path: "/analytics",
    name: "Аналитика",
    icon: ChartNoAxesCombined,
    description: "Ваша кухня в цифрах",
    stage: 5,
  },
  {
    path: "/settings",
    name: "Настройки",
    icon: Settings,
    description: "Ваше семейное пространство",
  },
];
function Auth({
  recovery,
  onClose,
  notify,
}: {
  recovery: boolean;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [mode, setMode] = useState(recovery ? "password" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const fields = new FormData(e.currentTarget);
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    try {
      const auth = client().auth;
      if (mode === "login") {
        const { error } = await auth.signInWithPassword({ email, password });
        check(error);
        onClose();
      }
      if (mode === "signup") {
        const { data, error } = await auth.signUp({
          email,
          password,
          options: {
            data: { display_name: String(fields.get("name") ?? "") },
            emailRedirectTo: new URL(
              `${import.meta.env.BASE_URL}auth/callback`,
              window.location.origin,
            ).href,
          },
        });
        check(error);
        notify(
          data.session
            ? "Вы зарегистрированы. Создайте семейное пространство."
            : "Подтвердите регистрацию по ссылке в письме.",
        );
        onClose();
      }
      if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo: new URL(
            `${import.meta.env.BASE_URL}auth/callback`,
            window.location.origin,
          ).href,
        });
        check(error);
        notify(
          "Если аккаунт существует, на почту отправлена ссылка для восстановления.",
        );
        onClose();
      }
      if (mode === "password") {
        const { error } = await auth.updateUser({ password });
        check(error);
        notify("Пароль обновлён.");
        onClose();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        {
          login: "Рады вас видеть",
          signup: "Добро пожаловать",
          reset: "Восстановление пароля",
          password: "Новый пароль",
        }[mode] ?? ""
      }
      onClose={onClose}
    >
      <p className="muted">
        Одна кухня. Вся семья. Войдите, чтобы быть вместе.
      </p>
      {!configured ? (
        <div className="notice">
          Supabase ещё не подключён. Добавьте переменные из{" "}
          <code>.env.example</code> и примените миграцию. Подробности — в README
          проекта.
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="form-stack">
            {mode === "signup" && (
              <label>
                Как вас зовут
                <input
                  name="name"
                  maxLength={100}
                  autoComplete="name"
                  required
                />
              </label>
            )}
            {mode !== "password" && (
              <label>
                Электронная почта
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Пароль
                <input
                  type="password"
                  name="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                />
                <small>Не менее 8 символов</small>
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Подождите…"
                : mode === "login"
                  ? "Войти"
                  : mode === "signup"
                    ? "Создать аккаунт"
                    : mode === "reset"
                      ? "Отправить ссылку"
                      : "Сохранить пароль"}
            </button>
          </form>
          {mode !== "password" && (
            <div className="auth-links">
              <button
                onClick={() => {
                  setMode(mode === "signup" ? "login" : "signup");
                  setError("");
                }}
              >
                {mode === "signup"
                  ? "Уже есть аккаунт? Войти"
                  : "Впервые здесь? Зарегистрироваться"}
              </button>
              {mode === "login" && (
                <button onClick={() => setMode("reset")}>Забыли пароль?</button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
export default function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [authOpen, setAuthOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("kitchen-theme") ?? "light";
    } catch {
      return "light";
    }
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [familyModal, setFamilyModal] = useState(false);
  const location = useLocation();
  const sessionIdRef = useRef(session?.user.id);
  sessionIdRef.current = session?.user.id;
  const familyIdRef = useRef(familyId);
  familyIdRef.current = familyId;
  const selected = memberships.find((m) => m.family_id === familyId);
  const [recipeCount, setRecipeCount] = useRecipeCount(
    familyId,
    session?.user.id,
  );
  const notify = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("kitchen-theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    setMobile(false);
  }, [location.pathname]);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false),
      prompt = (e: Event) => {
        e.preventDefault();
        setInstall(e as InstallEvent);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session);
          setAuthReady(true);
          if (error) notify(errorText(error));
        }
      })
      .catch((e) => {
        if (active) {
          setAuthReady(true);
          notify(errorText(e));
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
        setAuthOpen(true);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [notify]);
  const reload = useCallback(async () => {
    if (!session) {
      setMemberships([]);
      setMembers([]);
      setActivity([]);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const { data, error } = await client()
        .from("family_members")
        .select("family_id,role,child_can_edit,families(name)")
        .eq("user_id", session.user.id);
      check(error);
      if (sessionIdRef.current !== session.user.id) return;
      const rows = (data ?? []) as unknown as Membership[];
      setMemberships(rows);
      setFamilyId((prev) =>
        rows.some((r) => r.family_id === prev)
          ? prev
          : (rows[0]?.family_id ?? ""),
      );
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [session?.user.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const loadFamily = useCallback(async () => {
    if (!session || !familyId) {
      setMembers([]);
      setActivity([]);
      return;
    }
    try {
      const [m, a] = await Promise.all([
        client()
          .from("family_members")
          .select("user_id,role,child_can_edit,profiles(display_name)")
          .eq("family_id", familyId)
          .order("joined_at"),
        client()
          .from("family_activity")
          .select("id,action,created_at")
          .eq("family_id", familyId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      check(m.error);
      check(a.error);
      if (
        sessionIdRef.current !== session.user.id ||
        familyIdRef.current !== familyId
      )
        return;
      setMembers((m.data ?? []) as unknown as Member[]);
      setActivity(a.data ?? []);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [session?.user.id, familyId]);
  useEffect(() => {
    setMembers([]);
    setActivity([]);
    void loadFamily();
  }, [loadFamily]);
  useEffect(() => {
    if (!supabase || !session || !familyId) return;
    const channel = supabase
      .channel(`family-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void reload();
          void loadFamily();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "family_activity",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void reload();
          void loadFamily();
        },
      )
      .subscribe();
    const refresh = () => {
      void reload();
      void loadFamily();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const t = setInterval(refresh, 60000);
    return () => {
      void supabase?.removeChannel(channel);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      clearInterval(t);
    };
  }, [session?.user.id, familyId, reload, loadFamily]);
  const active = sections.find((s) => s.path === location.pathname);
  const name = String(session?.user.user_metadata.display_name ?? "")
    .trim()
    .split(" ")[0];
  async function signout() {
    if (
      !window.dispatchEvent(
        new Event("kitchen-before-signout", { cancelable: true }),
      )
    )
      return;
    try {
      const { error } = await client().auth.signOut();
      check(error);
      setFamilyId("");
      notify("Вы вышли из аккаунта.");
    } catch (e) {
      notify(errorText(e));
    }
  }
  function openFamily() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setFamilyModal(true);
  }
  return (
    <div className="app-shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <NavLink to="/" className="brand">
          <span className="brand-icon">
            <ChefHat />
          </span>
          <span>
            Моя кухня<small>С любовью к домашнему</small>
          </span>
        </NavLink>
        <div className="nav-caption">ВАША КУХНЯ</div>
        <nav aria-label="Основная навигация">
          {sections.map((s) => (
            <NavLink
              key={s.path}
              end={s.path === "/"}
              to={s.path}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <s.icon size={19} />
              {s.name}
              {s.path === "/assistant" && <span className="tiny-pill">AI</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="family-badge">
            <span className="avatar">
              <Users size={19} />
            </span>
            <div>
              <strong>{selected?.families.name ?? "Ваша семья"}</strong>
              <small>
                {selected
                  ? roleNames[selected.role]
                  : "Создайте своё пространство"}
              </small>
            </div>
          </div>
          <p>
            Самое вкусное — дома <Heart size={12} />
          </p>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Моя кухня</span>
            <span className="divider">/</span>
            <strong>{active?.name ?? "Страница"}</strong>
          </div>
          <div className="top-actions">
            <span className="today">
              {new Intl.DateTimeFormat("ru-RU", {
                day: "numeric",
                month: "long",
                timeZone: "Asia/Yekaterinburg",
              }).format(new Date())}
            </span>
            <button
              className="icon-button"
              aria-label={
                theme === "light"
                  ? "Включить тёмную тему"
                  : "Включить светлую тему"
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            {session ? (
              <>
                <span className="user-avatar" title={session.user.email}>
                  {(name || session.user.email || "Я")[0].toUpperCase()}
                </span>
                <button
                  className="icon-button"
                  aria-label="Выйти"
                  onClick={() => void signout()}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button
                className="secondary small"
                onClick={() => setAuthOpen(true)}
                disabled={!authReady}
              >
                {authReady ? "Войти" : "Загрузка…"}
              </button>
            )}
          </div>
        </header>
        {!online && (
          <div className="status-bar">
            <WifiOff size={17} />
            Нет подключения. Доступна оболочка приложения; данные семьи требуют
            интернета.
          </div>
        )}
        {!configured && (
          <div className="setup-banner">
            <ShieldCheck size={18} />
            <span>
              Пространство почти готово. Подключите Supabase, чтобы войти и
              создать семью.
            </span>
            <NavLink to="/settings">
              Как подключить <ArrowUpRight size={15} />
            </NavLink>
          </div>
        )}
        <main id="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">МАЛЕНЬКИЕ ЗАБОТЫ, БОЛЬШЕ ТЕПЛА</p>
                      <h1>
                        {name ? `Привет, ${name}!` : "Добро пожаловать домой"}
                        <span className="greeting-leaf">✳</span>
                      </h1>
                      <p className="muted">
                        Пусть на кухне будет порядок, а за столом — вся семья.
                      </p>
                    </div>
                    <span className="pill">
                      <span className="dot" />
                      Ваш уютный помощник
                    </span>
                  </div>
                  <section className="hero">
                    <div className="hero-content">
                      <span className="hero-label">
                        <ChefHat size={16} /> ГОТОВИМ С ЛЮБОВЬЮ
                      </span>
                      <h2>
                        Меньше забот.
                        <br />
                        Больше времени
                        <br />
                        <em>для близких.</em>
                      </h2>
                      <p>
                        Рецепты, планы и домашние запасы —
                        <br className="desktop" /> в одном семейном
                        пространстве.
                      </p>
                      <button
                        className="primary"
                        onClick={() =>
                          selected ? navigate("/settings") : openFamily()
                        }
                      >
                        {selected ? "Моя семья" : "Создать семейную кухню"}
                        <ArrowRight size={17} />
                      </button>
                    </div>
                    <KitchenArt />
                  </section>
                  <div className="section-heading">
                    <h2>Ваша кухня сегодня</h2>
                    <span className="muted text-sm">
                      Всё начинается с маленького шага
                    </span>
                  </div>
                  <div className="stats-grid">
                    <Stat
                      icon={<Users />}
                      label="Участники семьи"
                      value={selected ? String(members.length) : "—"}
                      detail={
                        selected
                          ? selected.families.name
                          : "Создайте семейное пространство"
                      }
                      color="sage"
                    />
                    <Stat
                      icon={<BookOpen />}
                      label="Семейные рецепты"
                      value={recipeCount === null ? "—" : String(recipeCount)}
                      detail={
                        recipeCount === null
                          ? "Подключите семейную книгу"
                          : "Сохранено для всей семьи"
                      }
                      color="rose"
                    />
                    <Stat
                      icon={<CalendarDays />}
                      label="Меню на сегодня"
                      value="—"
                      detail="Планирование — на этапе 3"
                      color="sand"
                    />
                    <Stat
                      icon={<Wallet />}
                      label="Бюджет месяца"
                      value="—"
                      detail="Учёт расходов — на этапе 5"
                      color="lavender"
                    />
                  </div>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>С чего начнём?</h2>
                        <span className="subtle-icon">
                          <Sparkles size={18} />
                        </span>
                      </div>
                      <p className="muted">Обустройте кухню для всей семьи.</p>
                      <div className="checklist">
                        <button
                          onClick={() =>
                            session
                              ? notify("Вы уже вошли в аккаунт.")
                              : setAuthOpen(true)
                          }
                        >
                          <span className={session ? "check done" : "check"}>
                            {session ? <Check size={16} /> : <Mail size={16} />}
                          </span>
                          <span>
                            <strong>Ваш личный аккаунт</strong>
                            <small>
                              {session
                                ? "Аккаунт подключён"
                                : "Войдите или зарегистрируйтесь"}
                            </small>
                          </span>
                          <ArrowUpRight size={18} />
                        </button>
                        <button
                          onClick={() =>
                            selected ? navigate("/settings") : openFamily()
                          }
                        >
                          <span className={selected ? "check done" : "check"}>
                            {selected ? (
                              <Check size={16} />
                            ) : (
                              <Users size={16} />
                            )}
                          </span>
                          <span>
                            <strong>Семейное пространство</strong>
                            <small>
                              {selected
                                ? selected.families.name
                                : "Создайте семью или примите приглашение"}
                            </small>
                          </span>
                          <ArrowUpRight size={18} />
                        </button>
                        <NavLink to="/settings">
                          <span className="check">
                            <Settings size={16} />
                          </span>
                          <span>
                            <strong>Всё по-вашему</strong>
                            <small>
                              Тема, участники и установка приложения
                            </small>
                          </span>
                          <ArrowUpRight size={18} />
                        </NavLink>
                      </div>
                    </section>
                    <section className="panel activity">
                      <div className="section-heading">
                        <h2>Семейная лента</h2>
                        <span className="pill quiet">Ваш круг</span>
                      </div>
                      {activity.length ? (
                        <ul className="activity-list">
                          {activity.map((a) => (
                            <li key={a.id}>
                              <span className="activity-dot" />
                              <div>
                                <strong>{a.action}</strong>
                                <small>
                                  {new Intl.DateTimeFormat("ru-RU", {
                                    day: "numeric",
                                    month: "long",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: "Asia/Yekaterinburg",
                                  }).format(new Date(a.created_at))}
                                </small>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mini-empty">
                          <div className="empty-icon">
                            <CookingPot size={30} />
                          </div>
                          <h3>Здесь рождаются семейные традиции</h3>
                          <p>
                            Создайте пространство и пригласите близких.
                            <br />
                            Ваша общая история начнётся здесь.
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="bottom-note">
                    <Heart size={16} />
                    <span>
                      Кухня — это не только еда. Это место, где мы вместе.
                    </span>
                  </div>
                </>
              }
            />
            <Route
              path="/recipes"
              element={
                <Suspense
                  fallback={
                    <div className="panel" role="status">
                      Загружаем книгу рецептов…
                    </div>
                  }
                >
                  {" "}
                  <RecipesPage
                    key={`${session?.user.id ?? "guest"}:${familyId}`}
                    userId={session?.user.id}
                    familyId={familyId}
                    canEdit={Boolean(
                      selected &&
                        (selected.role !== "child" || selected.child_can_edit),
                    )}
                    onAuth={() => setAuthOpen(true)}
                    onFamily={openFamily}
                    notify={notify}
                    onCount={setRecipeCount}
                  />{" "}
                </Suspense>
              }
            />
            {[
              "menu",
              "cooking",
              "products",
              "preparations",
              "shopping",
              "budget",
            ].map((kind) => (
              <Route
                key={kind}
                path={`/${kind}`}
                element={
                  <Suspense fallback={<p role="status">Загружаем раздел…</p>}>
                    <KitchenPage
                      key={`${kind}:${session?.user.id}:${familyId}`}
                      kind={kind}
                      userId={session?.user.id}
                      familyId={familyId}
                      canEdit={Boolean(
                        selected &&
                          (selected.role !== "child" ||
                            selected.child_can_edit),
                      )}
                      onAuth={() => setAuthOpen(true)}
                      notify={notify}
                    />
                  </Suspense>
                }
              />
            ))}
            <Route
              path="/settings"
              element={
                <SettingsPage
                  session={session}
                  selected={selected}
                  memberships={memberships}
                  members={members}
                  familyId={familyId}
                  setFamilyId={setFamilyId}
                  reload={async () => {
                    await reload();
                    await loadFamily();
                  }}
                  openFamily={openFamily}
                  notify={notify}
                  theme={theme}
                  setTheme={setTheme}
                  install={install}
                  setInstall={setInstall}
                />
              }
            />
            <Route
              path="/auth/callback"
              element={
                <div className="panel">
                  <h1>Вход в аккаунт</h1>
                  <p>
                    {session
                      ? "Вы вошли в аккаунт. Можете перейти к семейному пространству."
                      : "Обрабатываем ссылку. Если сессия не появилась, запросите новое письмо."}
                  </p>
                  <button className="primary" onClick={() => setAuthOpen(true)}>
                    Открыть вход
                  </button>
                  <NavLink className="secondary" to="/settings">
                    К настройкам
                  </NavLink>
                </div>
              }
            />
            {sections
              .filter(
                (s) =>
                  s.stage &&
                  ![
                    "/recipes",
                    "/menu",
                    "/cooking",
                    "/products",
                    "/preparations",
                  ].includes(s.path),
              )
              .map((s) => (
                <Route
                  key={s.path}
                  path={s.path}
                  element={
                    <>
                      <div className="page-heading">
                        <div>
                          <p className="eyebrow">ВАША СЕМЕЙНАЯ КУХНЯ</p>
                          <h1>{s.name}</h1>
                          <p className="muted">{s.description}</p>
                        </div>
                      </div>
                      <section className="panel coming-soon">
                        <div className="empty-icon">
                          <s.icon size={40} />
                        </div>
                        <span className="pill quiet">Этап {s.stage}</span>
                        <h2>Здесь скоро станет уютно</h2>
                        <p>
                          Раздел «{s.name}» в разработке.
                          <br />
                          Сейчас мы обустраиваем основу вашей семейной кухни.
                        </p>
                        <NavLink className="primary" to="/">
                          На главную
                          <ArrowRight size={17} />
                        </NavLink>
                      </section>
                    </>
                  }
                />
              ))}
            <Route
              path="*"
              element={
                <section className="panel coming-soon">
                  <h1>Страница не найдена</h1>
                  <NavLink className="primary" to="/">
                    На главную
                  </NavLink>
                </section>
              }
            />
          </Routes>
          {loading && (
            <p role="status" className="muted">
              Загружаем семейное пространство…
            </p>
          )}
          {loadError && (
            <div className="error" role="alert">
              {loadError}{" "}
              <button
                onClick={() => {
                  void reload();
                  void loadFamily();
                }}
              >
                Повторить
              </button>
            </div>
          )}
        </main>
        <footer>
          <span>Моя кухня</span>
          <span>Больше тепла в каждом дне</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {sections
          .filter((s) =>
            ["/", "/recipes", "/menu", "/shopping", "/settings"].includes(
              s.path,
            ),
          )
          .map((s) => (
            <NavLink key={s.path} end={s.path === "/"} to={s.path}>
              <s.icon size={21} />
              <span>{s.name}</span>
            </NavLink>
          ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {authOpen && (
        <Auth
          recovery={recovery}
          onClose={() => {
            setAuthOpen(false);
            setRecovery(false);
          }}
          notify={notify}
        />
      )}
      {familyModal && (
        <FamilyModal
          onClose={() => setFamilyModal(false)}
          onDone={async (id) => {
            await reload();
            setFamilyId(id);
            await loadFamily();
            notify("Семейное пространство подключено.");
            setFamilyModal(false);
          }}
        />
      )}
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  detail,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span className={`stat-icon ${color}`}>{icon}</span>
        <span className="muted">
          <ArrowUpRight size={14} />
        </span>
      </div>
      <div className="stat-label">{label}</div>
      <strong className="stat-value">{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function FamilyModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const [join, setJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = String(
        new FormData(e.currentTarget).get("value") ?? "",
      ).trim();
      const { data, error } = await client().rpc(
        join ? "join_family" : "create_family",
        join ? { p_token: value } : { p_name: value },
      );
      check(error);
      await onDone(data as string);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={join ? "Присоединиться к семье" : "Ваша семейная кухня"}
      onClose={onClose}
    >
      <p className="muted">
        {join
          ? "Попросите владельца семьи поделиться одноразовым кодом."
          : "Создайте общее пространство для самых близких."}
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          {join ? "Код приглашения" : "Название семьи"}
          <input
            key={String(join)}
            name="value"
            required
            maxLength={join ? 64 : 80}
            minLength={join ? 64 : 1}
            placeholder={
              join ? "Вставьте код из приглашения" : "Например, Семья Ивановых"
            }
            autoComplete="off"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Подождите…"
            : join
              ? "Присоединиться"
              : "Создать пространство"}
        </button>
      </form>
      <button
        className="text-button"
        onClick={() => {
          setJoin(!join);
          setError("");
        }}
      >
        {join ? "Создать новую семью" : "У меня есть приглашение"}
      </button>
    </Modal>
  );
}
function SettingsPage({
  session,
  selected,
  memberships,
  members,
  familyId,
  setFamilyId,
  reload,
  openFamily,
  notify,
  theme,
  setTheme,
  install,
  setInstall,
}: {
  session: Session | null;
  selected: Membership | undefined;
  memberships: Membership[];
  members: Member[];
  familyId: string;
  setFamilyId: (id: string) => void;
  reload: () => Promise<void>;
  openFamily: () => void;
  notify: (s: string) => void;
  theme: string;
  setTheme: (s: string) => void;
  install: InstallEvent | null;
  setInstall: (e: InstallEvent | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState("adult");
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    let live = true;
    setInvite("");
    setDisplayName(String(session?.user.user_metadata.display_name ?? ""));
    if (session)
      void client()
        .from("profiles")
        .select("display_name")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (live && data?.display_name) setDisplayName(data.display_name);
        });
    return () => {
      live = false;
    };
  }, [session?.user.id, familyId]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function manage(
    m: Member,
    role: string,
    canEdit: boolean,
    remove = false,
  ) {
    if (
      remove &&
      !confirm("Удалить участника из семьи? Его личный аккаунт сохранится.")
    )
      return;
    await action(async () => {
      const { error } = await client().rpc("manage_member", {
        p_family: familyId,
        p_user: m.user_id,
        p_role: role,
        p_can_edit: canEdit,
        p_remove: remove,
      });
      check(error);
      await reload();
      notify("Права участника обновлены.");
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">СДЕЛАЙТЕ КУХНЮ СВОЕЙ</p>
          <h1>Настройки</h1>
          <p className="muted">Всё для вашего семейного пространства.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>Семья и участники</h2>
          {session ? (
            <>
              <p className="muted">Вы вошли как {session.user.email}</p>
              {memberships.length > 0 && (
                <label>
                  Семейное пространство
                  <select
                    value={familyId}
                    onChange={(e) => setFamilyId(e.target.value)}
                  >
                    {memberships.map((m) => (
                      <option key={m.family_id} value={m.family_id}>
                        {m.families.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="secondary" onClick={openFamily}>
                <Plus size={17} />
                Создать семью / принять приглашение
              </button>
              {selected && (
                <>
                  <ul className="members-list">
                    {members.map((m) => (
                      <li key={m.user_id}>
                        <span className="avatar">
                          <Users size={18} />
                        </span>
                        <div className="member-info">
                          <strong>
                            {m.profiles.display_name ||
                              (m.user_id === session.user.id
                                ? "Вы"
                                : "Участник семьи")}
                            {m.user_id === session.user.id &&
                            m.profiles.display_name
                              ? " (вы)"
                              : ""}
                          </strong>
                          {selected.role === "owner" && m.role !== "owner" ? (
                            <>
                              <select
                                aria-label={`Роль: ${m.profiles.display_name || "участник"}`}
                                disabled={busy}
                                value={m.role}
                                onChange={(e) =>
                                  void manage(m, e.target.value, false)
                                }
                              >
                                <option value="adult">Взрослый</option>
                                <option value="child">Ребёнок</option>
                              </select>
                              {m.role === "child" && (
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={m.child_can_edit}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void manage(m, "child", e.target.checked)
                                    }
                                  />
                                  Разрешить редактирование
                                </label>
                              )}
                            </>
                          ) : (
                            <small>
                              {roleNames[m.role]}
                              {m.role === "child"
                                ? m.child_can_edit
                                  ? " · Редактирование разрешено"
                                  : " · Только просмотр"
                                : ""}
                            </small>
                          )}
                        </div>
                        {selected.role === "owner" && m.role !== "owner" && (
                          <button
                            className="icon-button danger"
                            aria-label={`Удалить участника ${m.profiles.display_name}`}
                            disabled={busy}
                            onClick={() => void manage(m, m.role, false, true)}
                          >
                            <X size={18} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {selected.role === "owner" && (
                    <div className="invite-box">
                      <h3>Пригласить близких</h3>
                      <p className="muted text-sm">
                        Код действует 7 дней и используется один раз. Передайте
                        его лично.
                      </p>
                      <label>
                        Роль приглашённого
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value)}
                        >
                          <option value="adult">Взрослый</option>
                          <option value="child">
                            Ребёнок (только просмотр)
                          </option>
                        </select>
                      </label>
                      <button
                        className="primary"
                        disabled={busy || !navigator.onLine}
                        onClick={() =>
                          void action(async () => {
                            const { data, error } = await client().rpc(
                              "create_invitation",
                              { p_family: familyId, p_role: inviteRole },
                            );
                            check(error);
                            setInvite(String(data));
                          })
                        }
                      >
                        Создать код приглашения
                      </button>
                      {invite && (
                        <>
                          <label>
                            Одноразовый код
                            <input
                              readOnly
                              value={invite}
                              onFocus={(e) => e.target.select()}
                            />
                          </label>
                          <button
                            className="secondary"
                            onClick={() =>
                              void action(async () => {
                                await navigator.clipboard.writeText(invite);
                                notify("Код скопирован.");
                              })
                            }
                          >
                            Скопировать
                          </button>
                        </>
                      )}
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Отозвать все неиспользованные приглашения?",
                            )
                          )
                            void action(async () => {
                              const { error } = await client().rpc(
                                "revoke_invitations",
                                { p_family: familyId },
                              );
                              check(error);
                              setInvite("");
                              notify("Приглашения отозваны.");
                            });
                        }}
                      >
                        Отозвать приглашения
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className="muted">
                Войдите, чтобы создать семейное пространство и пригласить
                близких.
              </p>
              <button className="primary" onClick={openFamily}>
                Войти и начать
              </button>
            </>
          )}
        </section>
        <div className="settings-right">
          <section className="panel">
            <h2>Внешний вид</h2>
            <p className="muted">Как вам уютнее?</p>
            <div className="theme-picker">
              <button
                className={theme === "light" ? "selected" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun />
                Светлая{theme === "light" && <Check size={16} />}
              </button>
              <button
                className={theme === "dark" ? "selected" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon />
                Тёмная{theme === "dark" && <Check size={16} />}
              </button>
            </div>
          </section>
          {session && (
            <section className="panel">
              <h2>Ваш профиль</h2>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    const { error } = await client().auth.updateUser({
                      data: { display_name: displayName.trim() },
                    });
                    check(error);
                    const { error: profileError } = await client()
                      .from("profiles")
                      .update({ display_name: displayName.trim() })
                      .eq("id", session.user.id);
                    check(profileError);
                    await reload();
                    notify("Имя сохранено.");
                  });
                }}
              >
                <label>
                  Имя
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Сохранить имя
                </button>
              </form>
            </section>
          )}
          <section className="panel">
            <h2>Всегда под рукой</h2>
            <p className="muted">
              Установите «Мою кухню» на главный экран телефона.
            </p>
            {install ? (
              <button
                className="primary"
                onClick={() =>
                  void action(async () => {
                    await install.prompt();
                    const choice = await install.userChoice;
                    if (choice.outcome === "accepted") {
                      setInstall(null);
                      notify("Приложение установлено.");
                    }
                  })
                }
              >
                <Download size={17} />
                Установить приложение
              </button>
            ) : (
              <p className="help-text">
                На iPhone: Safari → «Поделиться» → «На экран Домой». На Android
                и компьютере: меню браузера → «Установить приложение». Нужен
                HTTPS.
              </p>
            )}
            <p className="help-text">
              Офлайн доступна оболочка. Чтение и изменение семейных данных пока
              требуют подключения; полная офлайн-синхронизация запланирована на
              этап 7.
            </p>
          </section>
        </div>
      </div>
      {!configured && (
        <section className="panel setup-instructions">
          <h2>Подключение Supabase</h2>
          <ol>
            <li>
              Создайте проект Supabase и примените файл{" "}
              <code>supabase/migrations/202610280001_foundation.sql</code> через
              SQL Editor.
            </li>
            <li>
              Скопируйте <code>.env.example</code> в <code>.env.local</code>,
              укажите URL проекта и публичный anon/publishable key.
            </li>
            <li>
              В Auth → URL Configuration добавьте адрес сайта и{" "}
              <code>/auth/callback</code> в Redirect URLs. Перезапустите
              dev-сервер.
            </li>
          </ol>
          <p className="help-text">
            Ключ service_role и секреты ИИ не должны попадать в клиентский код.
            Подробная инструкция — в README.
          </p>
        </section>
      )}
    </>
  );
}
function KitchenArt() {
  return (
    <svg
      className="kitchen-art"
      viewBox="0 0 520 350"
      role="img"
      aria-label="Уютная кухня: домашняя еда, посуда и веточка зелени"
    >
      <defs>
        <linearGradient id="plate" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#fffdf8" />
          <stop offset="1" stopColor="#e4e3d6" />
        </linearGradient>
        <filter id="shadow">
          <feDropShadow
            dx="0"
            dy="8"
            stdDeviation="10"
            floodColor="#49563e"
            floodOpacity=".12"
          />
        </filter>
      </defs>
      <ellipse cx="270" cy="300" rx="217" ry="22" fill="#99a17a" opacity=".1" />
      <path
        d="M26 251c100-27 117 73 234 29s152-16 240 2"
        fill="none"
        stroke="#e0d9b9"
        strokeWidth="2"
      />
      <g transform="rotate(-13 270 220)" filter="url(#shadow)">
        <rect x="130" y="99" width="280" height="210" rx="32" fill="#b3a483" />
        <path
          d="M158 117h220M158 127h220M158 285h220"
          stroke="#c9bb9d"
          strokeWidth="2"
        />
        <circle cx="269" cy="199" r="105" fill="url(#plate)" />
        <circle
          cx="269"
          cy="199"
          r="83"
          fill="none"
          stroke="#d8d8c8"
          strokeWidth="2"
        />
        <circle cx="269" cy="199" r="69" fill="#e9cf95" />
        <path
          d="M220 165q20-23 35 4t38-7t30 22t-12 38t-41 7t-42-5t-8-59"
          fill="#d9a653"
        />
        <g fill="#bd6a42">
          <ellipse cx="244" cy="173" rx="13" ry="8" />
          <ellipse cx="299" cy="201" rx="15" ry="9" />
          <ellipse cx="257" cy="229" rx="15" ry="9" />
        </g>
        <g fill="#748454">
          <ellipse
            cx="272"
            cy="171"
            rx="7"
            ry="14"
            transform="rotate(30 272 171)"
          />
          <ellipse
            cx="230"
            cy="206"
            rx="8"
            ry="14"
            transform="rotate(-40 230 206)"
          />
          <ellipse
            cx="280"
            cy="218"
            rx="7"
            ry="12"
            transform="rotate(65 280 218)"
          />
        </g>
        <g fill="#eee0b8">
          <circle cx="255" cy="193" r="5" />
          <circle cx="287" cy="185" r="4" />
          <circle cx="246" cy="216" r="4" />
          <circle cx="295" cy="230" r="4" />
        </g>
      </g>
      <g
        transform="rotate(14 422 236)"
        stroke="#8a795b"
        strokeWidth="5"
        strokeLinecap="round"
      >
        <path
          d="M425 147v142M413 147v36q12 19 24 0v-36M425 147v35M460 149v140M460 149q-17 23-12 65h12"
          fill="none"
        />
      </g>
      <g transform="rotate(-10 90 240)">
        <rect x="51" y="200" width="77" height="84" rx="9" fill="#d6bdb0" />
        <path
          d="M128 214q35-5 27 25t-27 15"
          fill="none"
          stroke="#d6bdb0"
          strokeWidth="11"
        />
        <ellipse cx="90" cy="202" rx="37" ry="10" fill="#f3e4d4" />
        <ellipse cx="90" cy="202" rx="28" ry="6" fill="#8e7962" />
        <path
          d="M79 182q-15-17 0-31M98 180q-14-17 0-31"
          fill="none"
          stroke="#fffdf5"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
      <g stroke="#778654" strokeWidth="3" fill="#859364">
        <path d="M383 110q7-58 67-84" fill="none" />
        <ellipse
          cx="401"
          cy="76"
          rx="11"
          ry="23"
          transform="rotate(-35 401 76)"
        />
        <ellipse
          cx="423"
          cy="57"
          rx="10"
          ry="23"
          transform="rotate(50 423 57)"
        />
        <ellipse
          cx="445"
          cy="32"
          rx="9"
          ry="20"
          transform="rotate(38 445 32)"
        />
        <ellipse
          cx="386"
          cy="96"
          rx="10"
          ry="19"
          transform="rotate(-35 386 96)"
        />
      </g>
      <g fill="#a4ae8e" opacity=".6">
        <circle cx="107" cy="90" r="4" />
        <circle cx="148" cy="45" r="3" />
        <path
          d="M68 130h12m-6-6v12M351 37h12m-6-6v12"
          stroke="#a4ae8e"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}
