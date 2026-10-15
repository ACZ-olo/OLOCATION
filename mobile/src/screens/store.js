// Detalle de una tienda: coordenada actual, conteo de cambios e historial con fechas.
import L from "leaflet";
import { listLocationChanges } from "../data/index.js";
import { getToken } from "../lib/access.js";
import { escapeHtml, formatAccuracy, formatCoords, formatDateTime, formatRelative } from "../lib/format.js";
import { currentPin, tileLayer } from "../lib/map.js";
import { $, icon, setMsg } from "../lib/ui.js";
import { go } from "../router.js";
import { findStore, loadStores } from "../state.js";
import { handleDataError } from "./common.js";

let map;
let marker;
let storeId = null;
let requestSeq = 0;

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
}

function sourceChip(change) {
  return change.source === "gps"
    ? `<span class="chip-src src-gps">${icon("i-gps", "ic xs")} GPS ${escapeHtml(formatAccuracy(change.accuracyM))}</span>`
    : `<span class="chip-src src-map">${icon("i-tap", "ic xs")} Elegido en el mapa</span>`;
}

function renderHistory(changes) {
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
        `</div></li>`
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

$("goLocate").addEventListener("click", () => {
  if (storeId != null) go(`/tiendas/${storeId}/ubicar`);
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
