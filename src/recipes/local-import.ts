import {
  validateExtraction,
  type ExtractedRecipe,
} from "../../supabase/functions/_shared/recipe-import";

const unitPattern =
  "(?:кг|килограмм(?:а|ов)?|грамм(?:а|ов)?|гр\\.?|г|мл|миллилитр(?:а|ов)?|литр(?:а|ов)?|л|шт\\.?|штук[аи]?|ст\\.?\\s*л\\.?|ч\\.?\\s*л\\.?|столов(?:ая|ые|ых)\\s+лож(?:ка|ки|ек)|чайн(?:ая|ые|ых)\\s+лож(?:ка|ки|ек)|стакан(?:а|ов)?|упаковк[аи]?)";
const numberPattern = "(?:(?:\\d+\\s+)?\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?)";
const quantityPattern = `(?<amount>${numberPattern}(?:\\s*[-–—]\\s*${numberPattern})?)\\s*(?<unit>${unitPattern})(?=\\s|$|[,;—–-])`;
const fractions: Record<string, string> = {
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
function normalize(line: string) {
  return line
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(
      /(\d)?([½¼¾⅓⅔⅛⅜⅝⅞])/g,
      (_, whole: string | undefined, fraction: string) =>
        `${whole ? whole + " " : ""}${fractions[fraction]}`,
    );
}
function unit(raw: string) {
  const s = raw.toLowerCase().replace(/[.\s]/g, "");
  if (s.startsWith("к")) return "кг";
  if (s.startsWith("г")) return "г";
  if (/^(мл|милли)/.test(s)) return "мл";
  if (s.startsWith("л")) return "л";
  if (s.startsWith("шт")) return "шт.";
  if (s === "стл" || s.startsWith("столов")) return "ст. л.";
  if (s === "чл" || s.startsWith("чайн")) return "ч. л.";
  if (s.startsWith("стак")) return "стакан";
  return "упаковка";
}
function amountValue(raw: string): string | null {
  if (/[-–—]/.test(raw)) return null;
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(raw);
  let value: number;
  if (fraction) {
    const denominator = Number(fraction[3]);
    if (!denominator) return null;
    value = Number(fraction[1] ?? 0) + Number(fraction[2]) / denominator;
  } else value = Number(raw.replace(",", "."));
  // Never round a repeating fraction or silently choose a range endpoint.
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1e9 ||
    Math.abs(value * 10000 - Math.round(value * 10000)) > 1e-6
  )
    return null;
  return String(Number(value.toFixed(4)));
}
function ingredient(raw: string): ExtractedRecipe["ingredients"][number] {
  const line = normalize(raw.replace(/^\d+[.)]\s+/, ""));
  const match = new RegExp(quantityPattern, "iu").exec(line);
  if (match?.groups && !/[\d/.,-]$/.test(line.slice(0, match.index))) {
    const name = (
      line.slice(0, match.index) + line.slice(match.index + match[0].length)
    ).replace(/^[\s:—–-]+|[\s:—–-]+$/g, "");
    if (name) {
      const amount = amountValue(match.groups.amount);
      return {
        name: name.slice(0, 200),
        amount,
        unit: unit(match.groups.unit),
        note: !amount || raw.length > 200 ? raw.slice(0, 2000) : "",
      };
    }
  }
  const taste = /\s*[-—–:]?\s*по вкусу\s*$/i;
  return {
    name: line.replace(taste, "").trim().slice(0, 200) || line.slice(0, 200),
    amount: null,
    unit: taste.test(line) ? "по вкусу" : null,
    note: raw.slice(0, 2000),
  };
}
export function parseRecipeText(source: string): ExtractedRecipe {
  if (!source.trim() || source.length > 20000)
    throw new Error("Введите текст рецепта длиной до 20 000 символов.");
  const lines = source
    .replace(/\r/g, "")
    .replace(
      /^(ингредиенты|состав|способ приготовления|приготовление)[ \t]*:[ \t]*(.+)$/gim,
      (all, heading: string, rest: string) =>
        /^\d+\s*мин/i.test(rest) ? all : `${heading}:\n${rest}`,
    )
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
    const instruction =
      /^(смеша|добавьте|обжар|нареж|взбей|выпека|варите|варить|перемеша|разогре|запека)/i.test(
        line,
      );
    if (
      section !== "steps" &&
      !instruction &&
      (section === "ingredients" ||
        new RegExp(quantityPattern, "iu").test(normalize(line)) ||
        /по вкусу$/i.test(line))
    ) {
      result.ingredients.push(ingredient(line));
      continue;
    }
    if (section === "steps" || /^\d+[.)]\s+/.test(line) || instruction) {
      section = "steps";
      result.steps.push(line.replace(/^\d+[.)]\s+/, ""));
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
  const uncertain = result.ingredients.filter(
    (i) => i.amount === null && i.unit !== "по вкусу",
  );
  if (uncertain.length)
    result.warnings.push(
      `Проверьте количество: ${uncertain
        .map((i) => i.name)
        .join(", ")
        .slice(
          0,
          850,
        )}. Диапазоны и неточные дроби не подставляются автоматически.`,
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
