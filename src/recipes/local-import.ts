import {
  validateExtraction,
  type ExtractedRecipe,
} from "../../supabase/functions/_shared/recipe-import";

const unitPattern =
  "(?:кг|килограмм(?:а|ов)?|грамм(?:а|ов)?|гр\\.?|г|мл|миллилитр(?:а|ов)?|литр(?:а|ов)?|л|шт\\.?|штук[аи]?|ст\\.?\\s*л\\.?|ч\\.?\\s*л\\.?|стакан(?:а|ов)?|упаковк[аи]?)";
const quantityPattern = `(?<amount>\\d+(?:[.,]\\d{1,4})?)\\s*(?<unit>${unitPattern})(?=\\s|$|[,;—–-])`;
function unit(raw: string) {
  const s = raw.toLowerCase().replace(/[.\s]/g, "");
  if (/^к/.test(s)) return "кг";
  if (/^г/.test(s)) return "г";
  if (/^(мл|милли)/.test(s)) return "мл";
  if (/^л/.test(s)) return "л";
  if (/^шт/.test(s)) return "шт.";
  if (s === "стл") return "ст. л.";
  if (s === "чл") return "ч. л.";
  if (/^стак/.test(s)) return "стакан";
  return "упаковка";
}
function ingredient(line: string): ExtractedRecipe["ingredients"][number] {
  const match = new RegExp(quantityPattern, "iu").exec(line);
  if (match?.groups) {
    const amount = match.groups.amount.replace(",", ".");
    // Ranges/fractions are deliberately preserved as text, never guessed.
    if (
      !/[\d/½¼¾]\s*[-–—/]\s*$/.test(line.slice(0, match.index)) &&
      Number(amount) > 0 &&
      Number(amount) <= 1e9
    ) {
      const name = (
        line.slice(0, match.index) + line.slice(match.index + match[0].length)
      ).replace(/^[\s:—–-]+|[\s:—–-]+$/g, "");
      if (name)
        return {
          name: name.slice(0, 200),
          amount,
          unit: unit(match.groups.unit),
          note: line.length > 200 ? line.slice(0, 2000) : "",
        };
    }
  }
  const taste = /\s*[-—–:]?\s*по вкусу\s*$/i;
  return {
    name: line.replace(taste, "").trim().slice(0, 200) || line.slice(0, 200),
    amount: null,
    unit: taste.test(line) ? "по вкусу" : null,
    note: line.slice(0, 2000),
  };
}
export function parseRecipeText(source: string): ExtractedRecipe {
  if (!source.trim() || source.length > 20000)
    throw new Error("Введите текст рецепта длиной до 20 000 символов.");
  const lines = source
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const result: ExtractedRecipe = {
    is_recipe: true,
    title: null,
    description: source.length > 10000 ? source.slice(10000) : null,
    category: null,
    prep: null,
    cook: null,
    servings: null,
    difficulty: null,
    ingredients: [],
    steps: [],
    notes: source.slice(0, 10000),
    warnings: [
      "Локальный разбор по правилам может ошибаться. Проверьте ингредиенты, количества и шаги. Исходный текст сохранён в заметках.",
    ],
  };
  let section: "intro" | "ingredients" | "steps" = "intro";
  for (const raw of lines) {
    const line = raw.replace(/^[•*–—-]\s+/, "");
    if (/^(ингредиенты|состав|ingredients)\s*:?$/i.test(line)) {
      section = "ingredients";
      continue;
    }
    if (
      /^(приготовление|способ приготовления|инструкция|шаги|instructions|directions|method)\s*:?$/i.test(
        line,
      )
    ) {
      section = "steps";
      continue;
    }
    const servings =
      /^(?:порци[йия]|количество порций|servings)\s*[:—-]?\s*(\d+)$/i.exec(
        line,
      );
    if (servings && +servings[1] > 0 && +servings[1] <= 1000) {
      result.servings = +servings[1];
      continue;
    }
    const time =
      /^(подготовка|приготовление)\s*:\s*(\d+)\s*(мин(?:ут[аы]?)?\.?)$/i.exec(
        line,
      );
    if (time && +time[2] <= 10080) {
      result[time[1].toLowerCase() === "подготовка" ? "prep" : "cook"] =
        +time[2];
      continue;
    }
    if (section === "steps" || /^\d+[.)]\s+/.test(line)) {
      section = "steps";
      result.steps.push(line.replace(/^\d+[.)]\s+/, ""));
      continue;
    }
    if (
      section === "ingredients" ||
      new RegExp(quantityPattern, "iu").test(line) ||
      /по вкусу$/i.test(line)
    ) {
      result.ingredients.push(ingredient(line));
      continue;
    }
    if (!result.title)
      result.title = line.replace(/^название\s*:\s*/i, "").slice(0, 200);
  }
  if (!result.ingredients.length && !result.steps.length)
    throw new Error(
      "Не удалось выделить рецепт. Добавьте разделы «Ингредиенты» и «Приготовление» и разделите строки переносами.",
    );
  if (result.ingredients.length > 100 || result.steps.length > 100)
    throw new Error(
      "Слишком много ингредиентов или шагов: максимум по 100. Разделите рецепт.",
    );
  return validateExtraction(result);
}

export async function recognizePhotoLocally(
  photo: Blob,
  progress: (value: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.origin).href;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 120000);
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () =>
        reject(
          new Error(
            "Распознавание остановлено или заняло больше двух минут. Попробуйте меньший фрагмент фото.",
          ),
        ),
      { once: true },
    );
  });
  const initialize = async () => {
    const created = await createWorker("rus+eng", 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base.replace(/\/$/, ""),
      cachePath: "kitchen-ocr-v1",
      logger: (message) => {
        if (!controller.signal.aborted && message.status === "recognizing text")
          progress(Math.round(message.progress * 100));
      },
    });
    if (controller.signal.aborted) {
      await created.terminate();
      throw new Error("Распознавание отменено.");
    }
    worker = created;
    return created;
  };
  try {
    if (controller.signal.aborted) throw new Error("Распознавание отменено.");
    const ready = await Promise.race([initialize(), cancelled]);
    const { data } = await Promise.race([ready.recognize(photo), cancelled]);
    if (!data.text.trim())
      throw new Error(
        "Текст не найден. Выберите чёткое фото страницы с рецептом.",
      );
    if (data.text.length > 20000)
      throw new Error(
        "Слишком много текста. Выберите меньший фрагмент страницы.",
      );
    return data.text;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    if (worker) await worker.terminate();
  }
}
