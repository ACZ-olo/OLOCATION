"use strict";

// La web se sirve desde el mismo backend, así que la base es relativa.
const API = "api/v1";
const SESSION_KEY = "olocation.session"; // { token, expiresAt, carrier }

const el = (id) => document.getElementById(id);

const state = {
  token: null, // Bearer token devuelto por el login
  carrier: null, // transportista { id, name, idNumber, plate, phone, createdAt }
  clients: null, // lista de clientes asignados (cacheada para Registros)
  records: [], // registros (ubicaciones) del transportista, más reciente primero
  client: null, // cliente seleccionado { id, code, name }
  picked: null, // { lat, lng } punto elegido, aún NO persistido
  marker: null, // marcador del punto elegido
};

// CONTRATO v1.2 (docs/API_CONTRACT.md) — autenticación cédula + PIN
// -----------------------------------------------------------------
//   login  → POST /auth/login { idNumber, pin, name?, plate?, phone? }
//            → { token, expiresAt, carrier }. Guardamos token + carrier (NO el PIN).
//   clients→ GET /carriers/{carrierId}/clients   (carrierId = carrier.id del token)
//   map    → el transportista marca un punto (mapa o GPS).
//   review → POST /clients/{clientId}/locations { latitude, longitude, label? }
//            El transportista sale del token: NO se envía carrierId. Un solo POST por punto.
//   Todas las rutas salvo login llevan Authorization: Bearer <token>.
//   401 UNAUTHORIZED en cualquier ruta → cerrar sesión y volver al login.
// NAVEGACIÓN: cada paso es una pantalla full-screen (una visible a la vez).

// --- Router de pantallas --------------------------------------------------
const SCREENS = ["screenRegister", "screenClients", "screenRecords", "screenMap", "screenReview"];

function showScreen(id) {
  for (const s of SCREENS) el(s).hidden = s !== id;
  if (id === "screenMap") {
    initMap();
    // El contenedor del mapa estuvo oculto; recalcular tamaño al mostrarse.
    setTimeout(() => map && map.invalidateSize(), 50);
  }
}

// --- Mapa -----------------------------------------------------------------
let map;
let tileLayer;
// Pin con los colores de OLO: gota verde con el cuadro del logo en el centro.
const PIN_ICON = L.divIcon({
  className: "olo-pin",
  html:
    '<svg width="36" height="46" viewBox="0 0 36 46" aria-hidden="true">' +
    '<path d="M18 45S2 28.5 2 17a16 16 0 0 1 32 0c0 11.5-16 28-16 28Z" fill="#00a785" stroke="#fff" stroke-width="3"/>' +
    '<rect x="11" y="10" width="14" height="14" rx="2" fill="#251e1f"/></svg>',
  iconSize: [36, 46],
  iconAnchor: [18, 45],
});

function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false }).setView([9.9325, -84.0796], 8);
  tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on("click", (e) => setPickedPoint(e.latlng.lat, e.latlng.lng));
}

// --- Utilidades -----------------------------------------------------------
// Hace una petición. Si `auth` es true agrega el header Authorization con el token.
async function request(path, options = {}, auth = true) {
  const headers = { ...(options.headers || {}) };
  if (auth && state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data && data.error ? data.error : {};
    const detail = (err.details || []).map((d) => `${d.field}: ${d.message}`).join(" · ");
    const e = new Error(detail || err.message || `HTTP ${res.status}`);
    e.code = err.code || "HTTP_" + res.status;
    e.status = res.status;
    throw e;
  }
  return data;
}

// Token inválido/vencido: limpiar sesión y volver al login.
function handleUnauthorized(msg) {
  localStorage.removeItem(SESSION_KEY);
  state.token = null;
  state.carrier = null;
  state.clients = null;
  state.records = [];
  state.client = null;
  setMsg("onboardMsg", msg || "Tu sesión expiró. Iniciá sesión de nuevo.", "error");
  showScreen("screenRegister");
}

function setMsg(id, msg, kind = "") {
  const node = el(id);
  node.textContent = msg;
  node.className = "form-msg" + (kind ? " " + kind : "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ======================= Pantalla 1: Login (cédula + PIN) =======================
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Mostrar/ocultar los campos opcionales para actualizar datos.
el("toggleDatos").addEventListener("click", () => {
  const box = el("datosExtra");
  box.hidden = !box.hidden;
  el("toggleDatos").setAttribute("aria-expanded", String(!box.hidden));
  el("toggleDatos").textContent = box.hidden
    ? "Actualizar mis datos (opcional)"
    : "Ocultar datos";
});

el("carrierForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const idNumber = el("carrierId").value.trim();
  const pin = el("carrierPin").value.trim();
  if (!idNumber || !pin) {
    setMsg("onboardMsg", "Cédula y PIN son obligatorios.", "error");
    return;
  }
  const body = { idNumber, pin };
  // Campos opcionales: solo se envían si el usuario los completó (actualizan sus datos).
  const name = el("carrierName").value.trim();
  const plate = el("carrierPlate").value.trim();
  const phone = el("carrierPhone").value.trim();
  if (name) body.name = name;
  if (plate) body.plate = plate;
  if (phone) body.phone = phone;

  const btn = el("carrierSubmit");
  btn.disabled = true;
  setMsg("onboardMsg", "Ingresando…");
  try {
    // El login NO lleva token (auth = false).
    const session = await request(
      `${API}/auth/login`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      false
    );
    state.token = session.token;
    state.carrier = session.carrier;
    // Guardamos token + carrier, nunca el PIN.
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    el("carrierPin").value = "";
    setMsg("onboardMsg", "");
    goToClients();
  } catch (e) {
    if (e.code === "INVALID_CREDENTIALS") {
      setMsg("onboardMsg", "Cédula o PIN incorrectos.", "error");
    } else if (e.code === "TOO_MANY_ATTEMPTS") {
      setMsg("onboardMsg", e.message, "error"); // incluye los minutos de bloqueo
    } else {
      setMsg("onboardMsg", `No se pudo ingresar (${e.code}): ${e.message}`, "error");
    }
  } finally {
    btn.disabled = false;
  }
});

el("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  state.token = null;
  state.carrier = null;
  state.clients = null;
  state.records = []; // no mezclar registros entre transportistas
  state.client = null;
  el("carrierPin").value = "";
  setMsg("onboardMsg", "");
  showScreen("screenRegister");
});

// ======================= Pantalla 2: Clientes =======================
function goToClients() {
  const c = state.carrier;
  el("carrierNameLabel").textContent = c ? c.name : "";
  el("carrierPlateLabel").textContent = c ? c.plate : "";
  el("carrierAvatar").textContent = c ? initials(c.name) : "";
  el("clientSearch").value = "";
  showScreen("screenClients");
  loadClients();
}

async function loadClients() {
  if (!state.carrier || !state.token) { handleUnauthorized(); return; }
  setMsg("clientsMsg", "Cargando clientes…");
  try {
    const { items } = await request(`${API}/carriers/${state.carrier.id}/clients`);
    state.clients = items; // lo reusa la pantalla de Registros
    renderClients(items);
    setMsg(
      "clientsMsg",
      items.length ? "" : "No tenés clientes asignados. Contactá a tu supervisor."
    );
  } catch (e) {
    if (e.code === "UNAUTHORIZED") {
      handleUnauthorized();
      return;
    }
    setMsg("clientsMsg", `No se pudo cargar: ${e.message}`, "error");
  }
}

// Iniciales del nombre para el avatar ("Carlos Jiménez Rojas" → "CJ").
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

// Ícono del sprite de index.html (<symbol id="i-...">).
const icon = (id, cls = "ic") => `<svg class="${cls}"><use href="#${id}"/></svg>`;

function renderClients(items) {
  const query = el("clientSearch").value.trim().toLowerCase();
  const shown = query
    ? items.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(query))
    : items;
  el("clientsCount").textContent = items.length
    ? query
      ? `${shown.length} de ${items.length} clientes`
      : `${items.length} cliente(s) asignado(s)`
    : "";
  const ul = el("clients");
  ul.innerHTML = "";
  for (const c of shown) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="lead">${icon("i-store")}</span>` +
      `<span class="txt"><span class="name">${escapeHtml(c.name)}</span>` +
      `<span class="code">${escapeHtml(c.code)}</span></span>` +
      `<span class="chev">${icon("i-chev")}</span>`;
    li.addEventListener("click", () => goToMap(c));
    ul.appendChild(li);
  }
  if (query && !shown.length) {
    ul.innerHTML = `<li class="empty" aria-disabled="true">Ningún cliente coincide con “${escapeHtml(query)}”.</li>`;
  }
}

el("clientSearch").addEventListener("input", () => {
  if (state.clients) renderClients(state.clients);
});

// ======================= Pantalla: Registros =======================
el("recordsBtn").addEventListener("click", () => goToRecords());
el("recordsBack").addEventListener("click", () => goToClients());

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function goToRecords() {
  showScreen("screenRecords");
  // Mostramos lo que ya tenemos (incluye lo recién guardado) y refrescamos desde el server.
  renderRecords(state.records);
  if (state.records.length) setMsg("recordsMsg", "");
  loadRecords();
}

// Agrega un registro recién guardado al principio de la lista, sin recargar. `loc` es la
// ubicación devuelta por el POST (trae id, createdAt, carrierId); `client` es el cliente actual.
function addRecord(loc, client) {
  const record = { ...loc, clientName: client.name, clientCode: client.code };
  state.records = [record, ...state.records.filter((r) => r.id !== loc.id)];
  state.records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Si la pantalla de Registros está abierta, reflejarlo en el acto.
  if (!el("screenRecords").hidden) renderRecords(state.records);
}

// Carga el historial de registros del transportista con una sola llamada (v1.3).
// El endpoint ya trae clientName/clientCode e incluye registros de clientes desasignados.
async function loadRecords() {
  if (!state.carrier || !state.token) { handleUnauthorized(); return; }
  if (!state.records.length) setMsg("recordsMsg", "Cargando registros…");
  try {
    const { items } = await request(`${API}/carriers/${state.carrier.id}/locations`);
    state.records = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    renderRecords(state.records);
    setMsg("recordsMsg", state.records.length ? "" : "Todavía no guardaste ninguna ubicación.");
  } catch (e) {
    if (e.code === "UNAUTHORIZED") { handleUnauthorized(); return; }
    // Si ya mostramos registros locales, no pisamos la vista con el error.
    if (!state.records.length) setMsg("recordsMsg", `No se pudo cargar: ${e.message}`, "error");
  }
}

// Agrupa por "mes de año" preservando el orden (los registros ya vienen de más reciente a más viejo).
function groupByMonth(records) {
  const groups = [];
  const index = new Map();
  for (const r of records) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!index.has(key)) {
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const group = { key, label, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(r);
  }
  return groups;
}

function renderRecords(records) {
  const container = el("records");
  container.innerHTML = "";
  for (const group of groupByMonth(records)) {
    const section = document.createElement("div");
    section.className = "month-group";
    section.innerHTML =
      `<h2 class="month-header">${escapeHtml(group.label)}` +
      `<span class="count">${group.items.length} registro(s)</span></h2>`;
    for (const r of group.items) {
      const d = new Date(r.createdAt);
      const fecha = d.toLocaleDateString("es-CR", { day: "2-digit", month: "short" }) +
        " · " + d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
      const card = document.createElement("div");
      card.className = "record";
      card.innerHTML =
        `<span class="lead">${icon("i-pin")}</span><div class="body">` +
        `<div class="record-top">` +
        `<span class="record-label${r.label ? "" : " none"}">${escapeHtml(r.label || "Sin etiqueta")}</span>` +
        `<span class="record-date">${escapeHtml(fecha)}</span></div>` +
        `<div class="record-sub">${escapeHtml(r.clientName)} · ${escapeHtml(r.clientCode)}</div>` +
        `<div class="record-coords">${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</div></div>`;
      section.appendChild(card);
    }
    container.appendChild(section);
  }
}

// ======================= Pantalla 3: Mapa =======================
function goToMap(client) {
  state.client = client;
  state.picked = null;
  el("mapTitle").textContent = client.name;
  setHint("Tocá el mapa o usá el GPS para marcar el punto");
  el("toReviewBtn").disabled = true;
  showScreen("screenMap");
  if (state.marker) { map.removeLayer(state.marker); state.marker = null; }
}

el("mapBack").addEventListener("click", () => goToClients());

// Texto de la hoja inferior del mapa. kind: "" (ayuda), "set" (punto marcado) o "error".
function setHint(text, kind = "") {
  el("mapHint").textContent = text;
  el("mapHint").className = "sheet-text" + (kind ? " " + kind : "");
}

function showPickedHint(lat, lng) {
  setHint(`${lat.toFixed(6)}, ${lng.toFixed(6)} · podés arrastrar el pin`, "set");
}

function setPickedPoint(lat, lng) {
  state.picked = { lat, lng };
  const latLng = [lat, lng];
  if (state.marker) {
    state.marker.setLatLng(latLng);
  } else {
    state.marker = L.marker(latLng, { draggable: true, icon: PIN_ICON }).addTo(map);
    state.marker.on("dragend", () => {
      const p = state.marker.getLatLng();
      state.picked = { lat: p.lat, lng: p.lng };
      showPickedHint(p.lat, p.lng);
    });
  }
  showPickedHint(lat, lng);
  el("toReviewBtn").disabled = false;
}

el("gpsBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setHint("Este navegador no soporta geolocalización.", "error");
    return;
  }
  const btn = el("gpsBtn");
  btn.classList.add("busy");
  btn.disabled = true;
  setHint("Obteniendo tu ubicación…");
  const done = () => { btn.classList.remove("busy"); btn.disabled = false; };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      done();
      const { latitude, longitude } = pos.coords;
      setPickedPoint(latitude, longitude);
      map.setView([latitude, longitude], 17);
    },
    (err) => { done(); setHint(`No se pudo obtener el GPS: ${err.message}`, "error"); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

el("toReviewBtn").addEventListener("click", () => {
  if (!state.picked) return;
  goToReview();
});

// ======================= Pantalla 4: Revisar y guardar =======================
function goToReview() {
  el("reviewClient").textContent = state.client.name;
  el("reviewLat").textContent = state.picked.lat.toFixed(6);
  el("reviewLng").textContent = state.picked.lng.toFixed(6);
  el("labelInput").value = "";
  syncChips();
  setMsg("labelMsg", "");
  el("reviewSave").disabled = false;
  showScreen("screenReview");
}

el("reviewBack").addEventListener("click", () => showScreen("screenMap"));

// Chips de etiqueta sugerida: tocar uno lo escribe en el campo (tocarlo de nuevo lo borra).
function syncChips() {
  const value = el("labelInput").value.trim();
  for (const chip of el("labelChips").querySelectorAll(".chip")) {
    chip.classList.toggle("on", chip.textContent === value);
  }
}

el("labelChips").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  const input = el("labelInput");
  input.value = input.value.trim() === chip.textContent ? "" : chip.textContent;
  syncChips();
});
el("labelInput").addEventListener("input", syncChips);

// Descartar: tira la selección y vuelve a la lista de clientes. No envía nada.
el("reviewDiscard").addEventListener("click", () => {
  state.picked = null;
  if (state.marker) { map.removeLayer(state.marker); state.marker = null; }
  goToClients();
});

// Guardar: ÚNICO POST (coordenada + etiqueta opcional).
el("reviewSave").addEventListener("click", async () => {
  if (!state.picked || !state.client) return;
  const btn = el("reviewSave");
  btn.disabled = true; // evita doble POST: cada POST crea un registro nuevo
  setMsg("labelMsg", "Guardando…");
  const label = el("labelInput").value.trim();
  try {
    // v1.2: NO se envía carrierId; el transportista sale del token.
    const body = { latitude: state.picked.lat, longitude: state.picked.lng };
    if (label) body.label = label;
    const saved = await request(`${API}/clients/${state.client.id}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // El registro recién guardado se agrega de una a la lista de Registros (sin recargar).
    addRecord(saved, state.client);
    setMsg("labelMsg", "Ubicación guardada.", "ok");
    state.picked = null;
    if (state.marker) { map.removeLayer(state.marker); state.marker = null; }
    setTimeout(() => goToClients(), 800);
  } catch (e) {
    // No reintentamos solos: si el POST llegó a responder, reintentar duplicaría.
    if (e.code === "UNAUTHORIZED") {
      handleUnauthorized();
    } else if (e.code === "CLIENT_NOT_ASSIGNED") {
      setMsg("labelMsg", "Este cliente no está asignado a tu usuario.", "error");
    } else {
      setMsg("labelMsg", `No se pudo guardar (${e.code}): ${e.message}`, "error");
      btn.disabled = false;
    }
  }
});

// --- Arranque -------------------------------------------------------------
function boot() {
  const session = loadSession();
  if (session && session.token && session.carrier) {
    const vencido = session.expiresAt && new Date(session.expiresAt) <= new Date();
    if (!vencido) {
      state.token = session.token;
      state.carrier = session.carrier;
      // Precargamos la cédula por comodidad si la sesión resulta inválida en el server.
      el("carrierId").value = session.carrier.idNumber || "";
      goToClients(); // si el token ya no sirve, loadClients() hará handleUnauthorized()
      return;
    }
  }
  showScreen("screenRegister");
}

boot();
