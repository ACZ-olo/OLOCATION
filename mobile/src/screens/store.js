// Detalle de una tienda: coordenada actual, conteo de cambios e historial con fechas.
import L from "leaflet";
import {
  deleteLocationChange,
  getInvoiceImage,
  listLocationChanges,
  registerInvoice,
} from "../data/index.js";
import { getToken } from "../lib/access.js";
import { escapeHtml, formatAccuracy, formatCoords, formatDateTime, formatRelative } from "../lib/format.js";
import { currentPin, tileLayer } from "../lib/map.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { findStore, loadStores, updateStore } from "../state.js";
import { handleDataError, openImageViewer, pickInvoicePhoto } from "./common.js";

let map;
let marker;
let storeId = null;
let requestSeq = 0;
let changes = []; // historial mostrado (más reciente primero)
let deleting = false;
let savingInvoice = false;
let invoiceSeq = 0; // para ignorar cargas de imagen de una tienda que ya cambió
let latestImage = null; // { url, revoke } de la factura más reciente mostrada

function ensureMap() {
  if (map) return;
  map = L.map("storeMap", {
    zoomControl: false,
    attributionControl: true,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
  });
  tileLayer().addTo(map);
}

function renderStore(store) {
  $("storeName").textContent = store.name;
  $("storeCode").textContent = store.code;
  $("storeAddress").textContent = store.address || "";
  $("storeChangeCount").textContent = store.changeCount;
  $("storeUpdated").textContent = store.locationUpdatedAt ? formatRelative(store.locationUpdatedAt) : "—";

  const hasCoords = store.latitude != null;
  $("storeMap").hidden = !hasCoords;
  $("storeNoMap").hidden = hasCoords;
  $("storeCoords").textContent = hasCoords
    ? `${formatCoords(store.latitude, store.longitude)}${store.changeCount ? "" : " · coordenada de la carga inicial"}`
    : "";
  if (hasCoords) {
    ensureMap();
    const latLng = [store.latitude, store.longitude];
    map.setView(latLng, 16, { animate: false });
    if (marker) marker.setLatLng(latLng);
    else marker = L.marker(latLng, { icon: currentPin(), interactive: false }).addTo(map);
    setTimeout(() => map.invalidateSize(), 50);
  }
  renderInvoice(store);
}

function clearLatestImage() {
  if (latestImage) latestImage.revoke?.();
  latestImage = null;
  $("storeInvoiceImage").removeAttribute("src");
  $("storeInvoiceImageBtn").classList.remove("ready");
}

/** Muestra la factura más reciente de la tienda (o el estado vacío). */
async function renderInvoice(store) {
  const seq = ++invoiceSeq;
  const latest = store.latestInvoice;
  $("storeInvoiceCount").textContent = store.invoiceCount || 0;
  $("goInvoices").hidden = (store.invoiceCount || 0) <= 1;
  $("storeInvoice").hidden = !latest;
  $("storeInvoiceEmpty").hidden = !!latest;
  clearLatestImage();
  if (!latest) return;
  $("storeInvoiceDate").textContent = formatDateTime(latest.createdAt);
  try {
    const image = await getInvoiceImage(getToken(), store.id, latest.id);
    if (seq !== invoiceSeq) {
      image.revoke?.();
      return;
    }
    latestImage = image;
    $("storeInvoiceImage").src = image.url;
    $("storeInvoiceImageBtn").classList.add("ready");
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message && seq === invoiceSeq) setMsg("invoiceMsg", message, "error");
  }
}

function sourceChip(change) {
  return change.source === "gps"
    ? `<span class="chip-src src-gps">${icon("i-gps", "ic xs")} GPS ${escapeHtml(formatAccuracy(change.accuracyM))}</span>`
    : `<span class="chip-src src-map">${icon("i-tap", "ic xs")} Elegido en el mapa</span>`;
}

function renderHistory(items) {
  changes = items;
  const total = changes.length;
  $("history").innerHTML = changes
    .map((c, i) => {
      const previous =
        c.previousLatitude != null
          ? `<span class="prev">Antes: ${formatCoords(c.previousLatitude, c.previousLongitude, 5)}</span>`
          : `<span class="prev">Antes: sin coordenada</span>`;
      return (
        `<li class="change${i === 0 ? " latest" : ""}">` +
        `<span class="change-num">#${total - i}</span>` +
        `<div class="change-body">` +
        `<div class="change-top"><span class="change-date">${escapeHtml(formatDateTime(c.createdAt))}</span>${sourceChip(c)}</div>` +
        `<span class="coords">${formatCoords(c.latitude, c.longitude)}</span>${previous}` +
        `</div>` +
        `<button class="icon-btn small change-delete" type="button" data-id="${c.id}"` +
        ` aria-label="Borrar registro #${total - i}" title="Borrar registro">${icon("i-trash")}</button></li>`
      );
    })
    .join("");
  setMsg("historyMsg", total ? "" : "Todavía no se registró la ubicación de esta tienda desde la app.");
}

async function loadHistory(id) {
  const seq = ++requestSeq;
  setMsg("historyMsg", "Cargando historial…");
  try {
    const changes = await listLocationChanges(getToken(), id);
    if (seq === requestSeq) renderHistory(changes);
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message && seq === requestSeq) setMsg("historyMsg", message, "error");
  }
}

async function confirmDelete(change) {
  const store = findStore(storeId);
  const index = changes.indexOf(change);
  const number = changes.length - index;
  const isLatest = index === 0;
  let effect;
  if (!isLatest) {
    effect = "La coordenada actual de la tienda no cambia.";
  } else if (change.previousLatitude != null) {
    effect =
      `La tienda vuelve a la coordenada anterior:</p>` +
      `<p class="dialog-coords">${formatCoords(change.previousLatitude, change.previousLongitude)}</p><p class="muted">`;
  } else {
    effect = "La tienda queda sin coordenada.";
  }
  return confirmDialog({
    title: `¿Borrar el registro #${number}?`,
    body:
      `<p>${escapeHtml(formatDateTime(change.createdAt))} · ${formatCoords(change.latitude, change.longitude)}</p>` +
      `<p class="muted">${effect} El conteo de ${escapeHtml(store?.name || "la tienda")} baja a ` +
      `${changes.length - 1}. No se puede deshacer.</p>`,
    accept: "Borrar",
  });
}

$("history").addEventListener("click", async (e) => {
  const btn = e.target.closest(".change-delete");
  if (!btn || deleting) return;
  const change = changes.find((c) => c.id === Number(btn.dataset.id));
  if (!change || !(await confirmDelete(change))) return;

  deleting = true;
  btn.disabled = true;
  const id = storeId;
  try {
    const { store } = await deleteLocationChange(getToken(), id, change.id);
    updateStore(store);
    toast("Registro borrado.", "ok");
    if (storeId === id) {
      renderStore(store);
      await loadHistory(id);
    }
  } catch (e) {
    handleDataError(e);
    if (e.code === "CHANGE_NOT_FOUND" && storeId === id) loadHistory(id); // ya no existía
    btn.disabled = false;
  } finally {
    deleting = false;
  }
});

$("goLocate").addEventListener("click", () => {
  if (storeId != null) go(`/tiendas/${storeId}/ubicar`);
});

$("goInvoices").addEventListener("click", () => {
  if (storeId != null) go(`/tiendas/${storeId}/facturas`);
});

$("storeInvoiceImageBtn").addEventListener("click", () => {
  if (latestImage) openImageViewer(latestImage.url); // no revoke: la pantalla sigue usando la URL
});

$("addInvoice").addEventListener("click", async () => {
  if (savingInvoice || storeId == null) return;
  const photo = await pickInvoicePhoto();
  if (!photo) return;

  savingInvoice = true;
  const id = storeId;
  const btn = $("addInvoice");
  btn.disabled = true;
  setMsg("invoiceMsg", "Guardando factura…");
  try {
    const { store } = await registerInvoice(getToken(), id, photo);
    updateStore(store);
    toast(`Factura registrada · total ${store.invoiceCount}`, "ok");
    if (storeId === id) {
      renderStore(store);
      setMsg("invoiceMsg", "");
    }
  } catch (e) {
    handleDataError(e);
    if (e.code === "STORE_NOT_FOUND" && storeId === id) setMsg("invoiceMsg", "Esta tienda ya no existe.", "error");
  } finally {
    savingInvoice = false;
    btn.disabled = false;
  }
});

export const storeScreen = {
  id: "screenStore",
  parent: () => "/tiendas",
  async enter({ id }) {
    const changed = storeId !== Number(id);
    storeId = Number(id);
    if (changed) {
      $("history").innerHTML = "";
      $("storeName").textContent = "";
      setMsg("invoiceMsg", "");
      clearLatestImage();
      $("storeInvoice").hidden = true;
      $("storeInvoiceEmpty").hidden = false;
      $("screenStore").querySelector(".screen-body").scrollTop = 0;
    }
    let store = findStore(id);
    if (!store) {
      try {
        await loadStores();
      } catch (e) {
        const message = handleDataError(e, { silent: true });
        if (message) setMsg("historyMsg", message, "error");
        return;
      }
      store = findStore(id);
    }
    if (!store) {
      $("storeName").textContent = "Tienda no encontrada";
      setMsg("historyMsg", "Esta tienda ya no existe en el listado.", "error");
      return;
    }
    renderStore(store);
    loadHistory(store.id);
  },
};
