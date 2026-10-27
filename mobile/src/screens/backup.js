// Pestaña Respaldo: descargar/restaurar respaldo JSON y descargar las tiendas en CSV.
import { exportBackup, restoreBackup } from "../data/index.js";
import { getToken } from "../lib/access.js";
import { pickTextFile, saveTextFile, timestampedName, toCsv } from "../lib/files.js";
import { escapeHtml, formatDateTime } from "../lib/format.js";
import { $, confirmDialog, setMsg, toast } from "../lib/ui.js";
import { loadStores, resetState } from "../state.js";
import { handleDataError } from "./common.js";

/** Columnas del CSV: las 5 primeras son las que entiende backend/scripts/import_stores.py. */
const CSV_HEADERS = ["code", "name", "address", "latitude", "longitude", "change_count", "location_updated_at"];

async function busy(btn, label, task) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.lastChild.textContent = ` ${label}`;
  setMsg("backupMsg", "");
  try {
    await task();
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message) setMsg("backupMsg", message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/** Guarda el archivo y avisa dónde quedó; en Android ofrece compartirlo. */
async function deliver(name, content, mime, what) {
  const saved = await saveTextFile(name, content, mime);
  if (!saved.share) {
    toast(`${what} descargado (${name}).`, "ok");
    return;
  }
  const share = await confirmDialog({
    title: `${what} guardado`,
    body: saved.where
      ? `<p>Quedó en <strong>${escapeHtml(saved.where)}</strong> como:</p><p class="dialog-coords">${escapeHtml(name)}</p>` +
        `<p class="muted">¿Querés enviarlo también a Drive, correo o WhatsApp?</p>`
      : `<p>Para conservarlo, compartilo a Drive, correo o WhatsApp.</p>`,
    accept: "Compartir",
    cancel: "Listo",
  });
  if (share) await saved.share().catch(() => {}); // cancelar el menú de compartir no es un error
}

$("exportBackup").addEventListener("click", (e) =>
  busy(e.currentTarget, "Preparando…", async () => {
    const backup = await exportBackup(getToken());
    await deliver(
      timestampedName("olocation-respaldo", "json"),
      JSON.stringify(backup, null, 2),
      "application/json",
      "Respaldo"
    );
  })
);

$("exportCsv").addEventListener("click", (e) =>
  busy(e.currentTarget, "Preparando…", async () => {
    const stores = await loadStores({ force: true });
    const rows = stores.map((s) => [
      s.code, s.name, s.address, s.latitude, s.longitude, s.changeCount, s.locationUpdatedAt,
    ]);
    await deliver(timestampedName("olocation-tiendas", "csv"), toCsv(CSV_HEADERS, rows), "text/csv", "CSV");
  })
);

/** "3 tiendas y 1 registro de ubicación". */
function counts(stores, changes) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `${n(stores, "tienda", "tiendas")} y ${n(changes, "registro de ubicación", "registros de ubicación")}`;
}

/** Validación básica del archivo antes de enviarlo (el servidor valida todo en detalle). */
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un JSON válido.");
  }
  if (data?.format !== "olocation-backup" || !Array.isArray(data.stores)) {
    throw new Error("El archivo no es un respaldo de OLOCATION.");
  }
  if (data.version !== 1) throw new Error(`Versión de respaldo no soportada (${data.version}).`);
  return data;
}

$("importBackup").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  setMsg("backupMsg", "");
  let file;
  let backup;
  try {
    // Sin filtro de tipo: en Android un .json recibido por WhatsApp/Drive puede venir como
    // "application/octet-stream" y quedaría oculto. El contenido se valida abajo.
    file = await pickTextFile("");
    if (!file) return;
    backup = parseBackup(file.text);
  } catch (err) {
    setMsg("backupMsg", err.message, "error");
    return;
  }
  const countChanges = (list) => list.reduce((n, s) => n + (Array.isArray(s.changes) ? s.changes.length : 0), 0);
  // Respaldos anteriores al registro nuevo no lo traen: ese módulo queda como está.
  const invoice = Array.isArray(backup.invoiceStores) ? backup.invoiceStores : null;
  const ok = await confirmDialog({
    title: "¿Restaurar este respaldo?",
    body:
      `<p class="dialog-coords">${escapeHtml(file.name)}</p>` +
      `<p>Registro viejo: ${counts(backup.stores.length, countChanges(backup.stores))}.<br>` +
      (invoice
        ? `Registro nuevo: ${counts(invoice.length, countChanges(invoice))}.`
        : `<span class="muted">Este respaldo no trae el registro nuevo: ese registro no se modifica.</span>`) +
      (backup.exportedAt ? `<br><span class="muted">Guardado el ${escapeHtml(formatDateTime(backup.exportedAt))}</span>` : "") +
      `</p><p class="warn"><strong>Se borran todos los datos actuales</strong> y se reemplazan por los del ` +
      `archivo. No se puede deshacer: si no tenés un respaldo de lo actual, descargalo primero.</p>`,
    accept: "Restaurar",
  });
  if (!ok) return;
  await busy(btn, "Restaurando…", async () => {
    const result = await restoreBackup(getToken(), backup);
    resetState(); // el listado se vuelve a cargar al abrir Tiendas
    setMsg(
      "backupMsg",
      `Respaldo restaurado. Registro viejo: ${counts(result.stores, result.changes)}.` +
        (invoice ? ` Registro nuevo: ${counts(result.invoiceStores, result.invoiceChanges)}.` : ""),
      "ok"
    );
    toast("Respaldo restaurado.", "ok");
  });
});

export const backupScreen = {
  id: "screenBackup",
  parent: () => "/tiendas",
  enter() {},
};
