// Escanear una factura con la cámara y leer su texto (OCR).
// En Android usa Google ML Kit en el dispositivo (rápido y sin internet). En el navegador usa
// Tesseract.js, que se carga solo cuando hace falta (descarga el modelo de español la primera vez).
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { PhotoError, takePhoto, toDataUrl } from "./photo.js";

const native = Capacitor.isNativePlatform();

async function scanNative() {
  let photo;
  try {
    photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri, // ML Kit lee la imagen desde el archivo
      quality: 90,
      correctOrientation: true,
    });
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (/cancel/i.test(msg)) throw new PhotoError("CANCELLED", "");
    if (/denied|permission/i.test(msg)) {
      throw new PhotoError(
        "PERMISSION_DENIED",
        "No hay permiso de cámara. Activalo en Ajustes → Apps → OLOCATION → Permisos."
      );
    }
    throw new PhotoError("INVALID", "No se pudo obtener la foto.");
  }
  try {
    const { TextRecognition, Script } = await import("@capacitor-mlkit/text-recognition");
    const { text, blocks } = await TextRecognition.processImage({ path: photo.path, script: Script.Latin });
    const lines = (blocks || []).flatMap((b) =>
      (b.lines || []).map((l) => ({ text: l.text || "", box: l.boundingBox }))
    );
    return { text: text || "", lines };
  } catch {
    throw new PhotoError("INVALID", "No se pudo leer el texto de la factura.");
  } finally {
    // La foto solo sirve para leerla: no se deja guardada en el teléfono.
    Filesystem.deleteFile({ path: photo.path }).catch(() => {});
  }
}

async function scanWeb() {
  const { base64, mimeType } = await takePhoto("camera");
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("spa");
    try {
      const { data } = await worker.recognize(toDataUrl(base64, mimeType), {}, { text: true, blocks: true });
      const lines = (data.blocks || []).flatMap((b) =>
        (b.paragraphs || []).flatMap((p) =>
          (p.lines || []).map((l) => ({
            text: (l.text || "").trim(),
            box: { left: l.bbox.x0, top: l.bbox.y0, right: l.bbox.x1, bottom: l.bbox.y1 },
          }))
        )
      );
      return { text: data.text || "", lines };
    } finally {
      worker.terminate();
    }
  } catch {
    throw new PhotoError("INVALID", "No se pudo leer el texto de la factura.");
  }
}

/**
 * Abre la cámara, toma la foto de la factura y devuelve lo leído:
 * { text, lines: [{ text, box: { left, top, right, bottom } }] }  (posición de cada renglón en la foto).
 * Lanza PhotoError("CANCELLED") si el usuario cancela.
 */
export const scanInvoiceText = () => (native ? scanNative() : scanWeb());
