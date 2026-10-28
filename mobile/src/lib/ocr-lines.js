// Renglones con posición a partir del resultado del OCR (ML Kit en el teléfono, Tesseract en el
// navegador y en las pruebas), para lib/invoice.js.
//
// La foto casi nunca está derecha: con la hoja inclinada, la caja recta de un renglón largo queda
// mucho más alta que la letra y se encima con los renglones de arriba y de abajo. Por eso se
// calcula la inclinación de la hoja y las posiciones se dan como si la foto estuviera derecha.
//
// Además, Tesseract junta en un renglón todo lo que está a la misma altura de lado a lado de la
// hoja ("Observaciones … SUBTOTAL ₡ 79 642.44"): se parte donde hay un espacio grande entre
// palabras, como hace ML Kit.

const GAP = 1.8; // espacio entre palabras (en alturas de letra) a partir del cual se parte

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Gira un punto `-angle` (endereza la hoja). */
const straight = (x, y, angle) => ({
  x: x * Math.cos(angle) + y * Math.sin(angle),
  y: -x * Math.sin(angle) + y * Math.cos(angle),
});

function boxOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Inclinación de la hoja: la mediana de la de los renglones largos (en radianes). */
function pageAngle(angles) {
  const a = median(angles.filter((x) => Number.isFinite(x) && Math.abs(x) < 0.35));
  return Math.abs(a) < 0.002 ? 0 : a;
}

// --- ML Kit ---------------------------------------------------------------------------------

/** [{ text, box }] a partir de los `blocks` de TextRecognition.processImage(). */
export function mlkitLines(blocks) {
  const lines = (blocks || []).flatMap((b) => b.lines || []).filter((l) => (l.text || "").trim());
  const corners = (l) => (l.cornerPoints?.length === 4 ? l.cornerPoints : null);
  const angle = pageAngle(
    lines
      .map(corners)
      .filter((c) => c && Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) > 100)
      .map((c) => Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x))
  );
  return lines.map((l) => {
    const c = corners(l);
    return {
      text: l.text,
      box: c ? boxOf(c.map((p) => straight(p.x, p.y, angle))) : l.boundingBox,
    };
  });
}

// --- Tesseract ------------------------------------------------------------------------------

/** [{ text, box }] a partir de `data` de worker.recognize(…, { blocks: true }). */
export function tesseractLines(data) {
  const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
  const angle = pageAngle(lines.map(lineAngle));
  return lines.flatMap((l) => splitLine(l, angle));
}

const center = (w) => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 });

/** Inclinación de un renglón según el centro de sus palabras (recta de mínimos cuadrados). */
function lineAngle(l) {
  const ws = (l.words || []).filter((w) => w.text.trim());
  if (ws.length < 3 || l.bbox.x1 - l.bbox.x0 < 200) return NaN;
  const pts = ws.map(center);
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return sxx ? Math.atan(sxy / sxx) : NaN;
}

function splitLine(l, angle) {
  const words = (l.words || []).filter((w) => w.text.trim());
  if (!words.length) {
    const text = (l.text || "").trim();
    const { x0, y0, x1, y1 } = l.bbox;
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => straight(x, y, angle));
    return text ? [{ text, box: boxOf(pts) }] : [];
  }
  const parts = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1].bbox;
    const b = words[i].bbox;
    const height = Math.max(a.y1 - a.y0, b.y1 - b.y0, 1);
    if (b.x0 - a.x1 > height * GAP) parts.push([]);
    parts.at(-1).push(words[i]);
  }
  const sin = Math.abs(Math.sin(angle));
  return parts.map((ws) => ({
    text: ws.map((w) => w.text.trim()).join(" "),
    // Cada palabra enderezada: la caja recta de una palabra inclinada es más alta que la letra.
    box: boxOf(
      ws.flatMap((w) => {
        const c = center(w);
        const p = straight(c.x, c.y, angle);
        const halfW = (w.bbox.x1 - w.bbox.x0) / 2;
        const halfH = Math.max(2, (w.bbox.y1 - w.bbox.y0 - (w.bbox.x1 - w.bbox.x0) * sin) / 2);
        return [{ x: p.x - halfW, y: p.y - halfH }, { x: p.x + halfW, y: p.y + halfH }];
      })
    ),
  }));
}
