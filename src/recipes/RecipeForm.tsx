import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useBlocker } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import Modal from "../components/Modal";
import {
  blankRecipe,
  blankIngredient,
  blankStep,
  categories,
  units,
  moveStep,
  validate,
  type Recipe,
  type RecipeData,
} from "./model";
import { readDraft, writeDraft, removeDraft } from "./drafts";
import { saveRecipe } from "./api";
import { errorText } from "../supabase";
import { PhotoField } from "./Photos";
export default function RecipeForm({
  recipe,
  draftId,
  userId,
  familyId,
  suggestions,
  onSaved,
  onCancel,
}: {
  recipe?: Recipe;
  draftId?: string;
  userId: string;
  familyId: string;
  suggestions: string[];
  onSaved: (id: string, warning?: boolean) => void;
  onCancel: () => void;
}) {
  const draftKey = `${userId}:${familyId}:${recipe?.id ?? (draftId ? `import:${draftId}` : "new")}`;
  const [data, setData] = useState<RecipeData>(() =>
    structuredClone(recipe?.data ?? blankRecipe()),
  );
  const [id, setId] = useState(recipe?.id ?? crypto.randomUUID());
  const [version, setVersion] = useState<number | null>(
    recipe?.version ?? null,
  );
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [files, setFiles] = useState<Map<string, Blob>>(new Map());
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(0),
    [error, setError] = useState(""),
    [draftStatus, setDraftStatus] = useState(""),
    [discard, setDiscard] = useState(false);
  const dirty = useRef(false),
    saving = useRef(false),
    live = useRef(true),
    latest = useRef({ data, files, id, version, importWarnings });
  latest.current = { data, files, id, version, importWarnings };
  const blocker = useBlocker(() => dirty.current);
  const markDirty = () => {
    dirty.current = true;
  };
  const change = <K extends keyof RecipeData>(key: K, value: RecipeData[K]) => {
    markDirty();
    setData((prev) => ({ ...prev, [key]: value }));
  };
  const onPhotoBusy = useCallback((n: number) => {
    if (n > 0) dirty.current = true;
    setPhotoBusy((v) => Math.max(0, v + n));
  }, []);
  useEffect(() => {
    live.current = true;
    void readDraft(draftKey)
      .then((draft) => {
        if (!live.current) return;
        if (draft) {
          setData(draft.data);
          setImportWarnings(draft.importWarnings ?? []);
          setFiles(new Map(draft.files));
          setId(draft.recipeId);
          setVersion(draft.version);
          dirty.current = true;
          setDraftStatus(
            "Черновик восстановлен на этом устройстве, включая выбранные фотографии.",
          );
        }
        setReady(true);
      })
      .catch(() => {
        if (live.current) {
          setDraftStatus(
            "Не удалось открыть локальные черновики. Не закрывайте форму до сохранения.",
          );
          setReady(true);
        }
      });
    return () => {
      live.current = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!ready || !dirty.current || busy) return;
    const t = setTimeout(() => {
      void writeDraft({
        key: draftKey,
        recipeId: id,
        data,
        files: [...files],
        version,
        updatedAt: Date.now(),
        importWarnings,
      })
        .then(() => {
          if (live.current)
            setDraftStatus("Черновик сохранён на этом устройстве.");
        })
        .catch(() => {
          if (live.current)
            setDraftStatus(
              "Не удалось сохранить черновик. Возможно, хранилище браузера заполнено.",
            );
        });
    }, 500);
    return () => clearTimeout(t);
  }, [ready, data, files, id, version, busy, draftKey, importWarnings]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  // Сохраняем последнее состояние и при уходе из компонента между двумя debounce-записями.
  useEffect(
    () => () => {
      if (dirty.current && !saving.current) {
        const last = latest.current;
        void writeDraft({
          key: draftKey,
          recipeId: last.id,
          data: last.data,
          files: [...last.files],
          version: last.version,
          updatedAt: Date.now(),
          importWarnings: last.importWarnings,
        }).catch(() => {});
      }
    },
    [draftKey],
  );
  useEffect(() => {
    const beforeSignout = (event: Event) => {
      if (
        dirty.current &&
        !window.confirm(
          "Выйти из аккаунта? Изменения ещё не сохранены в базе. Черновик останется на этом устройстве.",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("kitchen-before-signout", beforeSignout);
    return () =>
      window.removeEventListener("kitchen-before-signout", beforeSignout);
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const issue = validate(data);
    if (issue) {
      setError(issue);
      return;
    }
    if (photoBusy) return;
    setError("");
    setBusy(true);
    saving.current = true;
    try {
      const result = await saveRecipe(
        id,
        familyId,
        data,
        files,
        version,
        recipe?.data,
      );
      dirty.current = false;
      try {
        await removeDraft(draftKey);
      } catch {
        /* Сохранение в БД успешно даже при недоступном IndexedDB. */
      }
      if (result.cleanupWarning)
        setDraftStatus(
          "Рецепт сохранён. Старые файлы не удалось очистить; они остаются приватными.",
        );
      onSaved(id, result.cleanupWarning);
    } catch (err) {
      setError(errorText(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function discardDraft() {
    try {
      await removeDraft(draftKey);
      dirty.current = false;
      setDiscard(false);
      onCancel();
    } catch (err) {
      setError(errorText(err));
      setDiscard(false);
    }
  }
  if (!ready)
    return (
      <div className="panel recipe-loading" role="status">
        Открываем форму и проверяем черновик…
      </div>
    );
  return (
    <>
      <form onSubmit={submit} className="recipe-form">
        <div className="section-heading">
          <div>
            <h1>{recipe ? "Редактирование рецепта" : "Новый рецепт"}</h1>
            <p className="muted">
              Сохраните то, что хочется приготовить снова.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть форму"
            disabled={busy}
            onClick={onCancel}
          >
            <X />
          </button>
        </div>
        <p className="draft-status" role="status">
          {draftStatus ||
            "Черновик сохраняется автоматически только на этом устройстве."}
        </p>
        {draftId && (
          <div className="notice">
            <strong>
              Черновик после распознавания — проверьте перед сохранением.
            </strong>
            <p>
              ИИ может ошибаться. Незаданные количества, порции и время нужно
              заполнить самостоятельно.
            </p>
            {importWarnings.length > 0 && (
              <ul>
                {importWarnings.map((w, n) => (
                  <li key={n}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <fieldset disabled={busy} className="form-fieldset">
          <section className="panel">
            <h2>Основная информация</h2>
            <div className="form-stack">
              <label>
                Название рецепта *
                <input
                  required
                  maxLength={200}
                  value={data.title}
                  onChange={(e) => change("title", e.target.value)}
                  placeholder="Например, сырники по семейному рецепту"
                />
              </label>
              <label>
                Описание
                <textarea
                  maxLength={20000}
                  value={data.description}
                  onChange={(e) => change("description", e.target.value)}
                  placeholder="Чем вам нравится это блюдо?"
                />
              </label>
              <div className="form-grid">
                <label>
                  Категория
                  <select
                    value={data.category}
                    onChange={(e) => change("category", e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Сложность
                  <select
                    value={data.difficulty}
                    onChange={(e) => change("difficulty", e.target.value)}
                  >
                    {["Легко", "Средне", "Сложно"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-grid three">
                <label>
                  Подготовка, мин
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    step={1}
                    required
                    value={Number.isNaN(data.prep) ? "" : data.prep}
                    onChange={(e) => change("prep", e.target.valueAsNumber)}
                  />
                </label>
                <label>
                  Приготовление, мин
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    step={1}
                    required
                    value={Number.isNaN(data.cook) ? "" : data.cook}
                    onChange={(e) => change("cook", e.target.valueAsNumber)}
                  />
                </label>
                <label>
                  Порции
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    required
                    value={Number.isNaN(data.servings) ? "" : data.servings}
                    onChange={(e) => change("servings", e.target.valueAsNumber)}
                  />
                </label>
              </div>
              <PhotoField
                label="Фотография блюда"
                path={data.photo}
                blob={files.get("cover")}
                disabled={busy}
                onBusy={onPhotoBusy}
                onChange={(blob) => {
                  markDirty();
                  setFiles((prev) => {
                    const m = new Map(prev);
                    if (blob) m.set("cover", blob);
                    else m.delete("cover");
                    return m;
                  });
                  if (!blob) change("photo", "");
                }}
              />
            </div>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Ингредиенты</h2>
              <span className="muted text-sm">
                {data.ingredients.length} поз.
              </span>
            </div>
            <p className="muted">
              Подсказки — из ингредиентов семейных рецептов. Остатки домашних
              продуктов доступны в разделе «Мои продукты».
            </p>
            <datalist id="recipe-products">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="ingredients-editor">
              {data.ingredients.map((i, index) => (
                <div className="ingredient-editor" key={i.id}>
                  <label>
                    Ингредиент {index + 1}
                    <input
                      required
                      maxLength={200}
                      list="recipe-products"
                      value={i.name}
                      onChange={(e) =>
                        change(
                          "ingredients",
                          data.ingredients.map((v) =>
                            v.id === i.id ? { ...v, name: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Количество
                    <input
                      inputMode="decimal"
                      disabled={i.unit === "по вкусу"}
                      required={i.unit !== "по вкусу"}
                      aria-label={`Количество ингредиента ${index + 1}`}
                      value={i.amount}
                      onChange={(e) =>
                        change(
                          "ingredients",
                          data.ingredients.map((v) =>
                            v.id === i.id
                              ? { ...v, amount: e.target.value }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Единица
                    <select
                      aria-label={`Единица ингредиента ${index + 1}`}
                      required
                      value={i.unit}
                      onChange={(e) =>
                        change(
                          "ingredients",
                          data.ingredients.map((v) =>
                            v.id === i.id
                              ? {
                                  ...v,
                                  unit: e.target.value,
                                  amount:
                                    e.target.value === "по вкусу"
                                      ? ""
                                      : v.amount,
                                }
                              : v,
                          ),
                        )
                      }
                    >
                      <option value="" disabled>
                        Выберите единицу
                      </option>
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Примечание
                    <input
                      maxLength={2000}
                      aria-label={`Примечание ингредиента ${index + 1}`}
                      value={i.note}
                      onChange={(e) =>
                        change(
                          "ingredients",
                          data.ingredients.map((v) =>
                            v.id === i.id ? { ...v, note: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Удалить ингредиент ${index + 1}`}
                    onClick={() =>
                      change(
                        "ingredients",
                        data.ingredients.filter((v) => v.id !== i.id),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change("ingredients", [...data.ingredients, blankIngredient()])
              }
            >
              <Plus size={17} />
              Добавить ингредиент
            </button>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Приготовление</h2>
              <span className="muted text-sm">Шаг за шагом</span>
            </div>
            <div className="steps-editor">
              {data.steps.map((s, index) => (
                <div className="step-editor" key={s.id}>
                  <div className="step-heading">
                    <span className="step-number">{index + 1}</span>
                    <h3>Шаг {index + 1}</h3>
                    <div className="step-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Шаг ${index + 1} вверх`}
                        disabled={index === 0}
                        onClick={() =>
                          change("steps", moveStep(data.steps, index, -1))
                        }
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Шаг ${index + 1} вниз`}
                        disabled={index === data.steps.length - 1}
                        onClick={() =>
                          change("steps", moveStep(data.steps, index, 1))
                        }
                      >
                        <ArrowDown size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Удалить шаг ${index + 1}`}
                        onClick={() => {
                          change(
                            "steps",
                            data.steps.filter((v) => v.id !== s.id),
                          );
                          setFiles((prev) => {
                            const m = new Map(prev);
                            m.delete(s.id);
                            return m;
                          });
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  <label>
                    Описание шага {index + 1}
                    <textarea
                      required
                      maxLength={20000}
                      aria-label={`Описание шага ${index + 1}`}
                      value={s.text}
                      onChange={(e) =>
                        change(
                          "steps",
                          data.steps.map((v) =>
                            v.id === s.id ? { ...v, text: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <PhotoField
                    label={`Фото шага ${index + 1}`}
                    path={s.photo}
                    blob={files.get(s.id)}
                    disabled={busy}
                    onBusy={onPhotoBusy}
                    onChange={(blob) => {
                      markDirty();
                      setFiles((prev) => {
                        const m = new Map(prev);
                        if (blob) m.set(s.id, blob);
                        else m.delete(s.id);
                        return m;
                      });
                      if (!blob)
                        change(
                          "steps",
                          data.steps.map((v) =>
                            v.id === s.id ? { ...v, photo: "" } : v,
                          ),
                        );
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => change("steps", [...data.steps, blankStep()])}
            >
              <Plus size={17} />
              Добавить шаг
            </button>
          </section>
          <section className="panel">
            <h2>Хранение</h2>
            <div className="form-stack">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.freeze}
                  onChange={(e) => change("freeze", e.target.checked)}
                />
                Можно замораживать
              </label>
              <label>
                Рекомендуемый срок хранения
                <input
                  maxLength={1000}
                  value={data.shelfLife}
                  onChange={(e) => change("shelfLife", e.target.value)}
                  placeholder="Например, до 3 дней в холодильнике"
                />
              </label>
              <label>
                Условия хранения
                <textarea
                  maxLength={10000}
                  value={data.storage}
                  onChange={(e) => change("storage", e.target.value)}
                />
              </label>
              <label>
                Приготовление после разморозки
                <textarea
                  maxLength={10000}
                  value={data.thaw}
                  onChange={(e) => change("thaw", e.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="panel">
            <h2>Дополнительно</h2>
            <div className="form-stack">
              <label>
                Примечания
                <textarea
                  maxLength={20000}
                  value={data.notes}
                  onChange={(e) => change("notes", e.target.value)}
                />
              </label>
              <label>
                Ссылка на источник
                <input
                  type="url"
                  maxLength={2000}
                  value={data.source}
                  onChange={(e) => change("source", e.target.value)}
                  placeholder="https://"
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.favorite}
                  onChange={(e) => change("favorite", e.target.checked)}
                />
                Добавить в избранное
              </label>
            </div>
          </section>
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-save-bar">
          <button
            className="primary"
            disabled={busy || photoBusy > 0 || !navigator.onLine}
          >
            <Save size={17} />
            {busy
              ? "Сохраняем…"
              : photoBusy
                ? "Обрабатываем фото…"
                : "Сохранить рецепт"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Закрыть, оставив черновик
          </button>
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => setDiscard(true)}
          >
            Удалить черновик
          </button>
          {!navigator.onLine && (
            <span className="error">
              Для сохранения в семейную базу нужен интернет.
            </span>
          )}
        </div>
      </form>
      {discard && (
        <Modal title="Удалить черновик?" onClose={() => setDiscard(false)}>
          <p className="muted">
            Несохранённые поля и выбранные фотографии будут удалены только с
            этого устройства.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setDiscard(false)}>
              Оставить
            </button>
            <button
              className="primary danger-fill"
              onClick={() => void discardDraft()}
            >
              Удалить черновик
            </button>
          </div>
        </Modal>
      )}
      {blocker.state === "blocked" && (
        <Modal title="Выйти из формы?" onClose={() => blocker.reset()}>
          <p className="muted">
            Изменения ещё не отправлены в базу. Черновик останется на этом
            устройстве.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => blocker.reset()}>
              Продолжить редактирование
            </button>
            <button className="primary" onClick={() => blocker.proceed()}>
              Выйти
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
