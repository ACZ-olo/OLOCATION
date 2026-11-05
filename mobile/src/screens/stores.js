// Listado de tiendas. Dos módulos en la misma pantalla:
//   Registro viejo  el listado cargado por el administrador (#/tiendas, solo admin)
//   Registro nuevo  los clientes registrados al escanear facturas, tal cual la factura
//                   (#/facturas). Es lo único que ve el transportista, como "Tiendas".
// Escanear una factura SIEMPRE registra su cliente en el registro nuevo si el código todavía no
// está. Admin: desde el registro viejo además se muestran las tiendas que coinciden; desde el
// nuevo se abre directamente el registro. Transportista: se muestra la tienda escaneada para
// tocarla (ficha → guardar ubicación). El admin tiene pestañas y buscador; el transportista, en el inicio, solo el botón de escanear, y tras
// escanear solo el resultado (ver body[data-role] en styles.css).
import { analyzeInvoice, registerInvoiceStore } from "../data/index.js";
import { getToken, isAdmin } from "../lib/access.js";
import { escapeHtml, formatCoords, formatRelative, normalize } from "../lib/format.js";
import { doubtMessage, invoiceDoubts, invoiceProblems, parseInvoice, problemMessage } from "../lib/invoice.js";
import { withNotesLocation } from "../lib/invoice-ai.js";
import { matchInvoice } from "../lib/match.js";
import { scanInvoiceText } from "../lib/ocr.js";
import { PhotoError } from "../lib/photo.js";
import { $, confirmDialog, icon, setState, skeletonRows, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { MODULES, findStore, loadStores, state, storesOf, updateStore } from "../state.js";
import { handleDataError, lockApp } from "./common.js";

const MAX_RENDERED = 150; // con miles de tiendas, se muestran las primeras y se pide afinar
const emptyState = () =>
  module === "stores"
    ? { icon: "i-store", title: "Sin tiendas", text: "No hay tiendas cargadas todavía en el registro viejo." }
    : {
        icon: "i-scan",
        title: "Sin tiendas registradas",
        text: "Todavía no hay tiendas registradas. Escaneá una factura para registrar la primera.",
      };

/** Fila de relleno con la misma forma que una tienda (ver .skel-item en styles.css). */
const SKELETON_ROW =
  `<li class="skel-item" aria-hidden="true"><span class="skel skel-lead"></span>` +
  `<span class="skel-lines"><span class="skel skel-line w70"></span><span class="skel skel-line w50"></span>` +
  `<span class="skel skel-line w30"></span></span></li>`;
let showingSkeleton = false;

function showLoading() {
  $("stores").innerHTML = skeletonRows(6, SKELETON_ROW);
  showingSkeleton = true;
  setState("storesMsg", { loading: "Cargando tiendas…" });
}

/** Al reemplazar el relleno por las tiendas, estas aparecen con un fundido corto. */
function revealList() {
  if (!showingSkeleton) return;
  showingSkeleton = false;
  const list = $("stores");
  list.classList.remove("reveal");
  void list.offsetWidth;
  list.classList.add("reveal");
  // Se saca al terminar (400 ms + escalonado): buscar después no vuelve a animar la lista.
  setTimeout(() => list.classList.remove("reveal"), 700);
}

let module = "stores";
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
    text = normalize(`${s.name} ${s.code} ${s.address || ""} ${s.notes || ""} ${s.notesLocation || ""}`);
    searchIndex.set(s, text);
  }
  return text;
};

function filtered() {
  const terms = normalize($("storeSearch").value).split(/\s+/).filter(Boolean);
  return storesOf(module).filter((s) => terms.every((t) => haystack(s).includes(t)));
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

/** La tienda que salió al escanear en el registro nuevo: tarjeta destacada, bien visible. */
function matchItem(s, created) {
  const sub = [s.code, s.address].filter(Boolean).map(escapeHtml).join(" · ");
  return (
    `<li class="match-row"><button class="store-item match" type="button" data-id="${s.id}">` +
    `<span class="match-label">${icon("i-check", "ic sm")}${created ? "Tienda nueva de la factura" : "Tienda de la factura"}</span>` +
    `<span class="match-main"><span class="lead big">${icon("i-store")}</span>` +
    `<span class="txt"><span class="name">${escapeHtml(s.name)}</span><span class="sub">${sub}</span></span></span>` +
    `<span class="match-cta"><span class="match-cta-icon">${icon("i-pin")}</span>` +
    `<span class="match-cta-txt">Guardar ubicación</span>${icon("i-chev")}</span>` +
    `</button></li>`
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
  $("storesBody").classList.toggle("home", !scan); // transportista: inicio solo con el botón
  const all = storesOf(module);
  if (!all) return;
  const key = `${state.version}|${module}|${$("storeSearch").value}|${scan?.seq ?? ""}`;
  if (!force && key === renderedKey) return; // nada cambió: se conserva el scroll
  renderedKey = key;

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
  revealList();
  const more = items.length - MAX_RENDERED;
  $("storesMore").hidden = more <= 0;
  $("storesMore").textContent = `Y ${more} más. ${
    isAdmin() ? "Escribí en el buscador" : "Escaneá la factura"
  } para encontrar la tuya.`;

  if (!all.length) {
    setState("storesMsg", emptyState());
  } else if (!items.length) {
    setState("storesMsg", {
      icon: "i-search",
      title: "Sin resultados",
      text: "Ninguna tienda coincide con la búsqueda.",
    });
  } else {
    setState("storesMsg", null);
  }
}

/** Lista con las tiendas que coinciden con la factura escaneada (la mejor primero). */
function renderScan() {
  const items = scan.ids.map((id) => findStore(id, scan.module)).filter(Boolean);
  const { code, name, address, place, notes, notesLocation, text } = scan.invoice;
  // Lo que se leyó de la factura, para que el transportista confirme de un vistazo.
  const fields = (
    scan.module === "invoice"
      ? [
          ["Código", code],
          ["Cliente", name],
          ["Dirección", address],
          ["Observaciones", notes],
          ["Ubicación - Observaciones", notesLocation],
        ]
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
        ? "La tienda no estaba: quedó registrada con estos datos."
        : "Datos leídos de la factura."
      : storesScanInfo(items, code);
  $("storesSummary").textContent = items.length ? plural(items.length, "coincidencia", "coincidencias") : "";
  $("stores").innerHTML =
    scan.module === "invoice"
      ? items.map((s) => matchItem(s, scan.created)).join("")
      : items.map((s, i) => storeItem(s, i === 0 && items.length > 1)).join("");
  $("storesMore").hidden = true;
  showingSkeleton = false;
  setState(
    "storesMsg",
    items.length
      ? null
      : {
          icon: "i-search",
          text: "Probá escanear de nuevo con buena luz y la factura completa en la foto, o buscá la tienda por nombre.",
        }
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

/** Olvida el último escaneo (al guardar la ubicación, el transportista vuelve al inicio). */
export function clearScan() {
  scan = null;
}

/** "El formato del código está mal. No hay dirección." (para una línea de texto). */
const problemsText = (problems) => problems.map((p) => `${problemMessage(p).title}.`).join(" ");

/**
 * La factura no se leyó bien (ver invoiceProblems): no se registra nada y se dice qué salió mal
 * y qué hacer. Devuelve true si quiere volver a tomar la foto.
 */
function askRetake(problems) {
  const messages = problems.map(problemMessage);
  const paper = messages.every((m) => m.paper);
  const single = messages.length === 1;
  const list = single
    ? `<p>${escapeHtml(messages[0].detail)}</p>`
    : `<ul class="scan-problems">${messages
        .map((m) => `<li><strong>${escapeHtml(m.title)}.</strong> ${escapeHtml(m.detail)}</li>`)
        .join("")}</ul>`;
  // Si el dato falta o viene mal escrito en la factura, otra foto no lo arregla.
  const advice = paper
    ? `<p>Revisá la factura en papel: si de verdad viene así, no se puede registrar. Si en el papel ` +
      `está bien, tomá la foto de nuevo con buena luz y sin moverte.</p>`
    : `<p>Tomá la foto de nuevo con buena luz, la factura derecha y sin moverte, y que se vea ` +
      `bien el recuadro del cliente (código, nombre y dirección).</p>`;
  return confirmDialog({
    title: single ? messages[0].title : paper ? "La factura tiene datos con problemas" : "No se logró leer la factura",
    body: list + advice,
    accept: "Tomar otra foto",
  });
}

/**
 * Algo se leyó pero puede estar mal leído (ver invoiceDoubts): se muestra para que el
 * transportista lo compare con la factura. Devuelve "ok" (registrar), "retake" o "cancel".
 */
async function askDoubts(doubts) {
  const rows = doubts
    .map((d) => {
      const m = doubtMessage(d);
      return `<dt>${m.label}</dt><dd><strong>${escapeHtml(d.value)}</strong><span>${escapeHtml(m.why)}</span></dd>`;
    })
    .join("");
  const single = doubts.length === 1;
  const answer = await confirmDialog({
    title: single ? `Revisá ${doubts[0].field === "name" ? "el nombre" : "la dirección"}` : "Revisá los datos leídos",
    body:
      `<p>Puede que la foto no se haya leído bien. ¿Esto es lo que dice la factura?</p>` +
      `<dl class="scan-doubts">${rows}</dl>`,
    accept: "Sí, está bien",
    extra: "Tomar otra foto",
  });
  return answer === true ? "ok" : answer === "extra" ? "retake" : "cancel";
}

/** "Se completó con esta factura: Ubicación - Observaciones." */
const FILLED_LABEL = { notes: "Observaciones", notesLocation: "Ubicación - Observaciones" };
function filledText(filled) {
  const names = filled.map((f) => FILLED_LABEL[f] || f);
  return names.length > 1
    ? `Se completaron con esta factura: ${names.join(" y ")}.`
    : `Se completó con esta factura: ${names[0]}.`;
}

/**
 * Registra el cliente de la factura en el registro nuevo. Si el código ya estaba, solo se
 * completan las observaciones y la Ubicación - Observaciones que estaban vacías (lo demás queda
 * como está). Devuelve { store, created, filled } o null si falló (el error ya se mostró).
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

/**
 * Escaneo desde el registro viejo (admin): coincidencias como siempre + registro nuevo.
 * Devuelve true si hay que volver a tomar la foto.
 */
async function scanFromStores(invoice) {
  const matches = matchInvoice(invoice, state.stores);
  let registered;
  const problems = invoiceProblems(invoice);
  const doubts = problems.length ? [] : invoiceDoubts(invoice);
  const answer = doubts.length ? await askDoubts(doubts) : "ok";
  if (answer === "retake") return true;
  if (problems.length) {
    registered = { text: `No se guardó en el registro nuevo. ${problemsText(problems)}`, tone: "warn" };
  } else if (answer === "cancel") {
    registered = { text: "No se guardó en el registro nuevo: los datos leídos no se confirmaron.", tone: "warn" };
  } else {
    const result = await registerFromInvoice(invoice);
    registered = !result
      ? { text: "No se pudo guardar en el registro nuevo.", tone: "error" }
      : result.created
        ? { text: "Cliente agregado al registro nuevo.", tone: "ok" }
        : result.filled.length
          ? { text: `Este cliente ya estaba en el registro nuevo. ${filledText(result.filled)}`, tone: "ok" }
          : { text: "Este cliente ya estaba en el registro nuevo.", tone: "" };
  }
  if (module !== "stores") return false; // cambió de pestaña mientras se registraba
  showScan({
    module: "stores",
    ids: matches.map((m) => m.store.id),
    byCode: matches.some((m) => m.byCode),
    nearCode: matches.some((m) => m.byNearCode),
    invoice,
    registered,
  });
  return false;
}

/**
 * Escaneo desde el registro nuevo: registra (si no estaba). El admin va directo al registro;
 * al transportista se le muestra la tienda para que la toque (ficha → guardar ubicación).
 * Devuelve true si hay que volver a tomar la foto.
 */
async function scanFromInvoice(invoice) {
  const problems = invoiceProblems(invoice);
  if (problems.length) {
    if (scan) closeScan(); // que no quede a la vista la tienda del escaneo anterior
    return askRetake(problems);
  }
  const doubts = invoiceDoubts(invoice);
  if (doubts.length) {
    const answer = await askDoubts(doubts);
    if (answer !== "ok") {
      if (scan) closeScan();
      return answer === "retake";
    }
  }
  const result = await registerFromInvoice(invoice);
  if (!result) return false;
  const filled = result.filled.length ? filledText(result.filled) : "";
  if (isAdmin()) {
    toast(
      result.created ? "Cliente registrado." : `Este cliente ya estaba registrado.${filled ? ` ${filled}` : ""}`,
      result.created || filled ? "ok" : ""
    );
    go(`${MODULES.invoice.base}/${result.store.id}`);
    return false;
  }
  if (module !== "invoice") return false;
  showScan({
    module: "invoice",
    ids: [result.store.id],
    created: result.created,
    invoice,
    registered: { text: filled, tone: filled ? "ok" : "" },
  });
  return false;
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
  const label = $("scanInvoice").querySelector("span");
  const idleLabel = label.textContent;
  let retake = false;
  try {
    const read = parseInvoice(await scanInvoiceText());
    // IA en el servidor, solo para las observaciones ("Ubicación - Observaciones"). No se llama
    // si la factura se leyó mal: en ese caso se pide otra foto como siempre (lib/invoice-ai.js).
    label.textContent = "Analizando factura…";
    const invoice = await withNotesLocation(read, (input) => analyzeInvoice(getToken(), input));
    if (invoice.ai === "error") console.warn("Análisis con IA no disponible: se siguió sin la IA.");
    if (module === "invoice") retake = await scanFromInvoice(invoice);
    else retake = await scanFromStores(invoice);
  } catch (e) {
    if (!(e instanceof PhotoError)) throw e;
    if (e.code !== "CANCELLED") toast(e.message || "No se pudo leer la factura.", "error");
  } finally {
    scanning = false;
    for (const b of btns) b.disabled = false;
    $("scanInvoice").classList.remove("busy");
    label.textContent = idleLabel;
  }
  if (retake) scanInvoice();
}

$("scanInvoice").addEventListener("click", scanInvoice);
$("scanAgain").addEventListener("click", scanInvoice);
$("scanClose").addEventListener("click", closeScan);

async function refresh({ force = false } = {}) {
  const current = module;
  if (!storesOf(current)) showLoading();
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
      else {
        $("stores").innerHTML = "";
        showingSkeleton = false;
        setState("storesMsg", {
          icon: "i-warn",
          tone: "error",
          title: "No se pudo cargar el listado",
          text: message,
          action: { label: "Reintentar", run: () => refresh() },
        });
      }
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
        setState("storesMsg", null);
        showingSkeleton = false;
        $("storesBody").scrollTop = 0;
        renderedKey = "";
      }
      const admin = isAdmin();
      // El transportista no tiene buscador: no puede quedar puesta una búsqueda del admin.
      if (!admin) $("storeSearch").value = "";
      $("scanClose").textContent = admin ? "Ver todas las tiendas" : "Volver al inicio";
      renderTabs();
      if (!storesOf(module)) $("scanPanel").hidden = true;
      render();
      refresh();
    },
  };
}

export const storesScreen = listScreen("stores");
export const invoiceStoresScreen = listScreen("invoice");
