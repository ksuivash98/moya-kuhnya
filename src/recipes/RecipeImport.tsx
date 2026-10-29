import { validateExtraction as validateHistory } from "../../supabase/functions/_shared/recipe-import";
import { useEffect, useState } from "react";
import Modal from "../components/Modal";
import { client, errorText } from "../supabase";
import { PhotoField } from "./Photos";
import {
  imageData,
  recognizeRecipe,
  importDraft,
  type ExtractedRecipe,
} from "./import";
import { writeDraft, recentImportDrafts, type Draft } from "./drafts";
type History = {
  id: string;
  source_kind: string;
  result: unknown;
  created_at: string;
};
export default function RecipeImport({
  mode,
  userId,
  familyId,
  onClose,
  onReview,
}: {
  mode: "text" | "photo";
  userId: string;
  familyId: string;
  onClose: () => void;
  onReview: (id: string) => void;
}) {
  const [text, setText] = useState(""),
    [photo, setPhoto] = useState<Blob | null>(null),
    [photoBusy, setPhotoBusy] = useState(0),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<ExtractedRecipe | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [history, setHistory] = useState<History[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [historyNote, setHistoryNote] = useState("");
  const reset = () => {
    setRequestId(crypto.randomUUID());
    setResult(null);
    setError("");
  };
  useEffect(() => {
    let active = true;
    void recentImportDrafts(userId, familyId)
      .then((rows) => {
        if (active) setDrafts(rows);
      })
      .catch(() => {});
    void client()
      .from("recipe_import_requests")
      .select("id,source_kind,result,created_at")
      .eq("family_id", familyId)
      .eq("user_id", userId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r) => {
        if (active) {
          if (r.error)
            setHistoryNote(
              "История пока недоступна. Для первого подключения примените миграцию 009.",
            );
          else setHistory(r.data ?? []);
        }
      });
    return () => {
      active = false;
    };
  }, [userId, familyId]);
  useEffect(() => {
    const guard = (e: Event) => {
      if (busy || photoBusy) {
        e.preventDefault();
        window.alert("Дождитесь завершения распознавания или обработки фото.");
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("kitchen-before-signout", guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("kitchen-before-signout", guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, [busy, photoBusy]);
  async function review(raw: unknown) {
    setError("");
    setBusy(true);
    try {
      const { data, warnings } = importDraft(raw),
        id = crypto.randomUUID();
      await writeDraft({
        key: `${userId}:${familyId}:import:${id}`,
        recipeId: id,
        data,
        files: [],
        version: null,
        updatedAt: Date.now(),
        importWarnings: warnings,
      });
      onReview(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const preview = result?.is_recipe ? importDraft(result) : null;
  return (
    <Modal
      title={
        mode === "photo" ? "Рецепт по фото или скриншоту" : "Рецепт из текста"
      }
      onClose={() => !busy && !photoBusy && onClose()}
    >
      <p className="muted">
        Доступно владельцу и взрослым участникам. Распознайте источник,
        проверьте результат и сохраните рецепт. Автоматической записи в книгу
        нет.
      </p>
      {!result && drafts.length > 0 && (
        <details className="import-history">
          <summary>Мои черновики после распознавания</summary>
          <p className="muted">
            Последние пять на этом устройстве. Здесь сохраняются ваши
            исправления.
          </p>
          {drafts.map((d) => (
            <button
              key={d.key}
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => onReview(d.recipeId)}
            >
              {d.data.title || "Без названия"} ·{" "}
              {new Date(d.updatedAt).toLocaleString("ru-RU")}
            </button>
          ))}
        </details>
      )}
      {!result && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || photoBusy || !consent) return;
            setError("");
            setBusy(true);
            try {
              setResult(
                await recognizeRecipe(
                  requestId,
                  familyId,
                  mode === "text"
                    ? { kind: "text", text }
                    : { kind: "photo", image: await imageData(photo!) },
                ),
              );
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "text" ? (
            <label>
              Текст рецепта
              <textarea
                aria-label="Текст рецепта"
                required
                maxLength={20000}
                rows={9}
                value={text}
                disabled={busy}
                placeholder="Вставьте название, ингредиенты и способ приготовления"
                onChange={(e) => {
                  setText(e.target.value);
                  reset();
                }}
              />
              <small className="muted">{text.length} / 20 000 символов</small>
            </label>
          ) : (
            <>
              <PhotoField
                label="Фото для распознавания"
                path=""
                blob={photo ?? undefined}
                disabled={busy}
                onBusy={(n) => setPhotoBusy((v) => Math.max(0, v + n))}
                onChange={(blob) => {
                  setPhoto(blob);
                  reset();
                }}
              />
              <small className="muted">
                Одно чёткое изображение с ингредиентами и шагами. После сжатия —
                до 3 МБ. Исходник не становится фотографией блюда.
              </small>
            </>
          )}
          <div className="notice">
            <p>
              Выбранный {mode === "photo" ? "снимок" : "текст"} будет отправлен
              внешнему сервису OpenAI. Не добавляйте личные данные. Запрос может
              быть платным по тарифу владельца; до 5 распознаваний в сутки,
              включая неудачные.
            </p>
            <label className="check-line">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Разрешаю отправить этот источник в OpenAI для распознавания
            </label>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || photoBusy > 0}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                photoBusy > 0 ||
                !consent ||
                (mode === "text" ? !text.trim() : !photo)
              }
            >
              {busy ? "Распознаём…" : "Распознать рецепт"}
            </button>
          </div>
          {error && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={reset}
            >
              Новый запрос
            </button>
          )}
        </form>
      )}
      {result && (
        <div className="form-stack">
          {preview ? (
            <>
              <h3>{preview.data.title || "Название не распознано"}</h3>
              <p>{result.description}</p>
              <h4>Ингредиенты</h4>
              <ul>
                {result.ingredients.map((i, n) => (
                  <li key={n}>
                    {i.name} — {i.amount ?? "количество не указано"}{" "}
                    {i.unit ?? "единица не указана"}
                    {i.note && ` (${i.note})`}
                  </li>
                ))}
              </ul>
              <h4>Шаги</h4>
              <ol>
                {result.steps.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ol>
              <p className="muted">
                Порции: {result.servings ?? "не указаны"}. Подготовка:{" "}
                {result.prep ?? "не указана"}. Приготовление:{" "}
                {result.cook ?? "не указано"} (мин).
              </p>
              {preview.warnings.length > 0 && (
                <div className="notice">
                  <strong>Нужно проверить</strong>
                  <ul>
                    {preview.warnings.map((w, n) => (
                      <li key={n}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                ИИ может ошибаться. Далее откроется форма, в которой можно
                исправить все поля, удалить или добавить ингредиенты и шаги.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void review(result)}
              >
                Проверить и редактировать
              </button>
            </>
          ) : (
            <p className="notice">
              В источнике не найден рецепт. Попробуйте другой текст или более
              чёткую фотографию.
            </p>
          )}
          <button className="secondary" disabled={busy} onClick={reset}>
            Другой источник
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!result && (
        <details className="import-history">
          <summary>Мои последние распознавания</summary>
          <p className="muted">
            Только ваши готовые результаты в этой семье. Можно открыть после
            перезагрузки без нового ИИ-запроса.
          </p>
          {historyNote && <p>{historyNote}</p>}
          {!history.length && !historyNote && (
            <p>Готовых распознаваний пока нет.</p>
          )}
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                try {
                  setResult(validateHistory(h.result));
                  setError("");
                } catch {
                  setError("Не удалось открыть этот результат.");
                }
              }}
            >
              {new Date(h.created_at).toLocaleString("ru-RU")} ·{" "}
              {h.source_kind === "photo" ? "Фото" : "Текст"}
            </button>
          ))}
        </details>
      )}
    </Modal>
  );
}
