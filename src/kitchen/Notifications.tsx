import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import Modal from "../components/Modal";
import { client, check, errorText } from "../supabase";
type Notice = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
export default function Notifications({
  family,
  userId,
}: {
  family: string;
  userId: string;
}) {
  const [open, setOpen] = useState(false),
    [notices, setNotices] = useState<Notice[]>([]),
    [enabled, setEnabled] = useState(true),
    [browser, setBrowser] = useState(false),
    [days, setDays] = useState(3),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const { error } = await client().rpc("refresh_kitchen_notifications", {
        p_family: family,
      });
      check(error);
      const [n, p] = await Promise.all([
        client()
          .from("notifications")
          .select("id,title,body,created_at,read_at")
          .eq("family_id", family)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),
        client()
          .from("notification_preferences")
          .select("*")
          .eq("family_id", family)
          .eq("user_id", userId)
          .single(),
      ]);
      check(n.error);
      check(p.error);
      setNotices(n.data ?? []);
      setEnabled(p.data.enabled);
      setBrowser(p.data.browser_enabled);
      setDays(p.data.expiry_days);
      setError("");
      if (
        p.data.enabled &&
        p.data.browser_enabled &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const claim = await client().rpc("claim_kitchen_notifications", {
          p_family: family,
        });
        if (!claim.error)
          for (const n of claim.data ?? [])
            try {
              new Notification(n.title, { body: n.body, tag: n.id });
            } catch {
              /* In-app сообщение остаётся доступным. */
            }
      }
    } catch (e) {
      setError(errorText(e));
    }
  }, [family, userId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <>
      <button
        className="icon-button"
        aria-label={`Уведомления${notices.some((n) => !n.read_at) ? ", есть непрочитанные" : ""}`}
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        <Bell size={19} />
      </button>
      {open && (
        <Modal title="Уведомления" onClose={() => setOpen(false)}>
          <p className="muted">
            Напоминания обновляются, пока приложение открыто. Фоновые
            push-уведомления при закрытом приложении пока не подключены.
          </p>
          {error && (
            <p className="error">
              {error}
              <br />
              Для включения примените миграцию уведомлений.
            </p>
          )}
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const { error } = await client()
                  .from("notification_preferences")
                  .upsert({
                    user_id: userId,
                    family_id: family,
                    enabled,
                    browser_enabled: browser,
                    expiry_days: days,
                  });
                check(error);
                await refresh();
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Напоминания включены
            </label>
            <label>
              Предупреждать за дней
              <input
                type="number"
                min={0}
                max={30}
                value={days}
                onChange={(e) => setDays(e.target.valueAsNumber)}
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={browser}
                onChange={(e) => setBrowser(e.target.checked)}
              />
              Показывать системные уведомления при открытом приложении
            </label>
            <button
              className="secondary"
              type="button"
              disabled={typeof Notification === "undefined"}
              onClick={async () => {
                if (typeof Notification !== "undefined") {
                  const permission = await Notification.requestPermission();
                  if (permission !== "granted")
                    setError(
                      "Браузер не разрешил системные уведомления. Сообщения внутри приложения доступны.",
                    );
                }
              }}
            >
              Разрешить уведомления в браузере
            </button>
            <button className="primary">Сохранить настройки</button>
          </form>
          {enabled &&
            notices.map((n) => (
              <article className="k-item" key={n.id}>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                {!n.read_at && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      const { error } = await client()
                        .from("notifications")
                        .update({ read_at: new Date().toISOString() })
                        .eq("id", n.id)
                        .eq("user_id", userId);
                      if (error) setError(errorText(error));
                      else await refresh();
                    }}
                  >
                    Прочитано
                  </button>
                )}
              </article>
            ))}
        </Modal>
      )}
    </>
  );
}
