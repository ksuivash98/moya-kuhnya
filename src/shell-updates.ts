// Keep long-lived tabs current without clearing offline data or interrupting forms.
export function watchShellUpdates(registration: ServiceWorkerRegistration) {
  let checking = false;
  const check = async () => {
    if (checking || !navigator.onLine || document.visibilityState === "hidden")
      return;
    checking = true;
    try {
      await registration.update();
    } catch {
      // Losing the connection must not break the running/offline application.
    } finally {
      checking = false;
    }
  };
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  const timer = window.setInterval(check, 60000);
  void check();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
  };
}

export function reloadShellWhenSafe() {
  const reload = () => {
    if (
      document.visibilityState === "hidden" ||
      document.querySelector("dialog[open], form") ||
      (document.activeElement?.matches(
        "input, textarea, select, [contenteditable=true]",
      ) &&
        !document.activeElement.matches("[data-shell-filter]"))
    )
      return;
    window.clearInterval(timer);
    window.location.reload();
  };
  const timer = window.setInterval(reload, 1000);
  reload();
}
