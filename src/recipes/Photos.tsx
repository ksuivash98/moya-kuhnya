import "./photos.css";
import { useEffect, useState, useRef } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import Modal from "../components/Modal";
import { signedPhoto, optimizePhoto } from "./api";
import { cacheGet, cachePut } from "../offline/store";
import { client, errorText } from "../supabase";
export function Photo({
  path,
  blob,
  alt,
  className = "",
  zoomable = false,
}: {
  path: string;
  blob?: Blob;
  alt: string;
  className?: string;
  zoomable?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const closePhoto = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const [src, setSrc] = useState(""),
    [failed, setFailed] = useState(false),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setOpen(false);
    setSrc("");
    setFailed(false);
    if (blob) {
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    if (!path) return;
    let localUrl = "";
    const load = () => {
      void (async () => {
        try {
          const session = await client().auth.getSession();
          const user = session.data.session?.user.id;
          const family = (
            path.startsWith("prep:") ? path.slice(5) : path
          ).split("/")[0];
          if (!navigator.onLine) {
            if (!user) throw new Error();
            const saved = await cacheGet<Blob>(user, family, "photo:" + path);
            if (localUrl) URL.revokeObjectURL(localUrl);
            localUrl = URL.createObjectURL(saved);
            if (active) {
              setSrc(localUrl);
              setFailed(false);
            }
            return;
          }
          const url = await signedPhoto(path);
          if (active) {
            setSrc(url);
            setFailed(false);
          }
          if (user) {
            try {
              await cacheGet<Blob>(user, family, "photo:" + path);
            } catch {
              const response = await fetch(url);
              if (response.ok) {
                const value = await response.blob();
                if (value.size <= 5242880)
                  await cachePut(user, family, "photo:" + path, value);
              }
            }
          }
        } catch {
          if (active) setFailed(true);
        }
      })();
    };
    load();
    const t = setInterval(load, 12 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(t);
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [path, blob]);
  return src && !failed ? (
    <>
      {zoomable ? (
        <button
          type="button"
          className="photo-open"
          ref={trigger}
          aria-label={`Открыть фото: ${alt}`}
          onClick={() => setOpen(true)}
        >
          <img
            className={`recipe-photo ${className}`}
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <span className="photo-open-hint">Посмотреть целиком</span>
        </button>
      ) : (
        <img
          className={`recipe-photo ${className}`}
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {open && (
        <Modal title={alt} className="photo-viewer-dialog" onClose={closePhoto}>
          <img className="photo-viewer-image" src={src} alt={alt} />
        </Modal>
      )}
    </>
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
      {(path || blob) && <Photo path={path} blob={blob} alt={label} zoomable />}
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
        JPEG, PNG, WebP до 20 МБ. Фото сохраняется целиком с уменьшением до 1600
        пикселей. Нажмите на снимок для крупного просмотра.
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
