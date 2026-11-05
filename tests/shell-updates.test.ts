import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { watchShellUpdates, reloadShellWhenSafe } from "../src/shell-updates";
let win: EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };
let doc: EventTarget & {
  visibilityState: string;
  querySelector: ReturnType<typeof vi.fn>;
  activeElement: { matches: () => boolean } | null;
};
let connection: { onLine: boolean };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  win = Object.assign(new EventTarget(), {
    setInterval,
    clearInterval,
    location: { reload: vi.fn() },
  });
  doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    querySelector: vi.fn(() => null),
    activeElement: null,
  });
  connection = { onLine: true };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", connection);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("открытая вкладка проверяет обновления при возвращении и раз в минуту, пропуская офлайн и скрытый экран", async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  stop = watchShellUpdates({ update } as unknown as ServiceWorkerRegistration);
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledTimes(1);
  win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledTimes(2);
  doc.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(60000);
  expect(update).toHaveBeenCalledTimes(2);
  doc.visibilityState = "visible";
  connection.onLine = false;
  win.dispatchEvent(new Event("online"));
  expect(update).toHaveBeenCalledTimes(2);
  connection.onLine = true;
  update.mockRejectedValueOnce(new Error("offline"));
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60000);
  expect(update).toHaveBeenCalledTimes(4);
  stop();
  stop = undefined;
  win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(update).toHaveBeenCalledTimes(4);
});
test("новая версия не перезагружает открытую форму или поле ввода", async () => {
  doc.querySelector.mockReturnValue({});
  reloadShellWhenSafe();
  await vi.advanceTimersByTimeAsync(2000);
  expect(win.location.reload).not.toHaveBeenCalled();
  doc.querySelector.mockReturnValue(null);
  doc.activeElement = { matches: () => true };
  await vi.advanceTimersByTimeAsync(1000);
  expect(win.location.reload).not.toHaveBeenCalled();
  doc.activeElement = null;
  await vi.advanceTimersByTimeAsync(1000);
  expect(win.location.reload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(win.location.reload).toHaveBeenCalledTimes(1);
});
