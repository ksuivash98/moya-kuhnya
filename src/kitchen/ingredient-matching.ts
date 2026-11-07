import { vegetableName } from "./vegetable-names";
import { automaticConversion } from "./unit-conversion";
import {
  base,
  factor,
  num,
  rows,
  str,
  today,
  type Need,
  type State,
} from "./model";

const aliases: Record<string, string> = {
  картошка: "картофель",
  картошки: "картофель",
  картофеля: "картофель",
  моркови: "морковь",
  свеклы: "свекла",
  лука: "лук",
  репчатого: "репчатый",
  репчатая: "репчатый",
  яйца: "яйцо",
  яиц: "яйцо",
  яйцами: "яйцо",
  куриный: "курица",
  куриная: "курица",
  куриное: "курица",
  куриные: "курица",
  куриного: "курица",
  курицы: "курица",
  мяса: "мясо",
  бульона: "бульон",
  лапши: "лапша",
  яичная: "яичный",
  яичную: "яичный",
  яичного: "яичный",
  отварной: "вареный",
  отварная: "вареный",
  отварное: "вареный",
  отварный: "вареный",
  отварные: "вареный",
  вареная: "вареный",
  вареное: "вареный",
  вареные: "вареный",
  готовая: "готовый",
  готовое: "готовый",
  готовые: "готовый",
  сухая: "сухой",
  сухое: "сухой",
  сухие: "сухой",
  лавр: "лавровый лист",
  соли: "соль",
  сахара: "сахар",
  муки: "мука",
  меда: "мед",
  молока: "молоко",
  воды: "вода",
};
// Shape and ordinary durum-wheat descriptions identify the same dry product.
// Cooking state, fillings and special flours stay part of the identity.
function plainPasta(name: string) {
  const words = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  const allowed = new Set([
    "макароны",
    "макарон",
    "из",
    "твердых",
    "твердые",
    "сортов",
    "сорта",
    "пшеницы",
    "рожки",
    "спирали",
    "перья",
    "или",
    "и",
    "сухие",
    "сухой",
  ]);
  return (
    words.some((w) => w === "макароны" || w === "макарон") &&
    words.every((w) => allowed.has(w))
  );
}
function ordinaryDairy(name: string): string | undefined {
  const cleaned = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\(\s*по желанию\s*\)/g, "")
    .replace(
      /\(\s*\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?)?\s*(?:г|гр|мл)\s*\)/g,
      "",
    )
    .replace(/\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/g, "")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/);
  for (const [title, main] of [
    ["Сметана", "сметана"],
    ["Сливки", "сливки"],
    ["Молоко", "молоко"],
    ["Кефир", "кефир"],
    ["Творог", "творог"],
  ]) {
    if (
      words.includes(main) &&
      words.every(
        (w) =>
          [
            main,
            "жирность",
            "жирности",
            "по",
            "желанию",
            "г",
            "гр",
            "мл",
          ].includes(w) || /^\d+$/.test(w),
      )
    )
      return title;
  }
  if (
    words.includes("сыр") &&
    words.includes("твердый") &&
    words.every((w) =>
      [
        "сыр",
        "твердый",
        "российский",
        "гауда",
        "или",
        "и",
        "по",
        "желанию",
      ].includes(w),
    )
  )
    return "Твёрдый сыр";
  if (
    words.includes("масло") &&
    words.includes("сливочное") &&
    words.every((w) =>
      ["масло", "сливочное", "для", "формочек", "формы", "форм"].includes(w),
    )
  )
    return "Сливочное масло";
}
export function ingredientDisplayName(name: string): string {
  const display = name
    .replace(
      /\s+(?:\(\s*)?для\s+(?:зажарки|обжарки|жарки|подачи|смазывания(?:\s+(?:формы|сковороды))?|тушения)\s*\)?\s*$/iu,
      "",
    )
    .replace(/[,\s]+$/u, "")
    .trim();
  return (
    vegetableName(display) ??
    ordinaryDairy(display) ??
    (plainPasta(display) ? "Макароны" : display)
  );
}
export function ingredientName(name: string): string {
  let words = ingredientDisplayName(name)
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .flatMap((word) => (aliases[word] ?? word).split(" "));
  if (words.includes("курица")) words = words.filter((w) => w !== "мясо");
  if (words.length === 1 && words[0] === "лук") words.push("репчатый");
  return [...new Set(words.filter(Boolean))].sort().join(" ");
}
export type InventorySource = {
  id: string;
  name: string;
  kind: "product" | "preparation";
  quantity: number;
  unit: string;
  expires: string;
};
export type IngredientChoice = {
  sourceId: string;
  ratio?: number;
  allowPreparationSubstitution?: boolean;
};
export type IngredientChoices = Record<string, IngredientChoice>;
export const ingredientKey = (need: Need) =>
  `${need.name.trim().toLocaleLowerCase("ru")}|${need.unit}`;

export function inventorySources(
  state: State,
  family: string,
): InventorySource[] {
  const sources = new Map<string, InventorySource>();
  const products = new Map(
    rows(state, "products")
      .filter((p) => p.family_id === family && !p.archived)
      .map((p) => [p.id, p]),
  );
  for (const batch of rows(state, "stock_batches")) {
    const product = products.get(String(batch.product_id));
    if (
      !product ||
      batch.family_id !== family ||
      num(batch, "quantity") <= 0 ||
      (batch.expires_on && str(batch, "expires_on") < today())
    )
      continue;
    const unit = base(str(batch, "unit"));
    const id = `product:${product.id}:${unit}`;
    const source: InventorySource = sources.get(id) ?? {
      id,
      name: str(product, "name"),
      kind: "product",
      quantity: 0,
      unit,
      expires: "9999-12-31",
    };
    source.quantity += num(batch, "quantity") * factor(str(batch, "unit"));
    source.expires = [
      source.expires,
      str(batch, "expires_on") || "9999-12-31",
    ].sort()[0];
    sources.set(id, source);
  }
  for (const prep of rows(state, "preparations")) {
    if (
      prep.family_id !== family ||
      num(prep, "quantity") <= 0 ||
      (prep.expires_on && str(prep, "expires_on") < today())
    )
      continue;
    const id = `preparation:${prep.id}`;
    sources.set(id, {
      id,
      name: str(prep, "title"),
      kind: "preparation",
      quantity: num(prep, "quantity") * factor(str(prep, "unit")),
      unit: base(str(prep, "unit")),
      expires: str(prep, "expires_on") || "9999-12-31",
    });
  }
  return [...sources.values()]
    .filter((s) => Number.isFinite(s.quantity) && s.quantity > 0)
    .sort(
      (a, b) =>
        a.expires.localeCompare(b.expires) ||
        a.name.localeCompare(b.name, "ru") ||
        a.id.localeCompare(b.id),
    );
}
export function automaticMatch(need: Need, source: InventorySource): boolean {
  if (sourceRatio(need, source) === undefined) return false;
  const wanted = ingredientName(need.name),
    actual = ingredientName(source.name);
  if (!wanted || !actual) return false;
  if (wanted === actual) return true;
  // A preparation is already prepared. Broth measured in ml is not dry concentrate.
  if (
    (source.kind === "preparation" && wanted.split(" ").includes("готовый")) ||
    (need.unit === "мл" && wanted.split(" ").includes("бульон"))
  ) {
    const withoutReady = (s: string) =>
      s
        .split(" ")
        .filter((w) => w !== "готовый")
        .join(" ");
    return withoutReady(wanted) === withoutReady(actual);
  }
  return false;
}
export function similarity(name: string, other: string): number {
  const a = ingredientName(name),
    b = ingredientName(other);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wordsA = new Set(a.split(" ")),
    wordsB = new Set(b.split(" "));
  const common = [...wordsA].filter((w) => wordsB.has(w)).length;
  const wordScore =
    common === wordsA.size ? 0.85 : common / Math.max(wordsA.size, wordsB.size);
  const grams = (s: string) =>
    new Set(
      Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
        s.slice(i, i + 3),
      ),
    );
  const ga = grams(a),
    gb = grams(b);
  const letterScore =
    ga.size + gb.size
      ? (2 * [...ga].filter((g) => gb.has(g)).length) / (ga.size + gb.size)
      : 0;
  return Math.min(0.95, Math.max(wordScore, letterScore * 0.8));
}
export type MatchedNeed = Need & {
  matchedSources: InventorySource[];
  suggestions: InventorySource[];
  unavailable: boolean;
  conversionRequired: boolean;
  sourceMismatch: boolean;
};
export function matchIngredients(
  needs: Need[],
  sources: InventorySource[],
  choices: IngredientChoices,
): MatchedNeed[] {
  const remaining = new Map(sources.map((s) => [s.id, s.quantity]));
  return needs
    .filter((n) => n.quantity > 0)
    .map((need) => {
      const choice = ingredientChoice(choices, need);
      const chosen = choice
        ? sources.find((s) => s.id === choice.sourceId)
        : undefined;
      const sourceMismatch = !!chosen && !sourceAccepted(need, chosen, choice);
      const conversionRequired =
        !!chosen && conversionNeeded(need, chosen, choice?.ratio);
      const selected = choice
        ? sourceMismatch
          ? sources.filter(
              (s) =>
                automaticMatch(need, s) && sourceMatchesIngredient(need, s),
            )
          : chosen && !conversionRequired
            ? [chosen]
            : []
        : sources.filter((s) => automaticMatch(need, s));
      const ratioFor = (source: InventorySource) =>
        sourceRatio(
          need,
          source,
          source.id === choice?.sourceId && !sourceMismatch
            ? choice.ratio
            : undefined,
        )!;
      const available = selected.reduce(
        (sum, source) =>
          sum + (remaining.get(source.id) ?? 0) * ratioFor(source),
        0,
      );
      let pending = Math.min(need.quantity, available);
      for (const source of selected) {
        const ratio = ratioFor(source);
        const amount = Math.min(remaining.get(source.id) ?? 0, pending / ratio);
        remaining.set(
          source.id,
          Math.max(0, (remaining.get(source.id) ?? 0) - amount),
        );
        pending = Math.max(0, pending - amount * ratio);
      }
      return {
        ...need,
        available,
        missing: Math.max(0, need.quantity - available),
        matchedSources: selected,
        sourceMismatch,
        suggestions: sources
          .filter((source) => sourceMatchesIngredient(need, source))
          .map((source) => ({
            source,
            score: similarity(need.name, source.name),
          }))
          .filter((s) => s.score >= 0.3)
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.source.name.localeCompare(b.source.name, "ru"),
          )
          .map((s) => s.source),
        unavailable: !!choice && choice.sourceId !== "none" && !chosen,
        conversionRequired,
      };
    });
}

// One confirmed correspondence is reused for spelling variants and word order.
export function ingredientRuleKey(need: Pick<Need, "name" | "unit">): string {
  let name = ingredientName(need.name);
  if (need.unit === "мл" && name.split(" ").includes("бульон"))
    name = name
      .split(" ")
      .filter((w) => w !== "готовый")
      .join(" ");
  return `rule:${name}|${need.unit}`;
}
// Older rule keys contain alphabetically sorted purpose words.
function storedIngredientRule(
  key: string,
  expected: string,
): string | undefined {
  const separator = key.lastIndexOf("|");
  if (separator < 0) return undefined;
  let name = key.slice(0, separator).replace(/^rule:/, "");
  const original = ingredientRuleKey({ name, unit: key.slice(separator + 1) });
  if (original === expected) return original;
  if (key.startsWith("rule:")) {
    const words = name.split(" ");
    const purpose = words.find((word) =>
      [
        "зажарки",
        "обжарки",
        "жарки",
        "подачи",
        "смазывания",
        "тушения",
      ].includes(word),
    );
    if (words.includes("для") && purpose)
      name = words
        .filter(
          (word) =>
            word !== "для" &&
            word !== purpose &&
            !(
              purpose === "смазывания" && ["формы", "сковороды"].includes(word)
            ),
        )
        .join(" ");
  }
  return ingredientRuleKey({ name, unit: key.slice(separator + 1) });
}
export function ingredientChoice(
  choices: IngredientChoices,
  need: Need,
): IngredientChoice | undefined {
  const direct =
    choices[ingredientRuleKey(need)] ?? choices[ingredientKey(need)];
  if (direct) return direct;
  const key = ingredientRuleKey(need);
  let found: IngredientChoice | undefined;
  for (const [old, choice] of Object.entries(choices)) {
    if (storedIngredientRule(old, key) !== key) continue;
    if (
      found &&
      (found.sourceId !== choice.sourceId ||
        found.ratio !== choice.ratio ||
        !!found.allowPreparationSubstitution !==
          !!choice.allowPreparationSubstitution)
    )
      return undefined;
    found = choice;
  }
  return found;
}
export function setIngredientChoice(
  choices: IngredientChoices,
  need: Need,
  choice?: IngredientChoice,
): IngredientChoices {
  const key = ingredientRuleKey(need),
    next = { ...choices };
  for (const old of Object.keys(next)) {
    if (storedIngredientRule(old, key) === key) delete next[old];
  }
  if (choice) next[key] = choice;
  return next;
}
export function automaticSourceConversion(
  need: Pick<Need, "name" | "unit">,
  source: Pick<InventorySource, "name" | "unit">,
) {
  return automaticConversion(
    { ...need, name: ingredientName(need.name) },
    { ...source, name: ingredientName(source.name) },
  );
}
export function sourceRatio(
  need: Pick<Need, "name" | "unit">,
  source: Pick<InventorySource, "name" | "unit">,
  ratio?: number,
): number | undefined {
  if (need.unit === source.unit) return 1;
  if (ratio !== undefined)
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  return automaticSourceConversion(need, source)?.ratio;
}
export function conversionNeeded(
  need: Need,
  source: InventorySource,
  ratio?: number,
): boolean {
  const resolved = sourceRatio(need, source, ratio);
  return resolved === undefined || !Number.isFinite(source.quantity * resolved);
}

function canPropose(need: Need, source: InventorySource): boolean {
  if (!sourceMatchesIngredient(need, source)) return false;
  const wanted = ingredientName(need.name).split(" "),
    actual = ingredientName(source.name).split(" ");
  const states = (words: string[]) =>
    words.filter(
      (w) =>
        w === "сухой" ||
        /^(варен|жарен|сырой|сырая|сырое|копчен|консервирован)/.test(w),
    );
  const wantedStates = states(wanted),
    actualStates = states(actual);
  if (
    wantedStates.some(
      (w) =>
        !actualStates.includes(w) &&
        !(w === "сухой" && source.kind === "product" && !actualStates.length),
    )
  )
    return false;
  if (actualStates.some((w) => !wantedStates.includes(w))) return false;
  const proteins = ["курица", "индейка", "говядина", "свинина", "рыба"];
  if (wanted.some((w) => proteins.includes(w) && !actual.includes(w)))
    return false;
  if (
    source.kind === "preparation" &&
    !wantedStates.length &&
    !wanted.includes("готовый") &&
    !wanted.includes("бульон") &&
    ingredientName(need.name) !== ingredientName(source.name)
  )
    return false;
  return true;
}
export type BulkIngredientSuggestion = {
  need: MatchedNeed;
  choice?: IngredientChoice;
};
export function bulkIngredientSuggestions(
  needs: MatchedNeed[],
  sources: InventorySource[],
  choices: IngredientChoices,
): BulkIngredientSuggestion[] {
  const seen = new Set<string>();
  const result: BulkIngredientSuggestion[] = [];
  for (const need of needs) {
    const key = ingredientRuleKey(need),
      current = ingredientChoice(choices, need);
    if (seen.has(key)) continue;
    if (
      current &&
      !need.unavailable &&
      !need.conversionRequired &&
      !need.sourceMismatch
    )
      continue;
    if (!current && need.matchedSources.length) continue;
    if (current && !need.unavailable && !need.sourceMismatch) {
      seen.add(key);
      result.push({ need, choice: current });
      continue;
    }
    const ranked = sources
      .filter((s) => canPropose(need, s))
      .map((source) => ({ source, score: similarity(need.name, source.name) }))
      .filter((s) => s.score >= 0.45)
      .sort(
        (a, b) =>
          b.score - a.score || a.source.name.localeCompare(b.source.name, "ru"),
      );
    const best = ranked[0],
      second = ranked[1];
    const confident = best && (!second || best.score - second.score >= 0.12);
    seen.add(key);
    result.push({
      need,
      choice: confident ? { sourceId: best.source.id } : undefined,
    });
  }
  return result.map((item) => ({
    ...item,
    need: {
      ...item.need,
      quantity: needs
        .filter((n) => ingredientRuleKey(n) === ingredientRuleKey(item.need))
        .reduce((sum, n) => sum + n.quantity, 0),
    },
  }));
}

export function sourceMatchesIngredient(
  need: Need,
  source: InventorySource,
): boolean {
  const terms = (name: string) =>
    ingredientName(name.split(/\sдля\s/i)[0]).split(" ");
  const wanted = terms(need.name),
    actual = terms(source.name);
  const dishes = [
    "бульон",
    "суп",
    "салат",
    "соус",
    "пюре",
    "фарш",
    "тесто",
    "каша",
    "котлеты",
    "котлета",
    "запеканка",
    "рагу",
    "плов",
  ];
  if (dishes.some((word) => actual.includes(word) && !wanted.includes(word)))
    return false;
  const proteins = ["курица", "говядина", "свинина", "рыба", "индейка"];
  const wp = wanted.find((w) => proteins.includes(w)),
    ap = actual.find((w) => proteins.includes(w));
  if (wp && ap && wp !== ap) return false;
  if (
    wanted.includes("сухой") &&
    actual.some((w) => /^(варен|жарен|готов)/.test(w))
  )
    return false;
  if (
    wanted.includes("вареный") &&
    source.kind === "product" &&
    !actual.includes("вареный")
  )
    return false;
  if (source.kind === "preparation") {
    const ignored = new Set([
      "готовый",
      "вареный",
      "мясо",
      "литр",
      "литра",
      "литров",
      "мл",
      "л",
      "г",
      "кг",
      "порция",
      "порции",
      "порций",
    ]);
    const core = (words: string[]) =>
      words.filter((w) => w && !ignored.has(w) && !/^\d+$/.test(w));
    if (!core(wanted).some((w) => core(actual).includes(w))) return false;
  }
  return true;
}

/** Only an explicit choice can override the name/state check for a preparation. */
export function sourceAccepted(
  need: Need,
  source: InventorySource,
  choice?: IngredientChoice,
): boolean {
  return (
    sourceMatchesIngredient(need, source) ||
    (source.kind === "preparation" &&
      choice?.sourceId === source.id &&
      choice.allowPreparationSubstitution === true)
  );
}
