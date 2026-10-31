export type OcrPhotoOptions = {
  rotation: number;
  enhance: boolean;
  crop: { top: number; right: number; bottom: number; left: number };
};
export const defaultOcrOptions = (): OcrPhotoOptions => ({
  rotation: 0,
  enhance: true,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
});
export async function prepareOcrPhoto(
  file: Blob,
  options: OcrPhotoOptions,
): Promise<Blob> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Выберите JPEG, PNG или WebP размером до 20 МБ.");
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 60_000_000)
      throw new Error(
        "Слишком большое изображение. Обрежьте его в галерее перед выбором.",
      );
    const angle = ((options.rotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle))
      throw new Error("Допустим поворот с шагом 90°.");
    const { top, right, bottom, left } = options.crop;
    if (
      ![top, right, bottom, left].every(
        (n) => Number.isFinite(n) && n >= 0 && n <= 90,
      ) ||
      left + right >= 95 ||
      top + bottom >= 95
    )
      throw new Error("Оставьте не менее 5% ширины и высоты страницы.");
    const sideways = angle === 90 || angle === 270;
    const width = sideways ? image.height : image.width;
    const height = sideways ? image.width : image.height;
    const scale = Math.min(1, 3200 / Math.max(width, height));
    const rotated = document.createElement("canvas");
    rotated.width = Math.max(1, Math.round(width * scale));
    rotated.height = Math.max(1, Math.round(height * scale));
    const ctx = rotated.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, rotated.width, rotated.height);
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(
      image,
      (-image.width * scale) / 2,
      (-image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(
      1,
      Math.round((rotated.width * (100 - left - right)) / 100),
    );
    canvas.height = Math.max(
      1,
      Math.round((rotated.height * (100 - top - bottom)) / 100),
    );
    const target = canvas.getContext("2d", { willReadFrequently: true })!;
    target.drawImage(
      rotated,
      (rotated.width * left) / 100,
      (rotated.height * top) / 100,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (options.enhance) {
      const data = target.getImageData(0, 0, canvas.width, canvas.height);
      const histogram = new Uint32Array(256);
      for (let i = 0; i < data.data.length; i += 4) {
        const gray = Math.round(
          0.299 * data.data[i] +
            0.587 * data.data[i + 1] +
            0.114 * data.data[i + 2],
        );
        data.data[i] = gray;
        histogram[gray]++;
      }
      const count = canvas.width * canvas.height;
      let total = 0,
        low = 0,
        high = 255;
      for (let i = 0; i < 256; i++) {
        total += histogram[i];
        if (total >= count * 0.01) {
          low = i;
          break;
        }
      }
      total = 0;
      for (let i = 255; i >= 0; i--) {
        total += histogram[i];
        if (total >= count * 0.01) {
          high = i;
          break;
        }
      }
      for (let i = 0; i < data.data.length; i += 4) {
        const gray =
          high - low > 20
            ? Math.max(
                0,
                Math.min(255, ((data.data[i] - low) * 255) / (high - low)),
              )
            : data.data[i];
        data.data[i] = data.data[i + 1] = data.data[i + 2] = gray;
      }
      target.putImageData(data, 0, 0);
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Не удалось подготовить фото.")),
        "image/png",
      ),
    );
  } finally {
    image.close();
  }
}
