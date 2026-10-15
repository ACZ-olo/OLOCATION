// Piezas de mapa compartidas (Leaflet + teselas de OpenStreetMap).
import L from "leaflet";

export const tileLayer = () =>
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

const pinSvg = (fill, inner) =>
  '<svg width="36" height="46" viewBox="0 0 36 46" aria-hidden="true">' +
  `<path d="M18 45S2 28.5 2 17a16 16 0 0 1 32 0c0 11.5-16 28-16 28Z" fill="${fill}" stroke="#fff" stroke-width="3"/>` +
  `<rect x="11" y="10" width="14" height="14" rx="2" fill="${inner}"/></svg>`;

const pin = (cls, fill, inner) =>
  L.divIcon({ className: `olo-pin ${cls}`, html: pinSvg(fill, inner), iconSize: [36, 46], iconAnchor: [18, 45] });

/** Pin verde OLO: el punto nuevo que se va a guardar. */
export const newPin = () => pin("new", "#00a785", "#251e1f");
/** Pin gris: la coordenada que la tienda tiene hoy. */
export const currentPin = () => pin("current", "#7a8285", "#ffffff");
