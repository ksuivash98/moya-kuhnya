import { useEffect, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { signedPhoto, optimizePhoto } from "./api";
import { errorText } from "../supabase";
export function Photo({
  path,
  blob,
  alt,
  className = "",
}: {
  path: string;
  blob?: Blob;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc("");
    setFailed(false);
    if (blob) {
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    if (!path) return;
    const load = () => {
      void signedPhoto(path)
        .then((url) => {
          if (active) {
            setSrc(url);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };
    load();
    const t = setInterval(load, 12 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [path, blob]);
  return src && !failed ? (
    <img
      className={`recipe-photo ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={`recipe-photo photo-placeholder ${className}`}
      role="img"
      aria-label={failed ? "Фото недоступно" : alt}
    >
      <Camera size={32} />
      <span>
        {failed
          ? "Не удалось загрузить фото"
          : path
            ? "Загружаем фото…"
            : "Без фотографии"}
      </span>
    </div>
  );
}
export function PhotoField({
  label,
  path,
  blob,
  onChange,
  onBusy,
  disabled,
}: {
  label: string;
  path: string;
  blob?: Blob;
  onChange: (blob: Blob | null) => void;
  onBusy: (value: number) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="photo-field">
      <span className="field-label">{label}</span>
      {(path || blob) && <Photo path={path} blob={blob} alt={label} />}
      <div className="photo-buttons">
        <label
          className={`secondary upload-button ${disabled ? "disabled" : ""}`}
        >
          <ImagePlus size={17} />
          {busy
            ? "Обрабатываем…"
            : path || blob
              ? "Заменить фото"
              : "Загрузить фото"}
          <input
            aria-label={label}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setError("");
              setBusy(true);
              onBusy(1);
              try {
                onChange(await optimizePhoto(file));
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
                onBusy(-1);
              }
            }}
          />
        </label>
        {(path || blob) && (
          <button
            type="button"
            className="icon-button danger"
            aria-label={`Удалить: ${label}`}
            disabled={disabled || busy}
            onClick={() => onChange(null)}
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      <small className="muted">
        JPEG, PNG, WebP до 20 МБ. Оптимизация до 1600 пикселей перед загрузкой.
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
