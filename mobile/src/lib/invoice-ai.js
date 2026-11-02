// "Ubicación - Observaciones" con ayuda de IA (Edge Function supabase/functions/analyze-invoice).
//
// La IA SOLO mira las observaciones: decide si indican una dirección de entrega (nunca viene
// rotulada como "DIRECCION:") y, si la indican, la normaliza con el formato de la dirección de
// arriba de la factura ("PROVINCIA, CANTON, DISTRITO SEÑAS"). No lee ni corrige el código, el
// nombre ni la dirección del cliente: si el lector (lib/invoice.js) no los leyó, se pide otra foto
// como siempre y no se llama a la IA.
//
// Resultado (campo notesLocation):
//   la dirección normalizada        si las observaciones traen una dirección
//   NO_NOTES_LOCATION               si no la traen, o la factura dice "Sin observaciones"
//   ""                              si no se pudo saber (sin IA, observaciones ilegibles, o la IA
//                                   dio un lugar que no está en la factura): mejor vacío que inventado
import { normalize } from "./format.js";
import { NO_NOTES, invoiceMissing } from "./invoice.js";

/** Lo que se guarda en "Ubicación - Observaciones" cuando las observaciones no traen dirección. */
export const NO_NOTES_LOCATION = "Sin dirección en observaciones";

const MAX_LOCATION = 500;
// Palabras de señas que la normalización puede agregar o reordenar: no cuentan como dato.
const GENERIC = new Set([
  "norte", "sur", "este", "oeste", "metros", "del", "las", "los", "frente", "contiguo",
  "costado", "diagonal", "entrada", "mano", "derecha", "izquierda", "esquina", "por", "con",
]);

const words = (s) => normalize(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const keyWords = (s) => words(s).filter((w) => w.length >= 3 && !GENERIC.has(w));
/** MAYÚSCULAS, sin tildes, espacios simples, sin signos sueltos en las puntas. */
const tidy = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, "")
    .trim();

/** Distancia de edición de a lo sumo 1 (una letra mal leída por el OCR). */
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** found(palabra): la palabra está en `source` (igual, o con una letra distinta si es larga). */
function finder(source) {
  const list = [...new Set(words(source))];
  const set = new Set(list);
  return (w) => set.has(w) || (w.length >= 5 && list.some((t) => withinOne(w, t)));
}

/**
 * Valida la respuesta de la IA. La dirección se acepta solo si sus palabras están en las
 * observaciones o en la dirección de arriba (de ahí salen provincia y cantón) y al menos una
 * viene de las observaciones; si no, la IA inventó algo y se deja vacío.
 */
function locationOf(result, notes, address) {
  if (!result?.notesIsAddress) return NO_NOTES_LOCATION;
  const location = tidy(result.notesLocation).slice(0, MAX_LOCATION);
  const key = keyWords(location);
  if (!key.length) return "";
  if (!key.some(finder(notes))) return "";
  const known = finder(`${notes}\n${address}`);
  return key.filter(known).length >= key.length * 0.8 ? location : "";
}

/**
 * Agrega notesLocation ("Ubicación - Observaciones") a la factura leída (resultado de
 * parseInvoice). `analyze({ notes, address })` llama al servidor (data/index.js → analyzeInvoice)
 * y devuelve { notesIsAddress, notesLocation }.
 *
 * Solo se llama a la IA si la factura se leyó bien (código, nombre y dirección) y las observaciones
 * tienen texto. También devuelve `ai`: "skipped" | "ok" | "error" | "unavailable".
 * Nunca lanza error: sin IA, el escaneo sigue como siempre.
 */
export async function withNotesLocation(invoice, analyze) {
  const out = {
    ...invoice,
    // "Sin observaciones" → no hay dirección. Observaciones ilegibles ("") → no se sabe.
    notesLocation: invoice.notes === NO_NOTES ? NO_NOTES_LOCATION : "",
    ai: "skipped",
  };
  const notes = invoice.notes && invoice.notes !== NO_NOTES ? invoice.notes : "";
  // Factura mal leída: se pide otra foto y no se registra nada, así que no se gasta en la IA.
  if (!notes || invoiceMissing(invoice).length || typeof analyze !== "function") return out;

  try {
    const result = await analyze({ notes, address: invoice.address || "" });
    out.notesLocation = locationOf(result, notes, invoice.address || "");
    out.ai = "ok";
  } catch (e) {
    out.ai = e?.code === "NOT_CONFIGURED" ? "unavailable" : "error";
  }
  return out;
}
