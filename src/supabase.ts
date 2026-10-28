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
  return msg;
}
