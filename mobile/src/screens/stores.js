// Listado de todas las tiendas con buscador general y filtros.
import { escapeHtml, formatCoords, formatRelative, normalize } from "../lib/format.js";
import { parseInvoice } from "../lib/invoice.js";
import { matchInvoice } from "../lib/match.js";
import { scanInvoiceText } from "../lib/ocr.js";
import { PhotoError } from "../lib/photo.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { findStore, loadStores, state } from "../state.js";
import { handleDataError, lockApp } from "./common.js";

const MAX_RENDERED = 150; // con miles de tiendas, se muestran las primeras y se pide afinar
const FILTERS = {
  all: () => true,
  pending: (s) => s.changeCount === 0,
  done: (s) => s.changeCount > 0,
};

let filter = "all";
let renderedKey = "";
// Resultado del último escaneo de factura: mientras exista, la lista muestra solo esas tiendas.
let scan = null; // { seq, ids, byCode, nearCode, invoice }
let scanSeq = 0;
let scanning = false;
// Texto de búsqueda precalculado por tienda (sin tildes, en minúsculas).
const searchIndex = new WeakMap();

const haystack = (s) => {
  let text = searchIndex.get(s);
  if (text === undefined) {
    text = normalize(`${s.name} ${s.code} ${s.address || ""}`);
    searchIndex.set(s, text);
  }
  return text;
};

function filtered() {
  const terms = normalize($("storeSearch").value).split(/\s+/).filter(Boolean);
  return state.stores.filter(
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
    `<span class="lead ${done ? "" : "pending"}">${icon("i-store")}</span>` +
    `<span class="txt">${best ? `<span class="best">Mejor coincidencia</span>` : ""}` +
    `<span class="name">${escapeHtml(s.name)}</span><span class="sub">${sub}</span>${coords}</span>` +
    `<span class="trail">${trail}</span></button></li>`
  );
}

function render({ force = false } = {}) {
  if (!state.stores) return;
  const key = `${state.version}|${filter}|${$("storeSearch").value}|${scan?.seq ?? ""}`;
  if (!force && key === renderedKey) return; // nada cambió: se conserva el scroll
  renderedKey = key;

  const all = state.stores;
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
      ? `${items.length} resultado(s) para “${query}”`
      : `${items.length} tienda(s)`;

  $("stores").innerHTML = items.slice(0, MAX_RENDERED).map(storeItem).join("");
  const more = items.length - MAX_RENDERED;
  $("storesMore").hidden = more <= 0;
  $("storesMore").textContent = `Y ${more} tienda(s) más. Escribí en el buscador para encontrar la tuya.`;

  if (!all.length) {
    setMsg("storesMsg", "No hay tiendas cargadas todavía. Pedile al administrador que cargue el listado.");
  } else if (!items.length) {
    setMsg("storesMsg", query ? "Ninguna tienda coincide con la búsqueda." : "No hay tiendas en este filtro.");
  } else {
    setMsg("storesMsg", "");
  }
}

/** Lista con las tiendas que coinciden con la factura escaneada (la mejor primero). */
function renderScan() {
  const items = scan.ids.map(findStore).filter(Boolean);
  const { code, name, place, notes, text } = scan.invoice;
  // Lo que se leyó de la factura, para que el transportista confirme de un vistazo.
  const fields = [
    ["Código", code],
    ["Cliente", name],
    place ? ["Entregar en", place] : ["Observaciones", notes],
  ].filter(([, value]) => value);
  $("scanFields").innerHTML = fields
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  $("scanFields").hidden = !fields.length;
  $("scanText").textContent = text.trim() || "(no se leyó texto)";
  $("scanInfo").textContent = !items.length
    ? "No se encontró ninguna tienda con el código ni el nombre de esta factura."
    : !scan.byCode
      ? `${code ? `Ninguna tienda tiene exactamente el código ${code}. ` : "No se pudo leer el código. "}` +
        (scan.nearCode
          ? "Primero van las de código parecido (puede que se haya leído mal un número) y después las del mismo nombre: comparalo con la factura."
          : "Se buscó por nombre: revisá bien que sea la tienda correcta.")
      : items.length === 1
        ? "Esta es la tienda con el código de la factura. Tocala para registrar la ubicación."
        : "Hay varias sucursales con este código. La primera es la del lugar de entrega.";
  $("storesSummary").textContent = items.length ? `${items.length} coincidencia(s)` : "";
  $("stores").innerHTML = items.map((s, i) => storeItem(s, i === 0 && items.length > 1)).join("");
  $("storesMore").hidden = true;
  setMsg(
    "storesMsg",
    items.length
      ? ""
      : "Probá escanear de nuevo con buena luz y la factura completa en la foto, o buscá la tienda por nombre."
  );
}

function closeScan() {
  scan = null;
  render();
}

async function scanInvoice() {
  if (scanning) return;
  if (!state.stores?.length) {
    toast("Primero tiene que cargarse el listado de tiendas.", "error");
    return;
  }
  scanning = true;
  const btns = [$("scanInvoice"), $("scanAgain")];
  for (const b of btns) b.disabled = true;
  $("scanInvoice").classList.add("busy");
  try {
    const invoice = parseInvoice(await scanInvoiceText());
    const matches = matchInvoice(invoice, state.stores);
    $("storeSearch").value = "";
    scan = {
      seq: ++scanSeq,
      ids: matches.map((m) => m.store.id),
      byCode: matches.some((m) => m.byCode),
      nearCode: matches.some((m) => m.byNearCode),
      invoice,
    };
    render();
    $("storesBody").scrollTop = 0;
    $("scanPanel").querySelector("details").open = false;
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
  if (!state.stores) setMsg("storesMsg", "Cargando tiendas…");
  const btn = $("refreshStores");
  btn.classList.add("spinning");
  try {
    await loadStores({ force });
    render();
    if (force) toast("Listado actualizado.");
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message) {
      if (state.stores) toast(message, "error");
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
      b.setAttribute("aria-checked", String(on));
    }
    render();
    $("storesBody").scrollTop = 0;
  });
}

$("stores").addEventListener("click", (e) => {
  const item = e.target.closest(".store-item");
  if (item) go(`/tiendas/${item.dataset.id}`);
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

export const storesScreen = {
  id: "screenStores",
  enter() {
    render();
    refresh();
  },
};
