import { fmt } from "./model";
type NamedUnit = { name: string; unit: string };
const measures: Record<string, { kind: "mass" | "volume"; scale: number }> = {
  г: { kind: "mass", scale: 1 },
  кг: { kind: "mass", scale: 1000 },
  мл: { kind: "volume", scale: 1 },
  л: { kind: "volume", scale: 1000 },
  чл: { kind: "volume", scale: 5 },
  стл: { kind: "volume", scale: 15 },
};
const measure = (unit: string) =>
  measures[unit.toLowerCase().replace(/[\s.]/g, "")];
// Approximate bulk densities for level measuring spoons (5 ml / 15 ml).
// Only named, recognised foods qualify for a mass/volume conversion.
function food(name: string): { key: string; density: number } | undefined {
  const words = name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  const matches = (main: string, allowed: string[]) =>
    words.includes(main) &&
    words.every((w) => allowed.includes(w) || /^\d+$/.test(w));
  if (
    matches("соль", [
      "соль",
      "поваренная",
      "мелкая",
      "пищевая",
      "йодированная",
      "экстра",
    ])
  )
    return { key: "salt", density: 1.2 };
  if (matches("сахар", ["сахар", "песок", "белый"]))
    return { key: "sugar", density: 0.8 };
  if (
    matches("мука", ["мука", "пшеничная", "высший", "высшего", "сорт", "сорта"])
  )
    return { key: "flour", density: 0.6 };
  if (
    words.some((word) =>
      ["растительное", "подсолнечное", "оливковое"].includes(word),
    ) &&
    matches("масло", [
      "масло",
      "растительное",
      "подсолнечное",
      "оливковое",
      "рафинированное",
      "нерафинированное",
      "дезодорированное",
    ])
  )
    return { key: "oil", density: 0.92 };
  if (matches("вода", ["вода", "питьевая", "фильтрованная", "кипяченая"]))
    return { key: "water", density: 1 };
  if (
    matches("молоко", [
      "молоко",
      "коровье",
      "пастеризованное",
      "ультрапастеризованное",
      "цельное",
      "обезжиренное",
    ])
  )
    return { key: "milk", density: 1.03 };
  if (matches("мед", ["мед", "жидкий", "натуральный"]))
    return { key: "honey", density: 1.4 };
}
export function automaticConversion(need: NamedUnit, source: NamedUnit) {
  const target = measure(need.unit),
    actual = measure(source.unit);
  if (!target || !actual) return undefined;
  let ratio: number;
  if (target.kind === actual.kind) ratio = actual.scale / target.scale;
  else {
    const wanted = food(need.name),
      available = food(source.name);
    if (!wanted || !available || wanted.key !== available.key) return undefined;
    const weight = (unit: typeof target) =>
      unit.scale * (unit.kind === "volume" ? wanted.density : 1);
    ratio = weight(actual) / weight(target);
  }
  const reverse = target.kind === "volume" && actual.kind === "mass";
  return {
    ratio,
    description: reverse
      ? `1 ${need.unit} ≈ ${fmt(1 / ratio)} ${source.unit}`
      : `1 ${source.unit} ≈ ${fmt(ratio)} ${need.unit}`,
    approximate:
      target.kind !== actual.kind ||
      ["чл", "стл"].includes(need.unit.replace(/[\s.]/g, "")) ||
      ["чл", "стл"].includes(source.unit.replace(/[\s.]/g, "")),
  };
}
/** Preferred physical unit for buying or recording a converted quantity. */
export function automaticBaseUnit(
  name: string,
  unit: string,
): string | undefined {
  if (!measure(unit)) return undefined;
  return food(name) ? "г" : measure(unit)!.kind === "mass" ? "г" : "мл";
}
export const isSpoon = (unit: string) =>
  ["чл", "стл"].includes(unit.replace(/[\s.]/g, ""));
