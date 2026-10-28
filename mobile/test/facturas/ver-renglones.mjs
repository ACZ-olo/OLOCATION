// Muestra los renglones que leyó Tesseract en una factura de prueba, con su posición (para
// entender por qué un caso falla). Uso (desde mobile/):  node test/facturas/ver-renglones.mjs 04_sin
import { readdirSync } from "node:fs";
import { createWorker } from "tesseract.js";
import { tesseractLines } from "../../src/lib/ocr-lines.js";

const dir = new URL("./img/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.includes(process.argv[2] || ".jpg"));
const worker = await createWorker("spa");
for (const file of files) {
  const { data } = await worker.recognize(new URL(file, dir).pathname.slice(1), {}, { blocks: true });
  console.log(`\n== ${file}`);
  for (const { text, box } of tesseractLines(data)) {
    console.log(`  [${box.left},${box.top} → ${box.right},${box.bottom}] ${text}`);
  }
}
await worker.terminate();
