import { Capacitor } from "@capacitor/core";

const env = import.meta.env;

/** "api" (backend FastAPI) o "supabase". */
export const DATA_PROVIDER = (env.VITE_DATA_PROVIDER || "api").trim().toLowerCase();

/**
 * Base de la API v2. En la app instalada (Android) se usa VITE_API_URL; en el navegador, la
 * misma dirección desde la que se abrió la app (FastAPI la sirve en "/" y Vite hace de proxy).
 */
export const API_BASE = Capacitor.isNativePlatform()
  ? `${(env.VITE_API_URL || "").replace(/\/+$/, "")}/api/v2`
  : "api/v2";

export const SUPABASE_URL = env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || "";

/** Centro de Costa Rica, para abrir el mapa cuando la tienda no tiene coordenada. */
export const DEFAULT_CENTER = [9.9325, -84.0796];

/** Por encima de esta precisión (metros) se avisa que el GPS es poco confiable. */
export const GPS_LOW_ACCURACY_M = 50;
/** Con esta precisión (metros) o mejor se deja de esperar al GPS. */
export const GPS_GOOD_ACCURACY_M = 15;
/** Tiempo máximo buscando una buena señal GPS. */
export const GPS_MAX_WAIT_MS = 12000;
