const fresh = new Set([
  "свежий",
  "свежая",
  "свежие",
  "свежее",
  "сырой",
  "сырая",
  "сырые",
]);
const forms: Record<string, string> = {
  моркови: "морковь",
  морковка: "морковь",
  морковки: "морковь",
  лука: "лук",
  репчатого: "репчатый",
  зеленого: "зеленый",
  чеснока: "чеснок",
  зубчик: "зубчики",
  зубчиков: "зубчики",
  зубка: "зубчики",
  зубков: "зубчики",
  картошка: "картофель",
  картошки: "картофель",
  картофеля: "картофель",
  огурец: "огурцы",
  огурца: "огурцы",
  огурцов: "огурцы",
  помидор: "помидоры",
  помидора: "помидоры",
  помидоров: "помидоры",
  томаты: "помидоры",
  томат: "помидоры",
  свеклы: "свекла",
  кабачки: "кабачок",
  кабачка: "кабачок",
};
/** Only fresh/raw synonyms; cooking states and vegetable varieties are retained. */
export function vegetableName(name: string): string | undefined {
  const words = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => forms[w] ?? w)
    .filter((w) => !fresh.has(w));
  const matches = (main: string, allowed: string[]) =>
    words.includes(main) && words.every((w) => allowed.includes(w));
  for (const [main, title] of [
    ["морковь", "Морковь"],
    ["картофель", "Картофель"],
    ["огурцы", "Огурцы"],
    ["помидоры", "Помидоры"],
    ["свекла", "Свёкла"],
    ["кабачок", "Кабачок"],
  ])
    if (matches(main, [main])) return title;
  if (matches("чеснок", ["чеснок", "зубчики"])) return "Чеснок";
  if (matches("лук", ["лук", "репчатый"])) return "Репчатый лук";
  if (words.includes("зеленый") && matches("лук", ["лук", "зеленый"]))
    return "Зелёный лук";
  if (words.includes("болгарский") && matches("перец", ["перец", "болгарский"]))
    return "Болгарский перец";
  for (const [kind, title] of [
    ["белокочанная", "Белокочанная капуста"],
    ["цветная", "Цветная капуста"],
  ])
    if (words.includes(kind) && matches("капуста", ["капуста", kind]))
      return title;
}
/** Approximate medium-size references; garlic pieces mean cloves, not whole heads. */
export function vegetablePieceWeight(name: string) {
  const title = vegetableName(name);
  if (title === "Морковь")
    return {
      name: title,
      grams: 100,
      description: "1 средняя морковь ≈ 100 г",
    };
  if (title === "Репчатый лук")
    return {
      name: title,
      grams: 150,
      description: "1 средняя луковица ≈ 150 г",
    };
  if (title === "Чеснок")
    return {
      name: title,
      grams: 5,
      description: "1 шт. чеснока — зубчик ≈ 5 г",
    };
}
