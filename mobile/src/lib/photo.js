// Tomar una foto de factura con la cámara o elegirla de la galería.
// En Android usa el plugin nativo de Capacitor (pide el permiso correspondiente); en el
// navegador usa un <input type="file"> (con capture="environment" para abrir la cámara trasera).
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";

export class PhotoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // CANCELLED | PERMISSION_DENIED | UNSUPPORTED | TOO_LARGE | INVALID
  }
}

const native = Capacitor.isNativePlatform();

/** Tipos aceptados (coinciden con el backend y Supabase). */
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB, igual que el servidor

const EXT_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** base64 (sin prefijo data:) → cantidad de bytes que ocupa. */
function base64Bytes(b64) {
  const len = b64.length;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

function normalizeMime(mime) {
  const m = String(mime || "").split(";")[0].trim().toLowerCase();
  return m === "image/jpg" ? "image/jpeg" : m;
}

function check(base64, mimeType) {
  const mime = normalizeMime(mimeType);
  if (!ALLOWED.includes(mime)) {
    throw new PhotoError("INVALID", "La factura debe ser una foto JPEG, PNG o WEBP.");
  }
  if (!base64) throw new PhotoError("INVALID", "No se pudo leer la imagen.");
  if (base64Bytes(base64) > MAX_BYTES) {
    throw new PhotoError("TOO_LARGE", "La imagen es muy grande (máximo 12 MB). Probá con menos calidad.");
  }
  return { base64, mimeType: mime };
}

// --- Android (Capacitor) -------------------------------------------------------

async function takeNative(source) {
  let photo;
  try {
    photo = await Camera.getPhoto({
      source,
      resultType: CameraResultType.Base64,
      quality: 80,
      correctOrientation: true,
      // La cámara de Capacitor entrega JPEG por defecto.
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
  const mime = EXT_MIME[String(photo.format || "jpeg").toLowerCase()] || "image/jpeg";
  return check(photo.base64String, mime);
}

// --- Navegador -----------------------------------------------------------------

function pickWeb(useCamera) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: ALLOWED.join(","),
    });
    if (useCamera) input.capture = "environment";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return reject(new PhotoError("CANCELLED", ""));
      const reader = new FileReader();
      reader.onerror = () => reject(new PhotoError("INVALID", "No se pudo leer la imagen."));
      reader.onload = () => {
        try {
          const dataUrl = String(reader.result || "");
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          resolve(check(base64, file.type));
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsDataURL(file);
    });
    input.addEventListener("cancel", () => reject(new PhotoError("CANCELLED", "")));
    input.click();
  });
}

/**
 * Pide una foto. `source` es "camera" o "gallery".
 * Devuelve { base64, mimeType }  (base64 sin el prefijo "data:").
 * Lanza PhotoError("CANCELLED") si el usuario cancela.
 */
export function takePhoto(source = "camera") {
  if (native) {
    return takeNative(source === "gallery" ? CameraSource.Photos : CameraSource.Camera);
  }
  return pickWeb(source === "camera");
}

/** data URL lista para usar en <img src>. */
export const toDataUrl = (base64, mimeType) => `data:${mimeType};base64,${base64}`;
