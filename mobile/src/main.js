// Fuentes incluidas en la app (solo alfabeto latino): funcionan sin internet.
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@fontsource/open-sans/latin-700.css";
import "@fontsource/open-sans/latin-800.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { getAccess } from "./lib/access.js";
import { initTheme } from "./lib/theme.js";
import { closeDialog, initDialog } from "./lib/ui.js";
import { atRoot, back, route, setGuard, startRouter } from "./router.js";
import { accessScreen } from "./screens/access.js";
import { locateScreen } from "./screens/locate.js";
import { storeScreen } from "./screens/store.js";
import { storesScreen } from "./screens/stores.js";

initTheme();
initDialog();

route("/acceso", accessScreen);
route("/tiendas", storesScreen);
route("/tiendas/:id", storeScreen);
route("/tiendas/:id/ubicar", locateScreen);

// Sin acceso vigente, todo lleva a la pantalla de contraseña.
setGuard((path, screen) => {
  if (screen === accessScreen) return getAccess() ? "/tiendas" : null;
  return getAccess() ? null : "/acceso";
});

for (const btn of document.querySelectorAll(".nav-back")) btn.addEventListener("click", back);

if (Capacitor.isNativePlatform()) {
  // Botón "atrás" de Android: cierra diálogos, vuelve de pantalla o sale desde la principal.
  App.addListener("backButton", () => {
    if (closeDialog()) return;
    if (atRoot()) App.exitApp();
    else back();
  });
}

startRouter();
