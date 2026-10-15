// GPS: en Android usa el plugin nativo de Capacitor (pide el permiso de ubicación);
// en el navegador, navigator.geolocation.
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { GPS_GOOD_ACCURACY_M, GPS_MAX_WAIT_MS } from "../config.js";

export class GeoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // PERMISSION_DENIED | UNAVAILABLE | TIMEOUT | UNSUPPORTED
  }
}

const native = Capacitor.isNativePlatform();
const OPTIONS = { enableHighAccuracy: true, timeout: GPS_MAX_WAIT_MS, maximumAge: 0 };

function toGeoError(err) {
  const msg = String(err?.message || err || "");
  if (err?.code === 1 || /denied|permission/i.test(msg)) {
    return new GeoError(
      "PERMISSION_DENIED",
      "No hay permiso de ubicación. Activalo en Ajustes → Apps → OLOCATION → Permisos."
    );
  }
  if (err?.code === 3 || /timeout|timed out/i.test(msg)) {
    return new GeoError("TIMEOUT", "El GPS no respondió a tiempo. Probá al aire libre o elegí el punto en el mapa.");
  }
  if (/disabled|not enabled|location services/i.test(msg)) {
    return new GeoError("UNAVAILABLE", "La ubicación del teléfono está apagada. Encendela y volvé a intentar.");
  }
  return new GeoError("UNAVAILABLE", "No se pudo obtener la ubicación. Elegí el punto en el mapa.");
}

async function ensurePermission() {
  if (!native) {
    if (!("geolocation" in navigator)) {
      throw new GeoError("UNSUPPORTED", "Este navegador no permite usar el GPS.");
    }
    return;
  }
  let status;
  try {
    status = await Geolocation.checkPermissions();
    if (status.location !== "granted") status = await Geolocation.requestPermissions();
  } catch (e) {
    throw toGeoError(e);
  }
  if (status.location !== "granted") throw toGeoError({ code: 1 });
}

async function watch(onPosition, onError) {
  if (native) {
    const id = await Geolocation.watchPosition(OPTIONS, (pos, err) =>
      err ? onError(err) : pos && onPosition(pos.coords)
    );
    return () => Geolocation.clearWatch({ id });
  }
  const id = navigator.geolocation.watchPosition((pos) => onPosition(pos.coords), onError, OPTIONS);
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Busca la ubicación actual afinando la precisión: escucha el GPS hasta lograr
 * GPS_GOOD_ACCURACY_M o hasta GPS_MAX_WAIT_MS, y se queda con la mejor lectura.
 * `onProgress({ latitude, longitude, accuracy })` se llama con cada mejora.
 * Devuelve { promise, cancel }.
 */
export function locateBest(onProgress = () => {}) {
  let stop = () => {};
  let cancelled = false;
  let done = false;
  let finish;
  const promise = new Promise((resolve, reject) => {
    let best = null;
    let timer;
    finish = (err) => {
      done = true;
      clearTimeout(timer);
      stop();
      if (cancelled) return;
      if (best) resolve(best);
      else reject(err || new GeoError("TIMEOUT", "El GPS no respondió a tiempo. Probá al aire libre o elegí el punto en el mapa."));
    };
    ensurePermission()
      .then(() => {
        if (done) return;
        timer = setTimeout(() => finish(), GPS_MAX_WAIT_MS);
        return watch(
          (c) => {
            if (best && c.accuracy >= best.accuracy) return;
            best = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy };
            onProgress(best);
            if (c.accuracy <= GPS_GOOD_ACCURACY_M) finish();
          },
          (e) => finish(best ? null : toGeoError(e))
        ).then((stopFn) => {
          stop = stopFn;
          if (done) stopFn();
        });
      })
      .catch((e) => {
        clearTimeout(timer);
        if (!cancelled) reject(e instanceof GeoError ? e : toGeoError(e));
      });
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      finish?.();
    },
  };
}
