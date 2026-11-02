// Edge Function "analyze-invoice": analiza con OpenAI las OBSERVACIONES de una factura escaneada.
//
// Decide si las observaciones indican una dirección de entrega (nunca viene rotulada como
// "DIRECCION:": va mezclada con el resto del texto, p. ej. "Cargado de FR - OC 60877 ENTREGAR EN
// GUAPILES, FRENTE A LA ESCUELA LIDER") y, si la indican, la normaliza con el mismo formato que la
// dirección de arriba de la factura ("PROVINCIA, CANTON, DISTRITO SEÑAS"). La app guarda el
// resultado en "Ubicación - Observaciones".
//
// Solo recibe las observaciones y la dirección de arriba (de ahí salen provincia y cantón). No
// lee ni corrige el código, el nombre ni la dirección del cliente: eso lo hace el lector de la app.
// La app valida la respuesta antes de guardarla (mobile/src/lib/invoice-ai.js).
//
// Seguridad: la API key de OpenAI vive SOLO aquí, como secreto de Supabase (nunca en la app).
// Solo atiende a quien tenga un token vigente de la app (RPC check_session).
//
// Secretos (supabase secrets set …):
//   OPENAI_API_KEY   obligatorio
//   OPENAI_MODEL     obligatorio: el ID de un modelo económico de tu cuenta de OpenAI
// SUPABASE_URL y SUPABASE_ANON_KEY los pone Supabase automáticamente.
//
// Pedido:    POST { token, notes, address }
// Respuesta: 200 { ok: true, result: { notesIsAddress, notesLocation } }
//            4xx/5xx { ok: false, error: { code, message } }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_TIMEOUT_MS = 20_000;
const MAX_FIELD = 2000; // acota el costo de cada llamada

const SYSTEM = `Analizás las OBSERVACIONES de facturas de Costa Rica leídas por OCR (puede haber errores de lectura).
Respondé SOLO con el JSON del esquema. Nunca inventes datos: todo tiene que salir del texto recibido.

Recibís:
- notes: el texto de las observaciones.
- address: la dirección del cliente que figura arriba en la factura, con formato "PROVINCIA, CANTON, DISTRITO SEÑAS".

Tarea 1: decidir si notes indica DÓNDE entregar.
- La dirección NUNCA viene rotulada ("DIRECCION:"): va mezclada con otras cosas. Hay que reconocerla por su contenido.
- SÍ indican dónde entregar: un lugar (distrito, pueblo, barrio, caserío, finca, bodega, plantel, local) y/o señas para llegar
  ("200 M NORTE DE LA IGLESIA", "FRENTE A LA ESCUELA", "CONTIGUO A LA PLAZA", "COSTADO SUR DEL PARQUE", "CARRETERA A …", "KM 5", "PORTON VERDE").
  Suelen venir después de "ENTREGAR EN", "ENVIAR A", "DESCARGAR EN", "LLEVAR A", pero también pueden venir solas.
- NO indican dónde entregar: órdenes de compra ("OC 61204"), "Cargado de FR", nombres de personas ("RECIBE DON CARLOS"),
  horarios ("ANTES DE LA HORA DE ALMUERZO"), teléfonos, montos, formas de pago u otras instrucciones sin un lugar.
- Si notes mezcla las dos cosas, la parte de lugar alcanza para que notesIsAddress sea true.

Tarea 2: si indica dónde entregar, notesIsAddress = true y notesLocation = esa dirección normalizada:
- Formato de address: "PROVINCIA, CANTON, DISTRITO SEÑAS", en MAYÚSCULAS y SIN tildes.
- Provincia y cantón: tomalos de address, salvo que notes nombre otra provincia o cantón (entonces usá esos).
  Nunca agregues provincias, cantones, distritos ni lugares que no estén en notes o en address.
- Dejá solo el lugar y las señas: quitá "ENTREGAR EN" y similares, órdenes de compra, "Cargado de FR", personas, horarios y teléfonos.
- Corregí errores evidentes del OCR en las palabras sin cambiar su significado. No agregues "ND".
Si no indica dónde entregar (o notes está vacío): notesIsAddress = false y notesLocation = null.

Ejemplos con address "ALAJUELA, SAN CARLOS, PITAL CONTIGUO A LA PLAZA DE DEPORTES, ND":
  "ENTREGAR EN PITAL 200 M NORTE DE LA IGLESIA CATOLICA" → true, "ALAJUELA, SAN CARLOS, PITAL 200 M NORTE DE LA IGLESIA CATOLICA"
  "Cargado de FR - OC 60516ENTREGAR EN PITAL" → true, "ALAJUELA, SAN CARLOS, PITAL"
  "ENTREGAR EN BODEGA CENTRAL RUTA 32, RECIBE DON CARLOS ANTES DE LA HORA DE ALMUERZO" → true, "ALAJUELA, SAN CARLOS, BODEGA CENTRAL RUTA 32"
  "Cargado de FR - OC 60516" → false, null
  "RECIBE DON CARLOS, LLAMAR ANTES" → false, null
Con address "LIMON, POCOCI, GUAPILES 300 M ESTE DEL HOSPITAL, ND":
  "Cargado de FR - OC 60877 ENTREGAR EN GUAPILES, FRENTE A LA ESCUELA LIDER, PORTON VERDE" → true, "LIMON, POCOCI, GUAPILES FRENTE A LA ESCUELA LIDER, PORTON VERDE"`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notesIsAddress", "notesLocation"],
  properties: {
    notesIsAddress: { type: "boolean", description: "true si las observaciones indican dónde entregar" },
    notesLocation: { type: ["string", "null"], description: "Dirección de las observaciones normalizada, o null" },
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const fail = (status: number, code: string, message: string) => json(status, { ok: false, error: { code, message } });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** true si el token de la app está vigente (RPC check_session). */
async function validToken(token: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon || !token) return false;
  const res = await fetch(`${url}/rest/v1/rpc/check_session`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return false;
  const role = await res.json().catch(() => null);
  return role === "admin" || role === "empleado";
}

/** Texto JSON de la respuesta de la Responses API (o null si el modelo se negó). */
function outputText(data: any): string | null {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  for (const item of data?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return null;
}

async function askOpenAI(input: { notes: string; address: string }) {
  const key = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL");
  if (!key || !model) throw new Error("NOT_CONFIGURED");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: SYSTEM,
        input: JSON.stringify(input),
        store: false, // que OpenAI no guarde el contenido de la factura
        text: { format: { type: "json_schema", name: "notes_location", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok) {
      // No se devuelve el cuerpo de OpenAI a la app (puede traer detalles de la cuenta).
      console.error("OpenAI", res.status, (await res.text()).slice(0, 500));
      throw new Error("AI_ERROR");
    }
    const text = outputText(await res.json());
    if (!text) throw new Error("AI_ERROR");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Usá POST.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "El cuerpo no es un JSON válido.");
  }

  const token = str(body?.token, 200);
  if (!(await validToken(token))) {
    return fail(401, "UNAUTHORIZED", "El acceso venció o la contraseña cambió. Ingresala de nuevo.");
  }

  const notes = str(body?.notes, MAX_FIELD);
  if (!notes.trim()) return fail(400, "VALIDATION_ERROR", "notes: faltan las observaciones.");

  try {
    const result = await askOpenAI({ notes, address: str(body?.address, MAX_FIELD) });
    return json(200, { ok: true, result });
  } catch (e) {
    return (e as Error)?.message === "NOT_CONFIGURED"
      ? fail(503, "NOT_CONFIGURED", "Falta configurar OPENAI_API_KEY u OPENAI_MODEL en Supabase.")
      : fail(502, "AI_ERROR", "No se pudo analizar la factura con IA.");
  }
});
