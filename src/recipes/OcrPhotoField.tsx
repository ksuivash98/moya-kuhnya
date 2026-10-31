import { useRef, useState } from "react";
import { Photo } from "./Photos";
import {
  defaultOcrOptions,
  prepareOcrPhoto,
  type OcrPhotoOptions,
} from "./ocr-photo";
import { errorText } from "../supabase";
export default function OcrPhotoField({
  disabled,
  onChange,
  onBusy,
}: {
  disabled: boolean;
  onChange: (photo: Blob | null) => void;
  onBusy: (delta: number) => void;
}) {
  const [source, setSource] = useState<File | null>(null),
    [preview, setPreview] = useState<Blob | null>(null),
    [options, setOptions] = useState(defaultOcrOptions),
    [error, setError] = useState("");
  const sequence = useRef(0);
  async function update(file: File | null, next: OcrPhotoOptions) {
    const id = ++sequence.current;
    setOptions(next);
    setSource(file);
    setError("");
    onChange(null);
    if (!file) {
      setPreview(null);
      return;
    }
    onBusy(1);
    try {
      const blob = await prepareOcrPhoto(file, next);
      if (id === sequence.current) {
        setPreview(blob);
        onChange(blob);
      }
    } catch (e) {
      if (id === sequence.current) {
        setError(errorText(e));
        setPreview(null);
      }
    } finally {
      onBusy(-1);
    }
  }
  return (
    <fieldset className="ocr-photo-field" disabled={disabled}>
      <label className="secondary upload-button">
        Выбрать страницу рецепта
        <input
          className="visually-hidden"
          type="file"
          aria-label="Фото для распознавания"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void update(file, defaultOcrOptions());
          }}
        />
      </label>
      <small className="muted">
        JPEG, PNG, WebP до 20 МБ. Текст сохраняется в PNG до 3200 пикселей без
        сжатия JPEG.
      </small>
      {preview && (
        <Photo
          path=""
          blob={preview}
          alt="Подготовленная страница рецепта"
          className="ocr-preview"
        />
      )}
      {source && (
        <>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void update(source, {
                  ...options,
                  rotation: (options.rotation + 90) % 360,
                  crop: defaultOcrOptions().crop,
                })
              }
            >
              Повернуть на 90°
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void update(source, defaultOcrOptions())}
            >
              Сбросить обработку
            </button>
            <button
              type="button"
              className="text-button danger"
              onClick={() => void update(null, defaultOcrOptions())}
            >
              Убрать фото
            </button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={options.enhance}
              onChange={(e) =>
                void update(source, { ...options, enhance: e.target.checked })
              }
            />
            Усилить контраст текста
          </label>
          <details>
            <summary>Обрезать лишние края</summary>
            <p className="muted">
              Укажите, какую долю убрать с каждой стороны. Проценты считаются от
              всей повёрнутой страницы. Оставьте только нужный рецепт.
            </p>
            <div className="form-grid">
              {(
                [
                  ["top", "Сверху"],
                  ["bottom", "Снизу"],
                  ["left", "Слева"],
                  ["right", "Справа"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}, %
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={options.crop[key]}
                    onChange={(e) =>
                      void update(source, {
                        ...options,
                        crop: {
                          ...options.crop,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
