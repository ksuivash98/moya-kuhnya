export type ProteinProduct = {
  key: string;
  rawName: string;
  purchaseName: string;
  cooked: boolean;
  category: "Мясо" | "Рыба";
};
/** Purchasing equivalents; composite dishes and different cuts are kept distinct. */
export function proteinProduct(name: string): ProteinProduct | undefined {
  const text = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const [main, ...purposeParts] = text.split(/\s+для\s+/);
  const purpose = purposeParts.join(" ");
  const words = main
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  const has = (pattern: RegExp) => pattern.test(text);
  const make = (
    key: string,
    rawName: string,
    purchaseName: string,
    cooked = false,
    category: "Мясо" | "Рыба" = "Мясо",
  ) => ({ key, rawName, purchaseName, cooked, category });
  if (/^(куриный суповой набор|каркас курицы|куриный каркас)$/.test(main))
    return make("chicken-broth", "Курица для бульона", "Курица для бульонов");
  const allWords = text
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (
    allWords.includes("для") &&
    allWords.includes("филе") &&
    allWords.some((w) => /^(куриц|курин)/.test(w)) &&
    allWords.every((w) =>
      /^(куриц[аыу]|курин(?:ый|ая|ое|ые|ого|ой|ую|ых)|филе|для|блюд|салатов|салата|и)$/.test(
        w,
      ),
    )
  )
    return make(
      "chicken-fillet",
      "Куриное филе",
      "Куриное филе для блюд и салатов",
    );
  const chicken = words.some((w) => /^(куриц|курин)/.test(w));
  if (chicken) {
    if (
      words.some((w) =>
        /^(жарен|запечен|копчен|тушен|котлет|суп|салат|соус|бульон)/.test(w),
      )
    )
      return undefined;
    const boiled = words.some((w) => /^(отвар|варен)/.test(w));
    const allowed = words.every((w) =>
      /^(куриц[аыу]|курин(?:ый|ая|ое|ые|ого|ой|ую|ых)|филе|грудк[аи]|мяс[оа]|отварн(?:ое|ая|ый|ые|ого)|варен(?:ое|ая|ый|ые|ого)|без|и|кожи|кости|костей|косточек|сыр(?:ой|ая|ое|ые)|свеж[а-я]+)$/.test(
        w,
      ),
    );
    if (boiled && allowed)
      return make(
        "chicken-fillet",
        "Куриное филе",
        "Куриное филе для блюд и салатов",
        true,
      );
    if (
      !boiled &&
      allowed &&
      (words.includes("филе") ||
        (words.some((w) => ["грудка", "грудки"].includes(w)) &&
          words.includes("без") &&
          words.some((w) => ["кости", "костей", "косточек"].includes(w))))
    )
      return make(
        "chicken-fillet",
        "Куриное филе",
        "Куриное филе для блюд и салатов",
      );
    if (
      !boiled &&
      allowed &&
      /бульон|борщ|суп/.test(purpose) &&
      !words.includes("филе")
    )
      return make("chicken-broth", "Курица для бульона", "Курица для бульонов");
  }
  if (/^свинин[аы]$/.test(main)) {
    if (/отбивн/.test(purpose))
      return make("pork-chops", "Свинина для отбивных", "Свинина для отбивных");
    if (/бульон|борщ|суп/.test(purpose))
      return make(
        "pork-broth",
        "Свинина для бульона",
        "Свинина для бульона и борща",
      );
  }
  if (/^говядин[аы]$/.test(main) && /бульон|борщ|суп/.test(purpose))
    return make(
      "beef-broth",
      "Говядина для бульона",
      "Говядина для бульона и борща",
    );
  if (/^(фарш( мясной)?|мясной фарш)$/.test(main))
    return make(
      "minced-meat",
      "Фарш мясной",
      "Фарш мясной для голубцов, котлет и фрикаделек",
    );
  if (!has(/жарен|варен|копчен|консерв|суп|салат/)) {
    for (const [key, variants, rawName, purchaseName] of [
      ["pollock-fillet", ["минтай", "минтая"], "Филе минтая", "Минтай филе"],
      ["salmon-fillet", ["семга", "семги"], "Филе сёмги", "Сёмга филе"],
    ] as const)
      if (
        words.includes("филе") &&
        words.some((w) => (variants as readonly string[]).includes(w)) &&
        words.every(
          (w) => w === "филе" || (variants as readonly string[]).includes(w),
        )
      )
        return make(key, rawName, purchaseName, false, "Рыба");
    if (
      words.some((w) => ["форель", "форели"].includes(w)) &&
      words.some((w) => ["стейк", "стейки"].includes(w)) &&
      words.every((w) => ["форель", "форели", "стейк", "стейки"].includes(w))
    )
      return make(
        "trout-steaks",
        "Стейки форели",
        "Форель стейки",
        false,
        "Рыба",
      );
  }
}
