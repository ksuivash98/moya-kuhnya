import { useRef, useState, type FormEvent, type ReactNode } from "react";
import Modal from "../components/Modal";
import { errorText } from "../supabase";
export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};
export default function Fields({
  title,
  fields,
  initial,
  onSave,
  onClose,
  offlineAllowed = false,
  extra,
  externalBusy = false,
}: {
  title: string;
  fields: Field[];
  initial: Record<string, unknown>;
  onSave: (d: Record<string, unknown>, key: string) => Promise<void>;
  onClose: () => void;
  offlineAllowed?: boolean;
  extra?: ReactNode;
  externalBusy?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const initialValue = useRef(initial);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const d = { ...initialValue.current };
    for (const f of fields) d[f.key] = String(form.get(f.key) ?? "");
    setBusy(true);
    setError("");
    try {
      await onSave(d, key.current);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={() => !busy && !externalBusy && onClose()}>
      <form onSubmit={submit} className="form-stack">
        <fieldset disabled={busy} className="k-fields">
          {extra}
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.type === "textarea" ? (
                <textarea
                  name={f.key}
                  defaultValue={String(initialValue.current[f.key] ?? "")}
                  maxLength={20000}
                />
              ) : f.options ? (
                <select
                  name={f.key}
                  defaultValue={String(initialValue.current[f.key] ?? "")}
                  required={f.required}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.key}
                  type={f.type ?? "text"}
                  defaultValue={String(initialValue.current[f.key] ?? "")}
                  required={f.required}
                  min={f.min}
                  max={f.max}
                  step={f.step ?? (f.type === "number" ? 0.0001 : undefined)}
                  maxLength={2000}
                />
              )}{" "}
              {f.hint && <small>{f.hint}</small>}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy || externalBusy}
          >
            Отмена
          </button>
          <button
            className="primary"
            disabled={
              busy || externalBusy || (!navigator.onLine && !offlineAllowed)
            }
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
