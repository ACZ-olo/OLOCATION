// Registrar la ubicación de una tienda: con el GPS (ubicación actual) o tocando el mapa.
import L from "leaflet";
import { DEFAULT_CENTER, GPS_LOW_ACCURACY_M } from "../config.js";
import { registerLocation } from "../data/index.js";
import { getToken } from "../lib/access.js";
import { escapeHtml, formatAccuracy, formatCoords } from "../lib/format.js";
import { locateBest } from "../lib/geo.js";
import { currentPin, newPin, tileLayer } from "../lib/map.js";
import { $, confirmDialog, icon, toast } from "../lib/ui.js";
import { back } from "../router.js";
import { findStore, loadStores, updateStore } from "../state.js";
import { handleDataError } from "./common.js";

let map;
let currentMarker = null; // coordenada que la tienda tiene hoy (gris)
let pickedMarker = null; // punto nuevo (verde, se puede arrastrar)
let accuracyCircle = null;
let gps = null; // búsqueda de GPS en curso
let store = null;
let picked = null; // { latitude, longitude, source: "gps"|"map", accuracyM }
let saving = false;

function ensureMap() {
  if (map) return;
  map = L.map("locateMap", { zoomControl: false }).setView(DEFAULT_CENTER, 8);
  tileLayer().addTo(map);
  map.on("click", (e) => {
    cancelGps();
    pick({ latitude: e.latlng.lat, longitude: e.latlng.lng, source: "map", accuracyM: null });
  });
}

function setSheet({ iconId, title, detail, tone = "" }) {
  $("locateIcon").innerHTML = icon(iconId);
  $("locateIcon").className = "sheet-icon" + (tone ? " " + tone : "");
  $("locateStatus").textContent = title;
  $("locateDetail").innerHTML = detail;
}

function resetSheet() {
  setSheet({
    iconId: "i-tap",
    title: "Elegí cómo registrar la ubicación",
    detail: "Usá tu ubicación actual o tocá el mapa en el punto exacto de la tienda.",
  });
}

function setGpsButton(busy) {
  const btn = $("useGps");
  btn.classList.toggle("busy", busy);
  btn.querySelector("span").textContent = busy ? "Cancelar" : "Mi ubicación";
}

function cancelGps() {
  if (!gps) return;
  gps.cancel();
  gps = null;
  setGpsButton(false);
}

function clearPicked() {
  picked = null;
  if (pickedMarker) pickedMarker.remove();
  if (accuracyCircle) accuracyCircle.remove();
  pickedMarker = accuracyCircle = null;
  $("saveLocation").disabled = true;
  $("mapLegend").hidden = true;
}

function showAccuracy(p) {
  if (p.accuracyM == null) {
    if (accuracyCircle) accuracyCircle.remove();
    accuracyCircle = null;
    return;
  }
  const latLng = [p.latitude, p.longitude];
  if (accuracyCircle) accuracyCircle.setLatLng(latLng).setRadius(p.accuracyM);
  else
    accuracyCircle = L.circle(latLng, {
      radius: p.accuracyM,
      className: "accuracy-circle",
      interactive: false,
    }).addTo(map);
}

function describePicked() {
  const coords = formatCoords(picked.latitude, picked.longitude);
  if (picked.source === "map") {
    setSheet({
      iconId: "i-tap",
      title: "Punto elegido en el mapa",
      detail: `${coords}<br><span class="muted">Podés arrastrar el pin para ajustarlo.</span>`,
      tone: "ok",
    });
    return;
  }
  const low = picked.accuracyM > GPS_LOW_ACCURACY_M;
  setSheet({
    iconId: "i-gps",
    title: low ? "Ubicación actual (precisión baja)" : "Tu ubicación actual",
    detail:
      `${coords} · <strong>${escapeHtml(formatAccuracy(picked.accuracyM))}</strong>` +
      (low
        ? `<br><span class="warn">Probá de nuevo al aire libre o ajustá el pin en el mapa.</span>`
        : `<br><span class="muted">Podés arrastrar el pin para ajustarlo.</span>`),
    tone: low ? "warn" : "ok",
  });
}

function pick(p, { center = false } = {}) {
  picked = p;
  const latLng = [p.latitude, p.longitude];
  if (pickedMarker) pickedMarker.setLatLng(latLng);
  else {
    pickedMarker = L.marker(latLng, { icon: newPin(), draggable: true, zIndexOffset: 1000 }).addTo(map);
    pickedMarker.on("dragend", () => {
      cancelGps();
      const ll = pickedMarker.getLatLng();
      pick({ latitude: ll.lat, longitude: ll.lng, source: "map", accuracyM: null });
    });
  }
  showAccuracy(p);
  if (center) map.setView(latLng, Math.max(map.getZoom(), 18));
  $("saveLocation").disabled = saving;
  $("mapLegend").hidden = !currentMarker;
  describePicked();
}

$("useGps").addEventListener("click", () => {
  if (gps) {
    cancelGps();
    if (!picked) resetSheet();
    else describePicked();
    return;
  }
  setGpsButton(true);
  setSheet({ iconId: "i-gps", title: "Buscando señal GPS…", detail: "Quedate quieto unos segundos.", tone: "busy" });
  const run = locateBest((p) => {
    if (gps !== run) return;
    pick({ latitude: p.latitude, longitude: p.longitude, source: "gps", accuracyM: p.accuracy }, { center: true });
    setSheet({
      iconId: "i-gps",
      title: "Afinando la precisión…",
      detail: `${formatCoords(p.latitude, p.longitude)} · ${escapeHtml(formatAccuracy(p.accuracy))}`,
      tone: "busy",
    });
  });
  gps = run;
  run.promise
    .then((p) => {
      if (gps !== run) return;
      gps = null;
      setGpsButton(false);
      pick({ latitude: p.latitude, longitude: p.longitude, source: "gps", accuracyM: p.accuracy }, { center: true });
    })
    .catch((e) => {
      if (gps !== run) return;
      gps = null;
      setGpsButton(false);
      setSheet({ iconId: "i-pin-off", title: "No se pudo usar el GPS", detail: escapeHtml(e.message), tone: "error" });
    });
});

$("saveLocation").addEventListener("click", async () => {
  if (!picked || !store || saving) return;
  cancelGps();
  const p = picked;
  const next = store.changeCount + 1;
  const how =
    p.source === "gps" ? `tu ubicación actual (GPS ${escapeHtml(formatAccuracy(p.accuracyM))})` : "el punto elegido en el mapa";
  const ok = await confirmDialog({
    title: "¿Guardar esta ubicación?",
    body:
      `<p><strong>${escapeHtml(store.name)}</strong> quedará en ${how}:</p>` +
      `<p class="dialog-coords">${formatCoords(p.latitude, p.longitude)}</p>` +
      `<p class="muted">${store.latitude != null ? "Reemplaza la coordenada actual. " : ""}Será el cambio n.º ${next} de esta tienda.</p>`,
    accept: "Guardar",
  });
  if (!ok || picked !== p) return;

  saving = true;
  const btn = $("saveLocation");
  btn.disabled = true;
  btn.lastChild.textContent = " Guardando…";
  try {
    const result = await registerLocation(getToken(), store.id, p);
    updateStore(result.store);
    toast(`Ubicación guardada · cambio n.º ${result.store.changeCount}`, "ok");
    back();
  } catch (e) {
    handleDataError(e);
    btn.disabled = false;
  } finally {
    saving = false;
    btn.lastChild.textContent = " Guardar";
  }
});

export const locateScreen = {
  id: "screenLocate",
  parent: ({ id }) => `/tiendas/${id}`,
  async enter({ id }) {
    ensureMap();
    clearPicked();
    resetSheet();
    setTimeout(() => map.invalidateSize(), 50);

    store = findStore(id);
    if (!store) {
      try {
        await loadStores();
      } catch (e) {
        handleDataError(e);
        return;
      }
      store = findStore(id);
    }
    if (!store) {
      setSheet({ iconId: "i-pin-off", title: "Tienda no encontrada", detail: "", tone: "error" });
      $("useGps").disabled = true;
      return;
    }
    $("useGps").disabled = false;
    $("locateTitle").textContent = store.name;

    if (currentMarker) currentMarker.remove();
    currentMarker = null;
    if (store.latitude != null) {
      const latLng = [store.latitude, store.longitude];
      currentMarker = L.marker(latLng, { icon: currentPin(), interactive: false }).addTo(map);
      map.setView(latLng, 17, { animate: false });
    } else {
      map.setView(DEFAULT_CENTER, 8, { animate: false });
    }
  },
  leave() {
    cancelGps();
  },
};
