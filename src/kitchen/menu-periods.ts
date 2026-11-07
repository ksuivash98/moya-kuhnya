import { monthRange, str, type Row } from "./model";

export function menuOverlaps(row: Row, from: string, to: string) {
  const start = str(row, "period_start");
  const end = str(row, "period_end");
  if (start && end) return start <= to && end >= from;
  const date = str(row, "date");
  return !!date && date >= from && date <= to;
}
export function menuOnDate(row: Row, date: string) {
  return menuOverlaps(row, date, date);
}
export function menuInMonth(row: Row, month: string) {
  const range = monthRange(month);
  return str(row, "period_start")
    ? menuOverlaps(row, range.from, range.to)
    : str(row, "month") === range.from;
}
export function menuDateLabel(row: Row) {
  return str(row, "period_start")
    ? `${str(row, "period_start")} — ${str(row, "period_end")}`
    : str(row, "date") || "без даты";
}
