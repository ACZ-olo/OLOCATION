// Leer los campos que identifican la tienda en una factura escaneada:
//   CODIGO: 020210215                       → código del cliente
//   NOMBRE: NUEVA AGRICULTURA NOVAGRO S.A   → nombre del cliente (debajo del código)
//   DIRECCION: …                            → dirección de facturación
//   Observaciones: … ENTREGAR EN PITAL      → lugar real de entrega (define la sucursal)
// El encabezado (nombre del proveedor que emite la factura) se ignora: es igual en todas.
// Con la posición de cada renglón se busca el valor a la derecha (o debajo) de su etiqueta; si el
// OCR no da posiciones, se busca en el texto renglón por renglón.

const LABELS = {
  code: /c?[oó0]d[iíl1]g[oó0]\b\s*:?/i, // a veces el OCR se come la "C" ("ODIGO:")
  name: /\bn[oó0]mbre\b\s*:?/i,
  address: /\bdirecc[iíl1][oó0]n\b\s*:?/i,
  notes: /\b[oó0]bservac[iíl1][oó0]nes\b\s*:?/i,
};
// Otras etiquetas del recuadro del cliente: un valor nunca puede ser una de ellas.
const OTHER_LABEL = /^(c[oó0]digo|n[oó0]mbre|direcci[oó0]n|fecha|tel[eé]fono|hora|vence|contribuyente|zona|ruta|v[ií]a|aut)\b/i;
// Totales a la derecha del recuadro de observaciones.
const TOTALS_LABEL = /^(sub\s*total|descuento|impuesto|total|i\.?v\.?a\.?)\b|₡/i;
// Donde empiezan los totales cuando el OCR los junta en el mismo renglón de las observaciones.
const TOTALS_INSIDE = /\b(sub\s*total|descuentos?|impuestos?|total\s*[:₡\d])|₡/i;
/** Lo que se registra cuando el recuadro de observaciones está vacío. */
export const NO_NOTES = "Sin observaciones";
// El OCR puede leer toda una fila de la factura como un solo renglón
// ("NOMBRE: NOVAGRO S.A TELEFONO: 2473…"): el valor termina donde empieza la etiqueta siguiente.
const NEXT_LABEL =
  /\b(tramitar|fecha|tel[eé]fono|hora|vence|contribuyente|zona|ruta|direcci[oó]n|nombre|subtotal|descuento\w*|impuesto)\b/i;
const PLACE = /entregar\s*en\s*:?\s*([^\n,.;]{2,60})/i;

const h = (b) => Math.max(1, b.bottom - b.top);
const midY = (b) => (b.top + b.bottom) / 2;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Valor sin la etiqueta siguiente ni los signos sueltos del principio ("— NOVAGRO" → "NOVAGRO"). */
function cut(value) {
  const text = clean(value);
  const m = text.match(NEXT_LABEL);
  return clean(m ? text.slice(0, m.index) : text).replace(/^[^\p{L}\p{N}]+/u, "");
}

// El código de cliente tiene siempre 9 números: con otra cantidad, la foto se leyó mal.
const CODE_DIGITS = 9;

/**
 * Número al principio del valor, corrigiendo letras que el OCR confunde con números
 * ("O2O21O215" → "020210215"). Devuelve "" si no hay un número.
 */
function numberOf(text) {
  const fixed = text.replace(/[oO]/g, "0").replace(/[lI|]/g, "1").replace(/[sS]/g, "5").replace(/B/g, "8");
  return /^\d[\d-]{3,}\d$/.test(fixed) ? fixed.replace(/\D/g, "") : "";
}

/** Código de 9 números al principio del valor, o "" si no lo hay (o tiene otra cantidad). */
function codeOf(value) {
  const [a = "", b = ""] = clean(value).split(" ");
  // "0202 10215": el OCR a veces parte el número en dos.
  const candidates = [/^\d+$/.test(b) ? numberOf(a + b) : "", numberOf(a)];
  return candidates.find((c) => c.length === CODE_DIGITS) || "";
}

/** Texto de la etiqueta en adelante, dentro del mismo renglón ("NOMBRE: NOVAGRO" → "NOVAGRO"). */
function afterLabel(text, re) {
  const m = text.match(re);
  return m ? cut(text.slice(m.index + m[0].length)) : "";
}

/** Renglones a la derecha de la etiqueta, en la misma fila (tolera la foto un poco inclinada). */
function rightOf(lines, label) {
  const lb = label.box;
  return lines
    .filter((l) => l !== label && l.box.left >= lb.right - h(lb) && Math.abs(midY(l.box) - midY(lb)) < h(lb) * 0.8)
    .sort((a, b) => a.box.left - b.box.left);
}

/** Renglones debajo de la etiqueta, en su misma columna, hasta `rows` alturas de renglón. */
function below(lines, label, rows, maxLeft) {
  const lb = label.box;
  return lines
    .filter(
      (l) =>
        l !== label &&
        l.box.top >= lb.bottom - h(lb) * 0.5 &&
        l.box.top <= lb.bottom + h(lb) * rows &&
        l.box.left >= lb.left - h(lb) * 3 &&
        l.box.left <= maxLeft
    )
    .sort((a, b) => a.box.top - b.box.top);
}

function fromLayout(lines) {
  const fields = {};
  const width = Math.max(...lines.map((l) => l.box.right)) - Math.min(...lines.map((l) => l.box.left));
  const labelsOf = (re) => lines.filter((l) => re.test(l.text)).sort((a, b) => a.box.top - b.box.top);
  const isValue = (l) => !OTHER_LABEL.test(clean(l.text)) && cut(l.text);
  const valueOf = (label, re) => {
    const own = afterLabel(label.text, re);
    if (own) return own;
    const next = rightOf(lines, label)[0];
    return next && isValue(next) ? cut(next.text) : "";
  };

  // El código del cliente es SOLO el de arriba a la izquierda de la factura. "CODIGO" también es
  // el título de la columna de productos: ese nunca se usa, aunque tenga un número al lado.
  const left = Math.min(...lines.map((l) => l.box.left));
  const top = Math.min(...lines.map((l) => l.box.top));
  const height = Math.max(...lines.map((l) => l.box.bottom)) - top;
  const codeLabel =
    labelsOf(LABELS.code).find((l) => l.box.left < left + width * 0.5 && l.box.top < top + height * 0.5) || null;
  if (codeLabel) fields.code = codeOf(valueOf(codeLabel, LABELS.code));

  const nameLabel = labelsOf(LABELS.name)[0];
  if (nameLabel) fields.name = valueOf(nameLabel, LABELS.name);
  if (!fields.name && codeLabel) {
    // Sin la etiqueta NOMBRE: el renglón que está justo debajo del código.
    const next = below(lines, codeLabel, 2.5, Infinity).find(isValue);
    if (next) fields.name = cut(next.text);
  }

  const addressLabel = labelsOf(LABELS.address)[0];
  if (addressLabel) {
    // La dirección suele ir en el renglón de abajo, no al lado de la etiqueta.
    const next = below(lines, addressLabel, 2.5, addressLabel.box.left + width * 0.5).find(isValue);
    fields.address = afterLabel(addressLabel.text, LABELS.address) || (next ? cut(next.text) : "");
  }

  const notesLabel = labelsOf(LABELS.notes).pop(); // el recuadro está abajo de la factura
  if (notesLabel) fields.notes = notesBelow(lines, notesLabel);
  return fields;
}

/** Renglones agrupados por fila (los pedazos de una misma fila, de izquierda a derecha). */
function rowsOf(lines) {
  const rows = [];
  for (const l of [...lines].sort((a, b) => midY(a.box) - midY(b.box))) {
    const row = rows.find((r) => Math.abs(midY(r[0].box) - midY(l.box)) < h(r[0].box) * 0.6);
    if (row) row.push(l);
    else rows.push([l]);
  }
  return rows.map((r) => r.sort((a, b) => a.box.left - b.box.left));
}

/**
 * Observaciones: SOLO el texto que está justo debajo de la etiqueta (normalmente un renglón,
 * a lo sumo dos seguidos), nunca lo de alrededor: ni los totales de la derecha ni el pie de página.
 * Si debajo no hay nada → NO_NOTES. Si hay algo pero no se entiende → "" (mejor vacío que inventado).
 */
function notesBelow(lines, label) {
  const lb = label.box;
  const lh = h(lb);
  // A la derecha del recuadro están los totales: el texto llega hasta donde empiezan.
  const totals = lines.filter(
    (l) => l !== label && l.box.left > lb.right && TOTALS_LABEL.test(clean(l.text)) && l.box.top < lb.bottom + lh * 4
  );
  const maxRight = totals.length ? Math.min(...totals.map((l) => l.box.left)) : Infinity;
  const candidates = lines.filter(
    (l) => l !== label && l.box.top >= lb.bottom - lh * 0.5 && l.box.left < maxRight && l.box.right > lb.left - lh * 3
  );

  const taken = [];
  let prev = lb;
  for (const row of rowsOf(candidates)) {
    const first = row[0].box;
    // Primer renglón pegado a la etiqueta y empezando debajo de ella; el segundo, pegado al primero.
    const gap = first.top - prev.bottom;
    if (gap > (taken.length ? h(prev) * 0.8 : lh * 1.8)) break;
    if (first.left > lb.right + lh * 4) break;
    const raw = row.map((l) => l.text).join(" ");
    const text = notesText(raw);
    if (!text) {
      // Algo hay pero no se entiende (las rayas del recuadro no cuentan): no se puede decir que
      // no haya observaciones.
      if (raw.replace(/[\s\-_|—=.]/g, "").length >= 2 && !taken.length) return "";
      break;
    }
    taken.push(text);
    prev = row.reduce((b, l) => (l.box.bottom > b.bottom ? l.box : b), first);
    if (taken.length === 2) break;
  }

  // El texto en el mismo renglón de la etiqueta ("Observaciones: ENTREGAR EN PITAL") también vale.
  const own = notesText(afterText(label.text, LABELS.notes));
  const notes = [own, ...taken].filter(Boolean).join(" ");
  if (!notes) return NO_NOTES;
  return legible(notes) ? notes : "";
}

/** Texto después de la etiqueta, sin recortarlo (las observaciones son texto libre). */
function afterText(text, re) {
  const m = text.match(re);
  return m ? text.slice(m.index + m[0].length) : "";
}

/** Texto de observaciones hasta donde empiezan los totales, sin signos sueltos en las puntas. */
function notesText(value) {
  const text = clean(value);
  const m = text.match(TOTALS_INSIDE);
  return clean(m ? text.slice(0, m.index) : text)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}.)]+$/u, "");
}

/** true si el texto parece escrito de verdad y no basura del OCR (foto borrosa o cortada). */
function legible(text) {
  const chars = text.replace(/\s/g, "");
  const words = text.split(" ");
  const real = words.filter((w) => /^[\p{L}\p{N}][\p{L}\p{N}.,:;/#()-]*$/u.test(w) && /[\p{L}\p{N}]{2}/u.test(w));
  return (
    letters(text) >= 3 &&
    letters(text) + digits(text) >= chars.length * 0.75 &&
    real.length >= words.length * 0.7 &&
    words.some((w) => letters(w) >= 3)
  );
}

function fromText(text) {
  const fields = {};
  const rows = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  let codeRow = false;
  rows.forEach((row, i) => {
    // Solo el primer CODIGO (el del cliente, arriba); los siguientes son de la tabla de productos.
    if (!codeRow && LABELS.code.test(row)) {
      codeRow = true;
      fields.code = codeOf(afterLabel(row, LABELS.code) || rows[i + 1]);
    }
    const next = rows[i + 1] && !OTHER_LABEL.test(rows[i + 1]) ? cut(rows[i + 1]) : "";
    if (!fields.name && LABELS.name.test(row)) {
      fields.name = afterLabel(row, LABELS.name) || next;
    }
    if (!fields.address && LABELS.address.test(row)) {
      fields.address = afterLabel(row, LABELS.address) || next;
    }
    if (LABELS.notes.test(row)) {
      // Sin posiciones no se sabe qué está debajo de la etiqueta: solo vale lo del mismo renglón,
      // y si no hay nada queda vacío (no se adivina).
      const own = notesText(afterText(row, LABELS.notes));
      fields.notes = own && legible(own) ? own : "";
    }
  });
  return fields;
}

/**
 * Campos de la factura a partir del resultado del OCR ({ text, lines }).
 * Devuelve { code, name, address, notes, place, text } (los que no se encontraron quedan vacíos).
 * Antes de usarlos, revisar invoiceReadOk().
 */
export function parseInvoice({ text = "", lines = [] } = {}) {
  const usable = lines.filter((l) => l.box && clean(l.text));
  const layout = usable.length ? fromLayout(usable) : {};
  const plain = fromText(text);
  // Con posiciones manda el código de arriba a la izquierda; si el texto corrido da otro, no es
  // confiable y se descarta.
  const code = usable.length
    ? layout.code && (!plain.code || plain.code === layout.code) ? layout.code : ""
    : plain.code || "";
  const fields = {
    code,
    name: layout.name || plain.name || "",
    address: layout.address || plain.address || "",
    // Con posiciones, las observaciones salen solo de lo que está debajo de la etiqueta: el texto
    // corrido podría dar cualquier renglón vecino.
    notes: (usable.length ? layout.notes : plain.notes) || "",
  };
  // "… ENTREGAR EN PITAL": el lugar de entrega, en las observaciones o en cualquier parte.
  const place = (fields.notes.match(PLACE) || String(text).match(PLACE) || [])[1];  fields.place = cut(place);
  fields.text = text;
  return fields;
}

const letters = (s) => (String(s || "").match(/\p{L}/gu) || []).length;
const digits = (s) => (String(s || "").match(/\p{N}/gu) || []).length;

/**
 * true si la factura se leyó bien: código de 9 números (lo más importante) y un nombre legible.
 * Si no, no se registra nada y se pide otra foto.
 */
export function invoiceReadOk({ code, name }) {
  // Un nombre de verdad tiene letras; basura del OCR suele ser casi todo símbolos.
  const nameOk = letters(name) >= 3 && letters(name) >= name.replace(/\s/g, "").length / 2;
  return Boolean(code) && nameOk;
}
