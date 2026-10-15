// Estado compartido entre pantallas (en memoria).
import { listStores } from "./data/index.js";
import { getToken } from "./lib/access.js";

const STALE_MS = 60_000; // el listado se refresca solo si tiene más de un minuto

export const state = {
  stores: null, // Store[] ordenado por nombre
  loadedAt: 0,
  version: 0, // sube cada vez que cambian las tiendas (para no redibujar de más)
};

let loading = null;

/** Carga el listado de tiendas (o usa el que ya hay si es reciente). */
export function loadStores({ force = false } = {}) {
  if (!force && state.stores && Date.now() - state.loadedAt < STALE_MS) {
    return Promise.resolve(state.stores);
  }
  loading ||= listStores(getToken())
    .then((items) => {
      state.stores = items;
      state.loadedAt = Date.now();
      state.version++;
      return items;
    })
    .finally(() => (loading = null));
  return loading;
}

export const findStore = (id) => state.stores?.find((s) => s.id === Number(id)) || null;

/** Reemplaza una tienda con la versión que devolvió el servidor tras registrar su ubicación. */
export function updateStore(store) {
  if (!state.stores) return;
  state.stores = state.stores.map((s) => (s.id === store.id ? store : s));
  state.version++;
}

export function resetState() {
  state.stores = null;
  state.loadedAt = 0;
  state.version++;
}
