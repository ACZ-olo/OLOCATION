// Listado de tiendas. Dos módulos en la misma pantalla:
//   Registro viejo  el listado cargado por el administrador (#/tiendas, solo admin)
//   Registro nuevo  los clientes registrados al escanear facturas, tal cual la factura
//                   (#/facturas). Es lo único que ve el transportista, como "Tiendas".
// Escanear una factura SIEMPRE registra su cliente en el registro nuevo si el código todavía no
// está. Admin: desde el registro viejo además se muestran las tiendas que coinciden; desde el
// nuevo se abre directamente el registro. Transportista: se muestra la tienda escaneada para
// tocarla (ficha → guardar ubicación). El admin tiene pestañas, buscador y filtros (estos solo
// en el registro nuevo); el
// transportista solo el botón de escanear y la lista (ver body[data-role] en styles.css).
import { registerInvoiceStore } from "../data/index.js";
import { getToken, isAdmin } from "../lib/access.js";
import { escapeHtml, formatCoords, formatRelative, normalize } from "../lib/format.js";
import { parseInvoice } from "../lib/invoice.js";
import { matchInvoice } from "../lib/match.js";
import { scanInvoiceText } from "../lib/ocr.js";
import { PhotoError } from "../lib/photo.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { MODULES, findStore, loadStores, state, storesOf, updateStore } from "../state.js";
import { handleDataError, lockApp } from "./common.js";

const MAX_RENDERED = 150; // con miles de tiendas, se muestran las primeras y se pide afinar
const FILTERS = {
  all: () => true,
  pending: (s) => s.changeCount === 0,
  done: (s) => s.changeCount > 0,
};
const emptyMessage = () =>
  module === "stores"
    ? "No hay tiendas cargadas todavía en el registro viejo."
    : "Todavía no hay tiendas registradas. Escaneá una factura para registrar la primera.";

let module = "stores";
let filter = "all";
let renderedKey = "";
// Resultado del último escaneo de factura (solo en Tiendas): mientras exista, la lista muestra
// solo esas tiendas.
let scan = null; // { seq, module, ids, byCode, nearCode, created, invoice, registered }
let scanSeq = 0;
let scanning = false;
// Texto de búsqueda precalculado por tienda (sin tildes, en minúsculas).
const searchIndex = new WeakMap();

const haystack = (s) => {
  let text = searchIndex.get(s);
  if (text === undefined) {
    text = normalize(`${s.name} ${s.code} ${s.address || ""} ${s.notes || ""}`);
    searchIndex.set(s, text);
  }
  return text;
};

function filtered() {
  const terms = normalize($("storeSearch").value).split(/\s+/).filter(Boolean);
  return storesOf(module).filter(
    (s) => FILTERS[filter](s) && terms.every((t) => haystack(s).includes(t))
  );
}

function storeItem(s, best = false) {
  const done = s.changeCount > 0;
  const sub = [s.code, s.address].filter(Boolean).map(escapeHtml).join(" · ");
  // Coordenada vigente: la del último registro (o la de la carga inicial si nunca se registró).
  const coords =
    s.latitude != null
      ? `<span class="coords">${icon("i-pin", "ic xs")}${formatCoords(s.latitude, s.longitude, 5)}</span>`
      : `<span class="coords none">${icon("i-pin-off", "ic xs")}Sin coordenada</span>`;
  const trail = done
    ? `<span class="badge" title="Cambios de ubicación">${icon("i-pin", "ic xs")}${s.changeCount}</span>` +
      `<span class="when">${escapeHtml(formatRelative(s.locationUpdatedAt))}</span>`
    : `<span class="badge muted">Pendiente</span>`;
  return (
    `<li><button class="store-item" type="button" data-id="${s.id}">` +
    `<span class="lead ${done ? "" : "pending"}">${icon(module === "invoice" ? "i-scan" : "i-store")}</span>` +
    `<span class="txt">${best ? `<span class="best">Mejor coincidencia</span>` : ""}` +
    `<span class="name">${escapeHtml(s.name)}</span><span class="sub">${sub}</span>${coords}</span>` +
    `<span class="trail">${trail}</span></button></li>`
  );
}

function renderTabs() {
  for (const tab of document.querySelectorAll(".module-tab")) {
    const on = tab.dataset.module === module;
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-pressed", String(on));
  }
}

/** "1 tienda", "3 tiendas". */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render({ force = false } = {}) {
  const all = storesOf(module);
  if (!all) return;
  const key = `${state.version}|${module}|${filter}|${$("storeSearch").value}|${scan?.seq ?? ""}`;
  if (!force && key === renderedKey) return; // nada cambió: se conserva el scroll
  renderedKey = key;

  $("countAll").textContent = all.length;
  $("countPending").textContent = all.filter(FILTERS.pending).length;
  $("countDone").textContent = all.filter(FILTERS.done).length;

  $("scanPanel").hidden = !scan;
  if (scan) {
    renderScan();
    return;
  }

  const items = filtered();
  const query = $("storeSearch").value.trim();
  $("clearSearch").hidden = !query;
  $("storesSummary").textContent = !all.length
    ? ""
    : query
      ? `${plural(items.length, "resultado", "resultados")} para “${query}”`
      : plural(items.length, "tienda", "tiendas");

  // Sin escaneo no hay "mejor coincidencia": la lista va en su orden normal.
  $("stores").innerHTML = items.slice(0, MAX_RENDERED).map((s) => storeItem(s)).join("");
  const more = items.length - MAX_RENDERED;
  $("storesMore").hidden = more <= 0;
  $("storesMore").textContent = `Y ${more} más. ${
    isAdmin() ? "Escribí en el buscador" : "Escaneá la factura"
  } para encontrar la tuya.`;

  if (!all.length) {
    setMsg("storesMsg", emptyMessage());
  } else if (!items.length) {
    setMsg("storesMsg", query ? "Ninguna tienda coincide con la búsqueda." : "No hay tiendas en este filtro.");
  } else {
    setMsg("storesMsg", "");
  }
}

/** Lista con las tiendas que coinciden con la factura escaneada (la mejor primero). */
function renderScan() {
  const items = scan.ids.map((id) => findStore(id, scan.module)).filter(Boolean);
  const { code, name, address, place, notes, text } = scan.invoice;
  // Lo que se leyó de la factura, para que el transportista confirme de un vistazo.
  const fields = (
    scan.module === "invoice"
      ? [["Código", code], ["Cliente", name], ["Dirección", address], ["Observaciones", notes]]
      : [["Código", code], ["Cliente", name], place ? ["Entregar en", place] : ["Observaciones", notes]]
  ).filter(([, value]) => value);
  $("scanFields").innerHTML = fields
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  $("scanFields").hidden = !fields.length;
  $("scanRegistered").textContent = scan.registered.text;
  $("scanRegistered").className = `scan-registered ${scan.registered.tone}`;
  $("scanText").textContent = text.trim() || "(no se leyó texto)";
  $("scanInfo").textContent =
    scan.module === "invoice"
      ? scan.created
        ? "Tienda nueva: quedó registrada con los datos de la factura. Tocala para guardar su ubicación."
        : "Esta es la tienda de la factura. Tocala para guardar su ubicación."
      : storesScanInfo(items, code);
  $("storesSummary").textContent = items.length ? plural(items.length, "coincidencia", "coincidencias") : "";
  $("stores").innerHTML = items.map((s, i) => storeItem(s, i === 0 && items.length > 1)).join("");
  $("storesMore").hidden = true;
  setMsg(
    "storesMsg",
    items.length
      ? ""
      : "Probá escanear de nuevo con buena luz y la factura completa en la foto, o buscá la tienda por nombre."
  );
}

/** Explicación del resultado del escaneo en el registro viejo. */
function storesScanInfo(items, code) {
  return !items.length
    ? "No se encontró ninguna tienda con el código ni el nombre de esta factura."
    : !scan.byCode
      ? `${code ? `Ninguna tienda tiene exactamente el código ${code}. ` : "No se pudo leer el código. "}` +
        (scan.nearCode
          ? "Primero van las de código parecido (puede que se haya leído mal un número) y después las del mismo nombre: comparalo con la factura."
          : "Se buscó por nombre: revisá bien que sea la tienda correcta.")
      : items.length === 1
        ? "Esta es la tienda con el código de la factura. Tocala para registrar la ubicación."
        : "Hay varias sucursales con este código. La primera es la del lugar de entrega.";
}

function closeScan() {
  scan = null;
  render();
}

/** Qué faltó leer para poder registrar en el registro nuevo ("el código", "el nombre"…), o "". */
const missingFields = ({ code, name }) =>
  [!code && "el código", !name && "el nombre"].filter(Boolean).join(" ni ");

/**
 * Registra el cliente de la factura en el registro nuevo. Si el código ya estaba, el registro
 * queda como está. Devuelve { store, created } o null si falló (el error ya se mostró).
 */
async function registerFromInvoice(invoice) {
  try {
    const result = await registerInvoiceStore(getToken(), invoice);
    updateStore(result.store, "invoice");
    return result;
  } catch (e) {
    handleDataError(e);
    return null;
  }
}

function showScan(fields) {
  $("storeSearch").value = "";
  scan = { seq: ++scanSeq, ...fields };
  render();
  $("storesBody").scrollTop = 0;
  $("scanPanel").querySelector("details").open = false;
}

/** Escaneo desde el registro viejo (admin): coincidencias como siempre + registro nuevo. */
async function scanFromStores(invoice) {
  const matches = matchInvoice(invoice, state.stores);
  const missing = missingFields(invoice);
  let registered;
  if (missing) {
    registered = { text: `No se guardó en el registro nuevo: no se pudo leer ${missing}.`, tone: "warn" };
  } else {
    const result = await registerFromInvoice(invoice);
    registered = !result
      ? { text: "No se pudo guardar en el registro nuevo.", tone: "error" }
      : result.created
        ? { text: "Cliente agregado al registro nuevo.", tone: "ok" }
        : { text: "Este cliente ya estaba en el registro nuevo.", tone: "" };
  }
  if (module !== "stores") return; // cambió de pestaña mientras se registraba
  showScan({
    module: "stores",
    ids: matches.map((m) => m.store.id),
    byCode: matches.some((m) => m.byCode),
    nearCode: matches.some((m) => m.byNearCode),
    invoice,
    registered,
  });
}

/**
 * Escaneo desde el registro nuevo: registra (si no estaba). El admin va directo al registro;
 * al transportista se le muestra la tienda para que la toque (ficha → guardar ubicación).
 */
async function scanFromInvoice(invoice) {
  const missing = missingFields(invoice);
  if (missing) {
    toast(`No se pudo leer ${missing} de la factura. Escaneá de nuevo con buena luz.`, "error");
    return;
  }
  const result = await registerFromInvoice(invoice);
  if (!result) return;
  if (isAdmin()) {
    toast(result.created ? "Cliente registrado." : "Este cliente ya estaba registrado.", result.created ? "ok" : "");
    go(`${MODULES.invoice.base}/${result.store.id}`);
    return;
  }
  if (module !== "invoice") return;
  showScan({
    module: "invoice",
    ids: [result.store.id],
    created: result.created,
    invoice,
    registered: { text: "", tone: "" },
  });
}

async function scanInvoice() {
  if (scanning) return;
  if (module === "stores" && !state.stores?.length) {
    toast("Primero tiene que cargarse el listado de tiendas.", "error");
    return;
  }
  scanning = true;
  const btns = [$("scanInvoice"), $("scanAgain")];
  for (const b of btns) b.disabled = true;
  $("scanInvoice").classList.add("busy");
  try {
    const invoice = parseInvoice(await scanInvoiceText());
    if (module === "invoice") await scanFromInvoice(invoice);
    else await scanFromStores(invoice);
  } catch (e) {
    if (!(e instanceof PhotoError)) throw e;
    if (e.code !== "CANCELLED") toast(e.message || "No se pudo leer la factura.", "error");
  } finally {
    scanning = false;
    for (const b of btns) b.disabled = false;
    $("scanInvoice").classList.remove("busy");
  }
}

$("scanInvoice").addEventListener("click", scanInvoice);
$("scanAgain").addEventListener("click", scanInvoice);
$("scanClose").addEventListener("click", closeScan);

async function refresh({ force = false } = {}) {
  const current = module;
  if (!storesOf(current)) setMsg("storesMsg", "Cargando…");
  const btn = $("refreshStores");
  btn.classList.add("spinning");
  try {
    await loadStores({ force, module: current });
    if (current === module) render();
    if (force) toast("Listado actualizado.");
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message && current === module) {
      if (storesOf(current)) toast(message, "error");
      else setMsg("storesMsg", message, "error");
    }
  } finally {
    btn.classList.remove("spinning");
  }
}

$("storeSearch").addEventListener("input", () => {
  scan = null; // buscar a mano sale del resultado del escaneo
  render();
  $("storesBody").scrollTop = 0;
});
$("clearSearch").addEventListener("click", () => {
  $("storeSearch").value = "";
  render();
  $("storeSearch").focus();
});
$("storeSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur(); // oculta el teclado para ver los resultados
});

for (const btn of document.querySelectorAll(".filter")) {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    scan = null;
    for (const b of document.querySelectorAll(".filter")) {
      const on = b === btn;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    render();
    $("storesBody").scrollTop = 0;
  });
}

// Cambiar de pestaña no apila historial (igual que la barra inferior).
for (const tab of document.querySelectorAll(".module-tab")) {
  tab.addEventListener("click", () => {
    if (tab.dataset.module !== module) go(MODULES[tab.dataset.module].base, { replace: true });
  });
}

$("stores").addEventListener("click", (e) => {
  const item = e.target.closest(".store-item");
  if (item) go(`${MODULES[module].base}/${item.dataset.id}`);
});

$("refreshStores").addEventListener("click", () => refresh({ force: true }));

$("lockBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "¿Salir de la app?",
    body: "<p>Se va a pedir la contraseña otra vez en este dispositivo.</p>",
    accept: "Salir",
  });
  if (ok) lockApp();
});

function listScreen(key) {
  return {
    id: "screenStores",
    enter() {
      if (module !== key) {
        // Otro módulo: se sale del escaneo y de la búsqueda de la pestaña anterior.
        module = key;
        scan = null;
        $("storeSearch").value = "";
        $("stores").innerHTML = "";
        $("storesSummary").textContent = "";
        for (const id of ["countAll", "countPending", "countDone"]) $(id).textContent = "";
        setMsg("storesMsg", "");
        $("storesBody").scrollTop = 0;
        renderedKey = "";
      }
      const admin = isAdmin();
      // El transportista no tiene buscador ni filtros: no puede quedar uno puesto del admin.
      if (!admin) $("storeSearch").value = "";
      // En el registro viejo no hay filtros: siempre se muestran todas.
      const filters = admin && module !== "stores";
      $("storeFilters").hidden = !filters;
      if (!filters && filter !== "all") document.querySelector('.filter[data-filter="all"]').click();
      $("scanInvoice").querySelector("span").textContent =
        admin && module === "invoice" ? "Escanear factura y registrar" : "Escanear factura";
      renderTabs();
      if (!storesOf(module)) $("scanPanel").hidden = true;
      render();
      refresh();
    },
  };
}

export const storesScreen = listScreen("stores");
export const invoiceStoresScreen = listScreen("invoice");
