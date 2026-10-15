// Pantalla de acceso: contraseña general, ver/ocultar y "Recordar este dispositivo".
import { verifyAccess } from "../data/index.js";
import { rememberPreference, saveAccess } from "../lib/access.js";
import { $, setMsg } from "../lib/ui.js";
import { go } from "../router.js";
import { takeAccessMessage } from "./common.js";

const MESSAGES = {
  INVALID_PASSWORD: "Contraseña incorrecta.",
  NETWORK: "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.",
};

function setPasswordVisible(visible) {
  $("accessPassword").type = visible ? "text" : "password";
  const btn = $("togglePassword");
  btn.setAttribute("aria-pressed", String(visible));
  btn.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  btn.classList.toggle("on", visible);
}

$("togglePassword").addEventListener("click", () => {
  setPasswordVisible($("accessPassword").type === "password");
  $("accessPassword").focus();
});

$("accessForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const password = $("accessPassword").value;
  if (!password) {
    setMsg("accessMsg", "Ingresá la contraseña.", "error");
    $("accessPassword").focus();
    return;
  }
  const btn = $("accessSubmit");
  btn.disabled = true;
  btn.textContent = "Verificando…";
  setMsg("accessMsg", "");
  try {
    const access = await verifyAccess(password);
    saveAccess(access, $("rememberDevice").checked);
    $("accessPassword").value = "";
    setPasswordVisible(false);
    go("/tiendas", { replace: true });
  } catch (e) {
    setMsg("accessMsg", MESSAGES[e.code] || e.message, "error");
    if (e.code === "INVALID_PASSWORD") $("accessPassword").select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

export const accessScreen = {
  id: "screenAccess",
  enter() {
    $("rememberDevice").checked = rememberPreference();
    const message = takeAccessMessage();
    setMsg("accessMsg", message, message ? "error" : "");
  },
};
