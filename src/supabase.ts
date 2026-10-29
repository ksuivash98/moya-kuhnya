import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(
  url &&
    /^https:\/\/.+\.supabase\.(co|in)$/.test(url) &&
    key &&
    !url.includes("YOUR_PROJECT"),
);
export const supabase = configured ? createClient(url!, key!) : null;
export function client() {
  if (!supabase) throw new Error("Подключите Supabase по инструкции в README.");
  return supabase;
}
export function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
export const roleNames: Record<string, string> = {
  owner: "Владелец",
  adult: "Взрослый",
  child: "Ребёнок",
};
export function errorText(error: unknown): string {
  const msg =
    error instanceof Error ? error.message : "Не удалось выполнить действие.";
  if (/Invalid login credentials/.test(msg))
    return "Неверный адрес почты или пароль.";
  if (/Email not confirmed/.test(msg))
    return "Подтвердите почту по ссылке из письма.";
  if (/rate limit/i.test(msg))
    return "Слишком много запросов. Попробуйте немного позже.";
  if (/fetch|network/i.test(msg))
    return "Нет связи с сервером. Проверьте интернет и настройки Supabase.";
  if (/duplicate key|unique constraint/i.test(msg))
    return "Такая запись уже существует. Обновите данные или измените название.";
  if (
    /violates check constraint|not-null constraint|invalid input syntax/i.test(
      msg,
    )
  )
    return "Проверьте обязательные поля, даты, количества и единицы измерения.";
  if (
    /could not find.*function|schema cache|relation .*does not exist/i.test(msg)
  )
    return "Раздел ещё не подключён к базе. Примените новые SQL-миграции по инструкции проекта.";
  if (
    /permission denied|row-level security|jwt expired|invalid refresh token/i.test(
      msg,
    )
  )
    return "Недостаточно прав или сессия устарела. Проверьте семейный доступ и войдите заново.";
  if (/could not be decoded|source image/i.test(msg))
    return "Не удалось прочитать фотографию. Выберите другой файл JPEG, PNG или WebP.";
  return msg;
}
