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
import { getAccess, isAdmin } from "./lib/access.js";
import { initTheme } from "./lib/theme.js";
import { closeDialog, initDialog } from "./lib/ui.js";
import { atRoot, back, go, route, setGuard, startRouter } from "./router.js";
import { accessScreen } from "./screens/access.js";
import { backupScreen } from "./screens/backup.js";
import { invoiceLocateScreen } from "./screens/locate.js";
import { invoiceStoreScreen, storeScreen } from "./screens/store.js";
import { invoiceStoresScreen, storesScreen } from "./screens/stores.js";

initTheme();
initDialog();

route("/acceso", accessScreen);
// "Registro viejo" (solo admin). Ahí ya no se registran ubicaciones: no hay ruta /ubicar.
route("/tiendas", storesScreen);
route("/tiendas/:id", storeScreen);
// "Registro nuevo" (admin) = "Tiendas" del transportista: mismas pantallas, con sus propios datos.
route("/facturas", invoiceStoresScreen);
route("/facturas/:id", invoiceStoreScreen);
route("/facturas/:id/ubicar", invoiceLocateScreen);
route("/respaldo", backupScreen);

// Barra inferior (Tiendas / Respaldo): cambiar de pestaña no apila historial.
for (const tab of document.querySelectorAll(".nav-item[data-tab]")) {
  tab.addEventListener("click", () => {
    if (!tab.classList.contains("active")) go(tab.dataset.tab, { replace: true });
  });
}

// Sin acceso vigente, todo lleva a la pantalla de contraseña. El transportista (empleado) solo
// usa el registro nuevo: el registro viejo y el respaldo son del admin.
const home = () => (isAdmin() ? "/tiendas" : "/facturas");
setGuard((path, screen) => {
  document.body.dataset.role = isAdmin() ? "admin" : "empleado";
  if (screen === accessScreen) return getAccess() ? home() : null;
  if (!getAccess()) return "/acceso";
  if (!isAdmin() && /^\/(tiendas|respaldo)\b/.test(path)) return "/facturas";
  return null;
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
