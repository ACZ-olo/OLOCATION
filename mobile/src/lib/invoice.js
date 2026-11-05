// Leer los campos que identifican la tienda en una factura escaneada:
//   CODIGO: 020210215                       → código del cliente
//   NOMBRE: NUEVA AGRICULTURA NOVAGRO S.A   → nombre del cliente (debajo del código)
//   DIRECCION: …                            → dirección de facturación
//   Observaciones: … ENTREGAR EN PITAL      → lugar real de entrega (define la sucursal)
// El encabezado (nombre del proveedor que emite la factura) se ignora: es igual en todas.
// Con la posición de cada renglón se busca el valor a la derecha (o debajo) de su etiqueta; si el
// OCR no da posiciones, se busca en el texto renglón por renglón.

// Títulos de la tabla de productos (en el mismo renglón que su "CÓDIGO").
const TABLE_HEADER = /descripci[oó]n|cantidad|precio|unidad/i;

const LABELS = {
  // A veces el OCR se come la "C" ("ODIGO:") o lee la G como C ("coDIco:").
  code: /c?[oó0]d[iíl1][gc][oó0]\b\s*:?/i,
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
  return /^\d[\d.-]{3,}\d$/.test(fixed) ? fixed.replace(/\D/g, "") : ""; // "020-215-532", "020.215.532"
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
    // Lo de la derecha, pero no lo del otro lado de la hoja (la fecha, el teléfono…).
    const next = rightOf(lines, label)[0];
    if (!next || !isValue(next) || next.box.left >= label.box.right + width * 0.4) return "";
    // Si la fila de la etiqueta está vacía, lo de al lado puede ser el valor de la fila de abajo
    // (CODIGO vacío → el nombre): el valor es de la etiqueta que le queda más cerca.
    const dist = (l) => Math.abs(midY(l.box) - midY(next.box));
    const closer = lines.some(
      (o) => o !== label && o.box.right <= next.box.left && OTHER_LABEL.test(clean(o.text)) && dist(o) < dist(label)
    );
    return closer ? "" : cut(next.text);
  };

  // Código, nombre y dirección son SOLO los del recuadro del cliente, arriba a la izquierda.
  // "CODIGO" también es el título de la columna de productos, y "DIRECCION" puede aparecer en las
  // observaciones: esos nunca se usan.
  const left = Math.min(...lines.map((l) => l.box.left));
  const top = Math.min(...lines.map((l) => l.box.top));
  const height = Math.max(...lines.map((l) => l.box.bottom)) - top;
  const clientLabel = (re) =>
    labelsOf(re).find((l) => l.box.left < left + width * 0.5 && l.box.top < top + height * 0.5) || null;
  // El título de la columna de productos ("CÓDIGO  DESCRIPCIÓN  CANTIDAD…") no es el del cliente:
  // si la factura no trae el CODIGO del cliente, ese título no puede tomarse en su lugar.
  const tableHeader = (l) =>
    TABLE_HEADER.test(l.text) || rightOf(lines, l).slice(0, 2).some((r) => TABLE_HEADER.test(r.text));
  const codeLabel =
    labelsOf(LABELS.code).find(
      (l) => l.box.left < left + width * 0.5 && l.box.top < top + height * 0.5 && !tableHeader(l)
    ) || null;
  if (codeLabel) {
    fields.codeRaw = valueOf(codeLabel, LABELS.code);
    fields.code = codeOf(fields.codeRaw);
  }

  const addressLabel = clientLabel(LABELS.address);
  const nameLabel = clientLabel(LABELS.name);
  fields.labels = { code: !!codeLabel, name: !!nameLabel, address: !!addressLabel };
  if (nameLabel) fields.name = valueOf(nameLabel, LABELS.name);
  if (!fields.name && codeLabel && !nameLabel) {
    // Sin la etiqueta NOMBRE: el renglón que está justo debajo del código (nunca la dirección).
    // Solo en la columna del recuadro del cliente: lo del otro lado de la hoja es la fecha.
    const next = below(lines, codeLabel, 2.5, codeLabel.box.left + width * 0.4).find(
      (l) => isValue(l) && (!addressLabel || l.box.top < addressLabel.box.top - h(addressLabel.box) * 0.5)
    );
    if (next) fields.name = cut(next.text);
  }

  if (addressLabel) {
    // La dirección suele ir en el renglón de abajo, no al lado de la etiqueta (a veces el OCR la
    // da en dos pedazos: se juntan).
    const row = rowsOf(below(lines, addressLabel, 2.5, addressLabel.box.left + width * 0.5)).find((r) =>
      isValue(r[0])
    );
    fields.address = afterLabel(addressLabel.text, LABELS.address) || (row ? cut(row.map((l) => l.text).join(" ")) : "");
  }

  const notesLabel = labelsOf(LABELS.notes).pop(); // el recuadro está abajo de la factura
  if (notesLabel) fields.notes = notesBelow(lines, notesLabel);
  return fields;
}

/**
 * Renglones agrupados por fila (los pedazos de una misma fila, de izquierda a derecha). Solo se
 * juntan pedazos que están uno al lado del otro y cerca: dos textos uno encima del otro son
 * filas distintas aunque sus cajas se encimen.
 */
function rowsOf(lines) {
  const rows = [];
  const beside = (a, b) =>
    Math.abs(midY(a.box) - midY(b.box)) < Math.min(h(a.box), h(b.box)) * 0.6 &&
    (b.box.left >= a.box.right ? b.box.left - a.box.right : a.box.left - b.box.right) >= -h(a.box) * 0.3 &&
    Math.max(b.box.left - a.box.right, a.box.left - b.box.right) < Math.max(h(a.box), h(b.box)) * 4;
  for (const l of [...lines].sort((a, b) => midY(a.box) - midY(b.box))) {
    const row = rows.find((r) => r.some((m) => beside(m, l)));
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
    (l) =>
      l !== label && l.box.left > lb.left + lh * 3 && TOTALS_LABEL.test(clean(l.text)) && l.box.top < lb.bottom + lh * 4
  );
  const maxRight = totals.length ? Math.min(...totals.map((l) => l.box.left)) : Infinity;
  const candidates = lines.filter(
    (l) => l !== label && l.box.top >= lb.bottom - lh * 0.5 && l.box.left < maxRight && l.box.right > lb.left - lh * 3
  );

  const taken = [];
  // Hubo marcas que no se entienden (un círculo de lapicero, un sello): si al final no aparece
  // texto, no se puede asegurar que no haya observaciones.
  const ownRaw = afterText(label.text, LABELS.notes);
  let marks = isMark(ownRaw);
  let prev = lb;
  for (const row of rowsOf(candidates)) {
    const first = row[0].box;
    // Primer renglón pegado a la etiqueta y empezando debajo de ella; el segundo, pegado al primero.
    const gap = first.top - prev.bottom;
    if (gap > (taken.length ? h(prev) * 0.8 : lh * 1.8)) break;
    if (first.left > lb.right + lh * 4) continue; // algo suelto a la derecha, no debajo de la etiqueta
    const raw = row.map((l) => l.text).join(" ");
    const text = notesText(raw);
    if (!text) {
      // Rayas del recuadro o trazos de lapicero: se saltan y se sigue buscando debajo.
      marks ||= isMark(raw);
      if (taken.length) break;
      continue;
    }
    taken.push(text);
    prev = row.reduce((b, l) => (l.box.bottom > b.bottom ? l.box : b), first);
    if (taken.length === 2) break;
  }

  // El texto en el mismo renglón de la etiqueta ("Observaciones: ENTREGAR EN PITAL") también vale.
  const notes = [notesText(ownRaw), ...taken].filter(Boolean).join(" ").replace(/[\s,;:\-–—]+$/u, "");
  if (!notes) return marks ? "" : NO_NOTES;
  return legible(notes) ? notes : "";
}

/** Algo escrito que no es texto (no cuentan las rayas del recuadro ni un punto suelto). */
const isMark = (raw) => raw.replace(/[\s\-_|—=]/g, "").length >= 3;

/** Texto después de la etiqueta, sin recortarlo (las observaciones son texto libre). */
function afterText(text, re) {
  const m = text.match(re);
  return m ? text.slice(m.index + m[0].length) : "";
}

// Una palabra de verdad: letras y números con la puntuación normal de una dirección o una orden.
const WORD = /^[\p{L}\p{N}][\p{L}\p{N}.,:;/#()-]*$/u;

/**
 * Texto de observaciones hasta donde empiezan los totales, sin la basura de las puntas
 * (rayas del recuadro, un círculo de lapicero alrededor: "Q.«“fQ. Cargado de …" → "Cargado de …").
 */
function notesText(value) {
  const text = clean(value);
  const m = text.match(TOTALS_INSIDE);
  const words = clean(m ? text.slice(0, m.index) : text).split(" ");
  while (words.length && !WORD.test(words[0])) words.shift();
  while (words.length && !/[\p{L}\p{N}]/u.test(words.at(-1))) words.pop();
  return words.join(" ");
}

/** true si el texto parece escrito de verdad y no basura del OCR (foto borrosa o cortada). */
function legible(text) {
  const chars = text.replace(/\s/g, "");
  const words = text.split(" ");
  const real = words.filter((w) => WORD.test(w) && /[\p{L}\p{N}]{2}/u.test(w));
  return (
    letters(text) >= 3 &&
    letters(text) + digits(text) >= chars.length * 0.75 &&
    real.length >= words.length * 0.7 &&
    words.some((w) => letters(w) >= 3)
  );
}

function fromText(text) {
  const fields = { labels: { code: false, name: false, address: false } };
  const rows = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  let codeRow = false;
  let notesRow = false; // de las observaciones para abajo ya no hay datos del cliente
  rows.forEach((row, i) => {
    if (LABELS.notes.test(row)) notesRow = true;
    if (notesRow && !LABELS.notes.test(row)) return;
    // Solo el primer CODIGO (el del cliente, arriba); los siguientes son de la tabla de productos.
    if (!codeRow && LABELS.code.test(row) && !TABLE_HEADER.test(row) && !TABLE_HEADER.test(rows[i + 1] || "")) {
      codeRow = true;
      fields.labels.code = true;
      // El renglón siguiente solo cuenta si parece un número (si no, es el nombre: el código falta).
      const below = /^[\dOoIlSB][\dOoIlSB .-]{3,}/.test(rows[i + 1] || "") ? rows[i + 1] : "";
      fields.codeRaw = afterLabel(row, LABELS.code) || below;
      fields.code = codeOf(fields.codeRaw);
    }
    const next = rows[i + 1] && !OTHER_LABEL.test(rows[i + 1]) ? cut(rows[i + 1]) : "";
    if (LABELS.name.test(row)) fields.labels.name = true;
    if (!fields.name && LABELS.name.test(row)) {
      fields.name = afterLabel(row, LABELS.name) || next;
    }
    if (!notesRow && LABELS.address.test(row)) fields.labels.address = true;
    if (!fields.address && !notesRow && LABELS.address.test(row)) {
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
 * Antes de usarlos, revisar invoiceMissing().
 */
export function parseInvoice({ text = "", lines = [] } = {}) {
  const usable = lines.filter((l) => l.box && clean(l.text));
  const layout = usable.length ? fromLayout(usable) : {};
  const plain = fromText(text);
  // Con posiciones manda el código de arriba a la izquierda; si el texto corrido da otro, no es
  // confiable y se descarta.
  const conflict = !!(usable.length && layout.code && plain.code && plain.code !== layout.code);
  const code = usable.length ? (layout.code && !conflict ? layout.code : "") : plain.code || "";
  const source = usable.length ? layout : plain;
  const fields = {
    code,
    // En la factura van siempre en mayúsculas: si el OCR lee alguna letra en minúscula, se corrige.
    name: (layout.name || plain.name || "").toLocaleUpperCase("es"),
    address: (layout.address || plain.address || "").toLocaleUpperCase("es"),
    // Con posiciones, las observaciones salen solo de lo que está debajo de la etiqueta: el texto
    // corrido podría dar cualquier renglón vecino.
    notes: (usable.length ? layout.notes : plain.notes) || "",
  };
  // "… ENTREGAR EN PITAL": el lugar de entrega, en las observaciones o en cualquier parte.
  const place = (fields.notes.match(PLACE) || String(text).match(PLACE) || [])[1];
  fields.place = cut(place);
  fields.text = text;
  // Para explicar qué salió mal (ver invoiceProblems): qué etiquetas del recuadro del cliente se
  // vieron, lo que había al lado de CODIGO y si las dos lecturas dieron códigos distintos.
  const seen = (k) => !!(layout.labels?.[k] || plain.labels?.[k]);
  fields.read = {
    text: !!clean(text) || usable.length > 0,
    labels: { code: seen("code"), name: seen("name"), address: seen("address") },
    codeRaw: clean(source.codeRaw ?? plain.codeRaw ?? ""),
    codeConflict: conflict,
  };
  return fields;
}

const letters = (s) => (String(s || "").match(/\p{L}/gu) || []).length;
const digits = (s) => (String(s || "").match(/\p{N}/gu) || []).length;

/** Por qué el valor de CODIGO no es un código: "format" (otra cantidad de números o letras) o "unreadable". */
function codeIssue(raw) {
  const [a = "", b = ""] = raw.split(" ");
  const number = (/^\d+$/.test(b) && numberOf(a + b)) || numberOf(a);
  if (number) return { reason: "format", digits: number.length };
  // "02021X215": casi todo números, con alguna letra que no es una confusión del OCR.
  const fixed = a.replace(/[oO]/g, "0").replace(/[lI|]/g, "1").replace(/[sS]/g, "5").replace(/B/g, "8");
  if (/^[\p{L}\d.-]+$/u.test(fixed) && digits(fixed) >= 5 && letters(fixed) >= 1 && letters(fixed) <= 2) {
    return { reason: "format", letters: true };
  }
  return { reason: "unreadable" };
}

/**
 * Qué salió mal al leer los datos obligatorios, en el orden de la factura. [] si está todo bien.
 * Cada problema es { field, reason, ... }:
 *   field "invoice"  reason "noText" (la foto no tiene texto) | "notInvoice" (no aparece el recuadro
 *                    del cliente: quedó fuera de la foto o no es una factura)
 *   field "code" | "name" | "address", reason:
 *     "notFound"    no aparece la etiqueta (CODIGO, NOMBRE, DIRECCION) en la foto
 *     "empty"       la etiqueta está pero no tiene nada al lado / debajo
 *     "format"      (código) tiene otra cantidad de números (`digits`) o letras (`letters`)
 *     "incomplete"  (dirección) se lee, pero no llega a dos palabras
 *     "unreadable"  hay algo escrito, pero no se entiende (foto borrosa, mal iluminada…)
 * Si hay alguno no se registra nada y se pide otra foto (ver problemMessage).
 */
export function invoiceProblems({ code, name = "", address = "", read } = {}) {
  // Sin `read` (factura armada a mano) se supone que se vieron todas las etiquetas.
  const labels = read?.labels || { code: true, name: true, address: true };
  if (read && !read.text) return [{ field: "invoice", reason: "noText" }];
  if (read && !labels.code && !labels.name && !labels.address && !code && !name && !address) {
    return [{ field: "invoice", reason: "notInvoice" }];
  }
  const problems = [];
  if (!code) {
    // 9 números (ver codeOf)
    const raw = read?.codeRaw || "";
    if (!labels.code) problems.push({ field: "code", reason: "notFound" });
    else if (read?.codeConflict) problems.push({ field: "code", reason: "unreadable" });
    else if (!raw) problems.push({ field: "code", reason: "empty" });
    else problems.push({ field: "code", raw, ...codeIssue(raw) });
  }
  // Un nombre de verdad tiene letras; basura del OCR suele ser casi todo símbolos.
  if (!(letters(name) >= 3 && letters(name) >= name.replace(/\s/g, "").length / 2)) {
    problems.push({ field: "name", reason: name.trim() ? "unreadable" : labels.name ? "empty" : "notFound" });
  }
  // Una dirección tiene al menos dos palabras de verdad ("ALAJUELA, SAN CARLOS, …").
  const chars = address.replace(/\s/g, "").length;
  const words = address.split(/[\s,.]+/).filter((w) => letters(w) >= 3);
  const clear = letters(address) + digits(address) >= chars * 0.7;
  if (!(words.length >= 2 && clear)) {
    const reason = !address.trim()
      ? labels.address ? "empty" : "notFound"
      : clear && words.length === 1 ? "incomplete" : "unreadable";
    problems.push({ field: "address", reason, ...(reason === "incomplete" ? { raw: clean(address) } : {}) });
  }
  return problems;
}

const FIELD_NAME = { code: "código", name: "nombre", address: "dirección" };
const FIELD_LABEL = { code: "CODIGO", name: "NOMBRE", address: "DIRECCION" };

/**
 * Mensaje para el transportista: { title, detail, paper }. `paper` es true cuando lo más probable
 * es que el problema esté en la factura misma (falta el dato o viene mal escrito) y no en la foto.
 */
export function problemMessage(p) {
  const label = FIELD_LABEL[p.field];
  const what = FIELD_NAME[p.field];
  switch (`${p.field}/${p.reason}`) {
    case "invoice/noText":
      return { title: "No se leyó texto en la foto", detail: "La foto salió sin texto legible: muy oscura, muy borrosa o sin la factura." };
    case "invoice/notInvoice":
      return {
        title: "No se encontró la factura en la foto",
        detail: "No aparece el recuadro del cliente (CODIGO, NOMBRE y DIRECCION). Puede que haya quedado fuera de la foto o que no sea una factura.",
      };
    case "code/format":
      return {
        title: "El formato del código está mal",
        detail: p.letters
          ? `El código tiene letras (se leyó “${p.raw}”). Tiene que ser de ${CODE_DIGITS} números.`
          : `El código tiene ${p.digits} números (se leyó “${p.raw}”) y tiene que tener ${CODE_DIGITS}.`,
        paper: true,
      };
    case "code/empty":
      return { title: "No hay código del cliente", detail: "Al lado de CODIGO no se leyó ningún número.", paper: true };
    case "name/empty":
      return { title: "No hay nombre del cliente", detail: "Al lado de NOMBRE no se leyó nada escrito.", paper: true };
    case "address/empty":
      return { title: "No hay dirección", detail: "Debajo de DIRECCION no se leyó nada escrito.", paper: true };
    case "address/incomplete":
      return {
        title: "La dirección está incompleta",
        detail: `Solo se leyó “${p.raw}”. La dirección tiene que traer al menos provincia y cantón.`,
        paper: true,
      };
    case "code/unreadable":
      return { title: "No se logró leer el código", detail: "Hay algo al lado de CODIGO, pero los números no se distinguen bien." };
    default:
      return p.reason === "notFound"
        ? { title: `No se encontró ${p.field === "address" ? "la" : "el"} ${what}`, detail: `No aparece ${label} en la foto: puede que haya quedado fuera.` }
        : { title: `No se logró leer ${p.field === "address" ? "la" : "el"} ${what}`, detail: `${p.field === "address" ? "La" : "El"} ${what} salió ilegible en la foto.` };
  }
}

/**
 * Campos obligatorios que no se pudieron leer bien, en el orden de la factura:
 * [] si está todo bien, o algunos de "código", "nombre", "dirección" (ver invoiceProblems).
 */
export function invoiceMissing(invoice) {
  const problems = invoiceProblems(invoice);
  return problems[0]?.field === "invoice" ? Object.values(FIELD_NAME) : problems.map((p) => FIELD_NAME[p.field]);
}

/** true si se leyeron bien el código, el nombre y la dirección (ver invoiceProblems). */
export const invoiceReadOk = (invoice) => invoiceProblems(invoice).length === 0;
