// Detalle de una tienda: coordenada actual, conteo de cambios e historial con fechas.
// Sirve a los dos módulos (#/tiendas/:id y #/facturas/:id); cada uno con sus propios datos.
import L from "leaflet";
import { deleteLocationChange, listLocationChanges } from "../data/index.js";
import { getToken, isAdmin } from "../lib/access.js";
import { escapeHtml, formatAccuracy, formatCoords, formatDateTime, formatRelative } from "../lib/format.js";
import { currentPin, tileLayer } from "../lib/map.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { back, go } from "../router.js";
import { MODULES, findStore, loadStores, removeStore, updateStore } from "../state.js";
import { handleDataError } from "./common.js";

let map;
let marker;
let module = "stores";
let storeId = null;
let requestSeq = 0;
let changes = []; // historial mostrado (más reciente primero)
let deleting = false;

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
  // Observaciones de la factura (solo en el registro nuevo).
  $("storeNotesWrap").hidden = !store.notes;
  $("storeNotes").textContent = store.notes || "";
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
        // Solo el admin borra registros del historial.
        (isAdmin()
          ? `<button class="icon-btn small change-delete" type="button" data-id="${c.id}"` +
            ` aria-label="Borrar registro #${total - i}" title="Borrar registro">${icon("i-trash")}</button>`
          : "") +
        `</li>`
      );
    })
    .join("");
  setMsg("historyMsg", total ? "" : "Todavía no se registró la ubicación de esta tienda desde la app.");
}

async function loadHistory(id) {
  const seq = ++requestSeq;
  setMsg("historyMsg", "Cargando historial…");
  try {
    const changes = await MODULES[module].listChanges(getToken(), id);
    if (seq === requestSeq) renderHistory(changes);
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message && seq === requestSeq) setMsg("historyMsg", message, "error");
  }
}

async function confirmDelete(change) {
  const store = findStore(storeId, module);
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
  const mod = module;
  const same = () => storeId === id && module === mod;
  try {
    const { store } = await MODULES[mod].deleteChange(getToken(), id, change.id);
    updateStore(store, mod);
    toast("Registro borrado.", "ok");
    if (same()) {
      renderStore(store);
      await loadHistory(id);
    }
  } catch (e) {
    handleDataError(e);
    if (e.code === "CHANGE_NOT_FOUND" && same()) loadHistory(id); // ya no existía
    btn.disabled = false;
  } finally {
    deleting = false;
  }
});

// Borrar la tienda entera (solo admin): se va con todo su historial.
$("deleteStore").addEventListener("click", async () => {
  const store = findStore(storeId, module);
  if (!store || deleting) return;
  const count = store.changeCount;
  const ok = await confirmDialog({
    title: "¿Borrar esta tienda?",
    body:
      `<p><strong>${escapeHtml(store.name)}</strong> · ${escapeHtml(store.code)}</p>` +
      `<p class="muted">Se borra del ${module === "invoice" ? "registro nuevo" : "registro viejo"}` +
      `${count ? ` junto con su historial (${count} ${count === 1 ? "cambio" : "cambios"} de ubicación)` : ""}. ` +
      `No se puede deshacer.</p>`,
    accept: "Borrar",
  });
  if (!ok || findStore(store.id, module) !== store) return;

  deleting = true;
  const btn = $("deleteStore");
  btn.disabled = true;
  const mod = module;
  try {
    await MODULES[mod].deleteStore(getToken(), store.id);
    removeStore(store.id, mod);
    toast("Tienda borrada.", "ok");
    if (storeId === store.id && module === mod) back();
  } catch (e) {
    handleDataError(e);
    if (e.code === "STORE_NOT_FOUND") {
      // Ya la había borrado alguien más: se saca del listado igual.
      removeStore(store.id, mod);
      if (storeId === store.id && module === mod) back();
    }
  } finally {
    deleting = false;
    btn.disabled = false;
  }
});

$("goLocate").addEventListener("click", () => {
  if (storeId != null) go(`${MODULES[module].base}/${storeId}/ubicar`);
});

function detailScreen(key) {
  return {
    id: "screenStore",
    parent: () => MODULES[key].base,
    async enter({ id }) {
      const changed = storeId !== Number(id) || module !== key;
      module = key;
      storeId = Number(id);
      if (changed) {
        $("history").innerHTML = "";
        $("storeName").textContent = "";
        $("storeNotesWrap").hidden = true;
        $("screenStore").querySelector(".screen-body").scrollTop = 0;
      }
      $("storeTitle").textContent = !isAdmin()
        ? "Tienda"
        : key === "invoice"
          ? "Registro nuevo"
          : "Registro viejo";
      // En el registro viejo ya no se registran ubicaciones.
      $("goLocate").closest(".action-bar").hidden = key !== "invoice";
      let store = findStore(id, key);
      if (!store) {
        try {
          await loadStores({ module: key });
        } catch (e) {
          const message = handleDataError(e, { silent: true });
          if (message) setMsg("historyMsg", message, "error");
          return;
        }
        store = findStore(id, key);
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
}

export const storeScreen = detailScreen("stores");
export const invoiceStoreScreen = detailScreen("invoice");
