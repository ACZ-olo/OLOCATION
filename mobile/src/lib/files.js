// Guardar y abrir archivos. En el navegador: descarga normal y selector de archivos.
// En Android (Capacitor) el WebView no descarga archivos: se guardan con el plugin Filesystem en
// Documentos/OLOCATION y se pueden compartir (Drive, correo, WhatsApp…) con el plugin Share.
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const FOLDER = "OLOCATION";

/** "olocation-respaldo-2026-10-15-1430.json" (fecha y hora local). */
export function timestampedName(prefix, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/**
 * Guarda un archivo de texto. Devuelve { where, share } donde `where` describe dónde quedó y
 * `share()` (solo en Android) abre el menú para compartirlo; en el navegador `share` es null.
 */
export async function saveTextFile(name, content, mime) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { where: "la carpeta de descargas", share: null };
  }

  let uri;
  let where;
  try {
    ({ uri } = await Filesystem.writeFile({
      path: `${FOLDER}/${name}`,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    }));
    where = `Documentos/${FOLDER}`;
  } catch {
    // Sin acceso a Documentos (p. ej. permiso denegado en Android viejo): se guarda en la
    // caché de la app y hay que compartirlo para conservarlo.
    ({ uri } = await Filesystem.writeFile({
      path: name,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    }));
    where = null;
  }
  return {
    where,
    share: () => Share.share({ title: name, files: [uri], dialogTitle: "Compartir archivo" }),
  };
}

/** Abre el selector de archivos y devuelve el texto del archivo elegido (o null si se cancela). */
export function pickTextFile(accept) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** CSV (RFC 4180) con BOM UTF-8 para que Excel muestre bien las tildes. */
export function toCsv(headers, rows) {
  const cell = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
