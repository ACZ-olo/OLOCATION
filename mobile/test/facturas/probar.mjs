// Prueba el escaneo con las facturas de prueba (generadas con generar.py): cada imagen pasa por
// Tesseract (el mismo OCR que usa la app en el navegador, ver src/lib/ocr.js) y por parseInvoice,
// y se compara con lo esperado en casos.json.
// Uso (desde mobile/):  node test/facturas/probar.mjs [filtro]
import { readFileSync } from "node:fs";
import { createWorker } from "tesseract.js";
import { invoiceReadOk, parseInvoice } from "../../src/lib/invoice.js";
import { tesseractLines } from "../../src/lib/ocr-lines.js";

const dir = new URL("./", import.meta.url);
const filter = process.argv[2] || "";
const cases = JSON.parse(readFileSync(new URL("casos.json", dir), "utf8")).filter((c) => c.file.includes(filter));

/**
 * El código, "ok", "Sin observaciones" y el vacío tienen que ser exactos. En el resto se toleran
 * errores sueltos de letras del OCR ("S.A" → "SA"), pero no texto de más ni cortado.
 */
function same(field, got, want) {
  if (field === "code" || field === "ok" || !want || want === "Sin observaciones" || !got) return got === want;
  return similarity(got, want) >= (field === "notes" ? 0.9 : 0.85);
}

function similarity(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const worker = await createWorker("spa");
let failed = 0;
let warned = 0;
for (const { file, expect } of cases) {
  const { data } = await worker.recognize(new URL(`img/${file}`, dir).pathname.slice(1), {}, { text: true, blocks: true });
  const got = parseInvoice({ text: data.text || "", lines: tesseractLines(data) }); // igual que scanWeb()
  got.ok = invoiceReadOk(got);

  const problems = [];
  for (const field of ["code", "name", "address", "notes", "ok"]) {
    const want = expect[field];
    if (want === null || want === undefined) continue; // no se exige nada (foto mala)
    const accepted = Array.isArray(want) ? want : [want];
    if (!accepted.some((a) => same(field, got[field], a))) {
      // No leer un dato (queda vacío y se pide otra foto) es seguro; leer uno equivocado no.
      const unread = field === "ok" ? got.ok === false : got[field] === "";
      problems.push({
        unread,
        text: `${field}: se leyó ${JSON.stringify(got[field])}, se esperaba ${accepted.map((a) => JSON.stringify(a)).join(" o ")}`,
      });
    }
  }
  // Lo más importante: si la factura se da por bien leída, el código tiene que ser el correcto.
  const realCode = [expect.code].flat().find(Boolean);
  if (got.ok && realCode && got.code !== realCode) {
    problems.push({ unread: false, text: `se dio por buena con un código equivocado (${got.code})` });
  }
  const status = !problems.length ? "ok   " : problems.every((p) => p.unread) ? "AVISO" : "FALLA";
  if (status === "FALLA") failed++;
  if (status === "AVISO") warned++;
  console.log(`${status}  ${file}`);
  console.log(`       código ${JSON.stringify(got.code)} · cliente ${JSON.stringify(got.name)}`);
  console.log(`       observaciones ${JSON.stringify(got.notes)}`);
  for (const p of problems) console.log(`       ${p.unread ? "·" : "✗"} ${p.text}`);
}
await worker.terminate();
console.log(
  `\n${cases.length - failed - warned}/${cases.length} bien · ${warned} sin leer (se pide otra foto) · ${failed} con datos equivocados`
);
process.exitCode = failed ? 1 : 0;
