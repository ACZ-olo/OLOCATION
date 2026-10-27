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
const TOTALS = /^(subtotal|descuento|impuesto|total)\b|₡|^[\d\s.,]+$/i;
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
  if (notesLabel) {
    // Los renglones seguidos debajo de la etiqueta; un salto grande es el texto legal del pie.
    const rest = [];
    let prev = notesLabel.box;
    for (const l of below(lines, notesLabel, 8, notesLabel.box.left + width * 0.55)) {
      if (l.box.top - prev.bottom > h(prev)) break;
      if (!TOTALS.test(clean(l.text))) rest.push(cut(l.text));
      prev = l.box;
    }
    fields.notes = [afterLabel(notesLabel.text, LABELS.notes), ...rest].filter(Boolean).join("\n");
  }
  return fields;
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
      fields.notes = [afterLabel(row, LABELS.notes), ...rows.slice(i + 1, i + 3).filter((t) => !TOTALS.test(t)).map(cut)]
        .filter(Boolean)
        .join("\n");
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
    notes: layout.notes || plain.notes || "",
  };
  // "… ENTREGAR EN PITAL": el lugar de entrega, en las observaciones o en cualquier parte.
  const place = (fields.notes.match(PLACE) || String(text).match(PLACE) || [])[1];
  fields.place = cut(place);
  fields.text = text;
  return fields;
}

const letters = (s) => (String(s || "").match(/\p{L}/gu) || []).length;

/**
 * true si la factura se leyó bien: código de 9 números (lo más importante) y un nombre legible.
 * Si no, no se registra nada y se pide otra foto.
 */
export function invoiceReadOk({ code, name }) {
  // Un nombre de verdad tiene letras; basura del OCR suele ser casi todo símbolos.
  const nameOk = letters(name) >= 3 && letters(name) >= name.replace(/\s/g, "").length / 2;
  return Boolean(code) && nameOk;
}
