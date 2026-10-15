const LOCALE = "es-CR";

export const formatCoords = (lat, lng, digits = 6) => `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** "hoy", "ayer", "hace 3 días" o la fecha, para listas. */
export function formatRelative(iso) {
  const d = new Date(iso);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days > 1 && days < 7) return `hace ${days} días`;
  return formatDate(iso);
}

export const formatAccuracy = (m) => (m == null ? "" : `±${m < 10 ? m.toFixed(1) : Math.round(m)} m`);

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Texto para buscar: minúsculas y sin tildes ("Panadería" → "panaderia"). */
export const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
