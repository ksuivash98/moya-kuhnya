import { useCallback, useEffect, useState } from "react";
import { queueAll, queueRemove, type Queued } from "./store";
import { flushQueue } from "./sync";
export default function SyncStatus({ user }: { user: string }) {
  const [queue, setQueue] = useState<Queued[]>([]),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    void queueAll(user)
      .then(setQueue)
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    refresh();
    const sync = () => {
      setBusy(true);
      void flushQueue(user)
        .catch(() => {})
        .finally(() => {
          setBusy(false);
          refresh();
        });
    };
    if (navigator.onLine) sync();
    window.addEventListener("online", sync);
    window.addEventListener("kitchen-queue", refresh);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("kitchen-queue", refresh);
    };
  }, [user, refresh]);
  useEffect(() => {
    const guard = (event: Event) => {
      if (busy) {
        event.preventDefault();
        window.alert("Дождитесь завершения синхронизации перед выходом.");
      } else if (
        queue.length &&
        !window.confirm(
          "Есть несинхронизированные изменения. При выходе они будут удалены с этого устройства. Выйти и удалить очередь?",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("kitchen-before-signout", guard);
    return () => window.removeEventListener("kitchen-before-signout", guard);
  }, [queue.length, busy]);
  if (!queue.length && !busy) return null;
  return (
    <section className="notice k-sync" role="status">
      <strong>
        {busy ? "Синхронизируем…" : `Локальных изменений: ${queue.length}`}
      </strong>
      <p>
        До подтверждения сервера это очередь устройства. Запасы и финансы офлайн
        не изменяются.
      </p>
      {queue.map((q) => (
        <details key={q.id}>
          <summary>
            {q.action === "favorite"
              ? "Избранное"
              : q.action === "menu_save"
                ? "Правка меню"
                : "Правка задачи"}{" "}
            · {q.state === "blocked" ? "требует решения" : "ожидает отправки"}
          </summary>
          {q.error && <p className="error">{q.error}</p>}
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(q.data, null, 2)}
          </pre>
          <p>
            При конфликте сохраните нужный текст и откройте актуальную запись.
            Автоматическая перезапись запрещена.
          </p>
          <button
            className="text-button danger"
            onClick={async () => {
              if (confirm("Удалить эту локальную операцию без отправки?")) {
                await queueRemove(q.id);
                refresh();
                window.dispatchEvent(new Event("kitchen-synced"));
              }
            }}
          >
            Удалить из очереди
          </button>
        </details>
      ))}
      <button
        className="secondary"
        disabled={busy || !navigator.onLine}
        onClick={async () => {
          setBusy(true);
          try {
            await flushQueue(user);
          } finally {
            setBusy(false);
            refresh();
          }
        }}
      >
        Повторить синхронизацию
      </button>
    </section>
  );
}
