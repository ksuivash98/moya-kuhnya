import { mkdir, copyFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const target = new URL("../public/ocr/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(
  require.resolve("tesseract.js/dist/worker.min.js"),
  new URL("worker.min.js", target),
);
for (const pkg of ["tesseract.js", "tesseract.js-core"]) {
  await copyFile(
    join(
      dirname(require.resolve(`${pkg}/package.json`)),
      pkg === "tesseract.js" ? "LICENSE.md" : "LICENSE",
    ),
    new URL(`${pkg}-LICENSE.txt`, target),
  );
}
const core = dirname(require.resolve("tesseract.js-core/package.json"));
for (const name of await readdir(core)) {
  if (name.endsWith(".wasm.js") || name.endsWith(".wasm"))
    await copyFile(join(core, name), new URL(name, target));
}
for (const lang of ["rus", "eng"]) {
  const root = dirname(
    require.resolve(`@tesseract.js-data/${lang}/package.json`),
  );
  await copyFile(
    join(root, "4.0.0_best_int", `${lang}.traineddata.gz`),
    new URL(`${lang}.traineddata.gz`, target),
  );
}
console.log("Локальные OCR-ресурсы подготовлены.");
