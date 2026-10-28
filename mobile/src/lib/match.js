// Buscar en el listado la tienda de una factura escaneada (campos de lib/invoice.js).
//   1. Código del cliente: si coincide con el código de la tienda, es la señal más fuerte.
//   2. Nombre: las palabras del nombre de la tienda tienen que aparecer en el nombre, la
//      dirección o las observaciones de la factura (no en el encabezado del proveedor).
//   3. Lugar de entrega (observaciones, "ENTREGAR EN …"): elige la sucursal entre varias del
//      mismo cliente.
// El OCR comete errores ("PAL1" por "PALI"), así que las palabras largas se comparan con
// tolerancia. Las palabras que se repiten en muchas tiendas ("super", "farmacia") pesan menos
// que las que identifican a una sola.
import { normalize } from "./format.js";
import { NO_NOTES } from "./invoice.js";

const STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "y", "e", "en", "al", "a", "o",
  "sa", "srl", "ltda", "cia", "inc", "corp",
]);
const MIN_COVERAGE = 0.6; // fracción (ponderada) del nombre que tiene que aparecer en la factura
const MAX_RESULTS = 8;
const FUZZY_CREDIT = 0.8; // una palabra parecida cuenta menos que una idéntica

const words = (s) => normalize(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const compact = (s) => normalize(s).replace(/[^a-z0-9]/g, "");
const noZeros = (s) => s.replace(/^0+/, "");

/** Palabras que identifican: sin artículos ni números o letras sueltas. */
const keyWords = (s) => [...new Set(words(s).filter((w) => w.length > 1 && !STOPWORDS.has(w)))];

/** Distancia de edición, cortando apenas supera `max`. */
function withinDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/**
 * Para un texto, devuelve found(palabra) → 1 si aparece igual, FUZZY_CREDIT si aparece parecida,
 * 0 si no aparece. `found.exact` es el conjunto de palabras (y pares pegados) del texto.
 */
function finder(text) {
  const tokens = words(text);
  const exact = new Set(tokens);
  // Palabras pegadas de a dos, para códigos que el OCR separa ("T 0123" → "t0123").
  for (let i = 0; i < tokens.length - 1; i++) exact.add(tokens[i] + tokens[i + 1]);
  const byLength = new Map();
  for (const t of new Set(tokens)) {
    if (!byLength.has(t.length)) byLength.set(t.length, []);
    byLength.get(t.length).push(t);
  }
  const seen = new Map();
  const found = (w) => {
    if (seen.has(w)) return seen.get(w);
    let credit = exact.has(w) ? 1 : 0;
    // Solo las palabras largas y sin números se comparan con tolerancia: las cortas darían
    // falsos positivos y en los números cada dígito importa ("Sucursal 106" ≠ "Sucursal 108").
    const max = /\d/.test(w) ? 0 : w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0;
    for (let len = w.length - max; !credit && len <= w.length + max; len++) {
      if ((byLength.get(len) || []).some((t) => withinDistance(w, t, max))) credit = FUZZY_CREDIT;
    }
    seen.set(w, credit);
    return credit;
  };
  found.exact = exact;
  return found;
}

// Índice de palabras del listado (cuántas tiendas usan cada palabra), por versión del listado.
let indexFor = null;
let index = null;

function buildIndex(stores) {
  const df = new Map();
  const entries = stores.map((store) => {
    const name = keyWords(store.name);
    for (const w of name) df.set(w, (df.get(w) || 0) + 1);
    const address = keyWords(store.address);
    return { store, name, address, all: [...new Set([...name, ...address])], code: compact(store.code) };
  });
  const n = stores.length;
  const weight = (w) => Math.log(1 + n / (df.get(w) || 1));
  return { entries, weight };
}

/** Fracción ponderada de `list` que aparece según `found`. */
function coverage(list, found) {
  let total = 0;
  let hit = 0;
  for (const w of list) {
    const wt = index.weight(w);
    total += wt;
    hit += wt * found(w);
  }
  return total ? hit / total : 0;
}

/**
 * El código de la factura es el de la tienda, ignorando guiones y ceros a la izquierda: la
 * factura trae el código con un 0 adelante (020210215) y en la app está con 8 dígitos (20210215).
 */
function sameCode(storeCode, invoiceCode) {
  if (!storeCode || !invoiceCode) return false;
  if (storeCode === invoiceCode) return true;
  const digits = storeCode.replace(/\D/g, "");
  return digits.length >= 5 && noZeros(digits) === noZeros(invoiceCode);
}

/** El código difiere en un solo dígito (el OCR leyó mal, se comió o agregó un número). */
function nearCode(storeCode, invoiceCode) {
  const digits = storeCode.replace(/\D/g, "");
  return digits.length >= 5 && withinDistance(noZeros(digits), noZeros(invoiceCode), 1);
}

/**
 * Tiendas que coinciden con la factura, de mejor a peor.
 * `invoice` es el resultado de parseInvoice(). Devuelve [{ store, score, byCode, byPlace }].
 */
export function matchInvoice(invoice, stores) {
  if (!stores?.length || !invoice?.text?.trim()) return [];
  if (indexFor !== stores) {
    index = buildIndex(stores);
    indexFor = stores;
  }

  const notes = invoice.notes === NO_NOTES ? "" : invoice.notes;
  const fields = [invoice.name, invoice.address, notes].filter(Boolean).join("\n");
  // Si la factura no tiene el formato esperado (sin campos), se busca en todo el texto.
  const inFields = finder(fields || invoice.text);
  const inName = finder(invoice.name || "");
  const placeText = invoice.place || notes || "";
  const inPlace = finder(placeText);
  const inAddress = finder(invoice.address || "");
  const invoiceCode = compact(invoice.code);
  // Sin el campo CODIGO: se busca el código de la tienda en cualquier parte del texto.
  const inText = invoiceCode ? null : finder(invoice.text);
  const textNumbers = inText ? new Set([...inText.exact].filter((t) => /^\d{5,}$/.test(t)).map(noZeros)) : null;

  const results = [];
  for (const { store, name, address, all, code } of index.entries) {
    const byCode = invoiceCode
      ? sameCode(code, invoiceCode)
      : code.length >= 3 && (inText.exact.has(code) || textNumbers.has(noZeros(code.replace(/\D/g, ""))));
    const byNearCode = !byCode && !!invoiceCode && nearCode(code, invoiceCode);
    const byName = coverage(name, inFields);
    if (!byCode && !byNearCode && byName < MIN_COVERAGE) continue;
    // Sucursal: las palabras de la tienda que no son el nombre del cliente ("Pital" en
    // "Novagro Pital") tienen que estar en el lugar de entrega.
    const branch = all.filter((w) => !inName(w));
    const place = placeText && branch.length ? coverage(branch, inPlace) : 0;
    // Un código casi igual va antes que cualquier coincidencia solo por nombre (que suma hasta 2).
    const score =
      (byCode ? 4 : byNearCode ? 2.5 : 0) + byName + 0.8 * place + 0.2 * coverage(address, inAddress);
    results.push({ store, score, byCode, byNearCode, byPlace: place >= 0.5 });
  }
  // El código manda: si alguna tienda tiene exactamente el código de la factura, se muestra solo
  // esa (el nombre en la app puede ser distinto al de la factura). Si no, primero las de código
  // casi igual y después las que coinciden por nombre.
  const byCode = results.filter((r) => r.byCode);
  return (byCode.length ? byCode : results).sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
