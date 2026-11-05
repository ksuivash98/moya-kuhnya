import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { watchShellUpdates, reloadShellWhenSafe } from "./shell-updates";
import "./style.css";
registerSW({
  immediate: true,
  onNeedReload: reloadShellWhenSafe,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    // Reuse the same registration, explicitly bypassing HTTP caches for updates.
    void navigator.serviceWorker
      .register(swUrl, {
        scope: registration.scope,
        updateViaCache: "none",
      })
      .then(watchShellUpdates)
      .catch(() => watchShellUpdates(registration));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("shell-offline-ready"));
  },
});
const router = createBrowserRouter([{ path: "*", element: <App /> }], {
  basename: import.meta.env.BASE_URL,
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
