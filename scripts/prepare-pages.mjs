import { copyFile, writeFile } from "node:fs/promises";
// GitHub Pages не поддерживает серверные SPA rewrite: 404 отдаёт ту же оболочку.
// BrowserRouter сохраняет исходный путь, query и hash (в том числе Auth callback).
await copyFile("dist/index.html", "dist/404.html");
await writeFile("dist/.nojekyll", "");
