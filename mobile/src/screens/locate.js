// Registrar la ubicación de una tienda: SOLO con la ubicación actual del teléfono (GPS).
// El mapa es de referencia: no se puede mover, hacer zoom ni elegir un punto.
// Sirve a los dos módulos (#/tiendas/:id/ubicar y #/facturas/:id/ubicar).
import L from "leaflet";
import { DEFAULT_CENTER, GPS_LOW_ACCURACY_M } from "../config.js";
import { getToken, isAdmin } from "../lib/access.js";
import { escapeHtml, formatAccuracy, formatCoords } from "../lib/format.js";
import { locateBest } from "../lib/geo.js";
import { currentPin, newPin, tileLayer } from "../lib/map.js";
import { $, confirmDialog, icon, toast } from "../lib/ui.js";
import { back, go } from "../router.js";
import { MODULES, findStore, loadStores, updateStore } from "../state.js";
import { handleDataError } from "./common.js";

const GPS_ZOOM = 18;

let map;
let currentMarker = null; // coordenada que la tienda tiene hoy (gris)
let gpsMarker = null; // ubicación actual del teléfono (verde)
let accuracyCircle = null;
let gps = null; // búsqueda de GPS en curso
let module = "stores";
let store = null;
let picked = null; // { latitude, longitude, source: "gps", accuracyM }
let saving = false;

function ensureMap() {
  if (map) return;
  // Mapa fijo: sin arrastrar, sin zoom y sin tocar para elegir.
  map = L.map("locateMap", {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
  }).setView(DEFAULT_CENTER, 8);
  tileLayer().addTo(map);
}

function setSheet({ iconId, title, detail, tone = "" }) {
  $("locateIcon").innerHTML = icon(iconId);
  $("locateIcon").className = "sheet-icon" + (tone ? " " + tone : "");
  $("locateStatus").textContent = title;
  $("locateDetail").innerHTML = detail;
}

function setGpsButton(busy) {
  const btn = $("useGps");
  btn.classList.toggle("busy", busy);
  btn.disabled = busy;
  btn.querySelector("span").textContent = busy ? "Midiendo…" : "Volver a medir";
}

function cancelGps() {
  if (!gps) return;
  gps.cancel();
  gps = null;
  setGpsButton(false);
}

function clearPosition() {
  picked = null;
  if (gpsMarker) gpsMarker.remove();
  if (accuracyCircle) accuracyCircle.remove();
  gpsMarker = accuracyCircle = null;
  $("saveLocation").disabled = true;
  $("mapLegend").hidden = true;
}

/** Muestra la posición del GPS en el mapa (centrada) y la deja lista para guardar. */
function showPosition(p) {
  picked = { latitude: p.latitude, longitude: p.longitude, source: "gps", accuracyM: p.accuracy };
  const latLng = [p.latitude, p.longitude];
  if (gpsMarker) gpsMarker.setLatLng(latLng);
  else gpsMarker = L.marker(latLng, { icon: newPin(), interactive: false, zIndexOffset: 1000 }).addTo(map);
  if (accuracyCircle) accuracyCircle.setLatLng(latLng).setRadius(p.accuracy);
  else
    accuracyCircle = L.circle(latLng, { radius: p.accuracy, className: "accuracy-circle", interactive: false }).addTo(map);
  map.setView(latLng, GPS_ZOOM, { animate: false });
  $("mapLegend").hidden = !currentMarker;
}

function describePosition() {
  const coords = formatCoords(picked.latitude, picked.longitude);
  const low = picked.accuracyM > GPS_LOW_ACCURACY_M;
  setSheet({
    iconId: "i-gps",
    title: low ? "Ubicación actual (precisión baja)" : "Tu ubicación actual",
    detail:
      `${coords} · <strong>${escapeHtml(formatAccuracy(picked.accuracyM))}</strong>` +
      (low
        ? `<br><span class="warn">Salí al aire libre, esperá unos segundos y tocá “Volver a medir”.</span>`
        : `<br><span class="muted">Si no estás en la tienda, acercate y volvé a medir.</span>`),
    tone: low ? "warn" : "ok",
  });
}

function measure() {
  cancelGps();
  clearPosition();
  setGpsButton(true);
  setSheet({ iconId: "i-gps", title: "Buscando señal GPS…", detail: "Quedate quieto unos segundos.", tone: "busy" });
  const run = locateBest((p) => {
    if (gps !== run) return;
    showPosition(p);
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
      showPosition(p);
      describePosition();
      $("saveLocation").disabled = saving;
    })
    .catch((e) => {
      if (gps !== run) return;
      gps = null;
      setGpsButton(false);
      clearPosition();
      setSheet({ iconId: "i-pin-off", title: "No se pudo obtener tu ubicación", detail: escapeHtml(e.message), tone: "error" });
    });
}

$("useGps").addEventListener("click", measure);

$("saveLocation").addEventListener("click", async () => {
  if (!picked || !store || saving) return;
  const p = picked;
  const next = store.changeCount + 1;
  const ok = await confirmDialog({
    title: "¿Guardar esta ubicación?",
    body:
      `<p><strong>${escapeHtml(store.name)}</strong> quedará en tu ubicación actual ` +
      `(GPS ${escapeHtml(formatAccuracy(p.accuracyM))}):</p>` +
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
    const result = await MODULES[module].registerLocation(getToken(), store.id, p);
    updateStore(result.store, module);
    toast(`Ubicación guardada · cambio n.º ${result.store.changeCount}`, "ok");
    // El transportista termina acá: vuelve al inicio, listo para la próxima factura.
    if (isAdmin()) back();
    else go(MODULES[module].base, { replace: true });
  } catch (e) {
    handleDataError(e);
    btn.disabled = false;
  } finally {
    saving = false;
    btn.lastChild.textContent = " Guardar";
  }
});

function locateScreenFor(key) {
  return {
    id: "screenLocate",
    parent: ({ id }) => `${MODULES[key].base}/${id}`,
    async enter({ id }) {
      ensureMap();
      cancelGps();
      clearPosition();
      setTimeout(() => map.invalidateSize(), 50);

      module = key;
      store = findStore(id, key);
      if (!store) {
        try {
          await loadStores({ module: key });
        } catch (e) {
          handleDataError(e);
          return;
        }
        store = findStore(id, key);
      }
      if (!store) {
        setSheet({ iconId: "i-pin-off", title: "Tienda no encontrada", detail: "", tone: "error" });
        $("useGps").disabled = true;
        return;
      }
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
      measure(); // la única forma de registrar: arranca el GPS al entrar
    },
    leave() {
      cancelGps();
    },
  };
}

// Solo el registro nuevo: en el registro viejo ya no se registran ubicaciones.
export const invoiceLocateScreen = locateScreenFor("invoice");
