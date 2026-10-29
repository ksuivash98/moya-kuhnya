import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = [
  "supabase/functions/_shared/recipe-import.ts",
  "supabase/functions/recipe-import/handler.ts",
  "supabase/functions/recipe-import/index.ts",
];
const known = new Set(inputs.map((p) => resolve(root, p)));
const chunks = [];
for (const path of inputs) {
  const filename = resolve(root, path);
  let source = await readFile(filename, "utf8");
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const edits = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    if (!known.has(resolve(dirname(filename), specifier)))
      throw new Error(`Добавьте зависимость в сборку редактора: ${specifier}`);
    edits.push([statement.getStart(ast), statement.end]);
  }
  for (const [start, end] of edits.reverse())
    source = source.slice(0, start) + source.slice(end);
  chunks.push(`// Исходник: ${path}\n${source.trim()}`);
}
const output = `// Сгенерировано: npm run build:edge-editor. Не редактировать вручную.
// Supabase Edge Functions → Via Editor → index.ts, Function name: recipe-import.
// Ключи задаются только в Secrets. Платные запросы выключены по умолчанию.
\n${chunks.join("\n\n")}\n`;
const target = resolve(root, "supabase/dashboard/recipe-import.ts");
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output)
    throw new Error(
      "Версия для редактора устарела. Выполните npm run build:edge-editor и сохраните файл.",
    );
  console.log("Версия recipe-import для редактора соответствует исходникам.");
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output);
  console.log("Создан supabase/dashboard/recipe-import.ts");
}
