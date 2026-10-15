// Listado de todas las tiendas con buscador general y filtros.
import { escapeHtml, formatRelative, normalize } from "../lib/format.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { loadStores, state } from "../state.js";
import { handleDataError, lockApp } from "./common.js";

const MAX_RENDERED = 150; // con miles de tiendas, se muestran las primeras y se pide afinar
const FILTERS = {
  all: () => true,
  pending: (s) => s.changeCount === 0,
  done: (s) => s.changeCount > 0,
};

let filter = "all";
let renderedKey = "";
// Texto de búsqueda precalculado por tienda (sin tildes, en minúsculas).
const searchIndex = new WeakMap();

const haystack = (s) => {
  let text = searchIndex.get(s);
  if (text === undefined) {
    text = normalize(`${s.name} ${s.code} ${s.address || ""}`);
    searchIndex.set(s, text);
  }
  return text;
};

function filtered() {
  const terms = normalize($("storeSearch").value).split(/\s+/).filter(Boolean);
  return state.stores.filter(
    (s) => FILTERS[filter](s) && terms.every((t) => haystack(s).includes(t))
  );
}

function storeItem(s) {
  const done = s.changeCount > 0;
  const sub = [s.code, s.address].filter(Boolean).map(escapeHtml).join(" · ");
  const trail = done
    ? `<span class="badge" title="Cambios de ubicación">${icon("i-pin", "ic xs")}${s.changeCount}</span>` +
      `<span class="when">${escapeHtml(formatRelative(s.locationUpdatedAt))}</span>`
    : `<span class="badge muted">Pendiente</span>`;
  return (
    `<li><button class="store-item" type="button" data-id="${s.id}">` +
    `<span class="lead ${done ? "" : "pending"}">${icon("i-store")}</span>` +
    `<span class="txt"><span class="name">${escapeHtml(s.name)}</span><span class="sub">${sub}</span></span>` +
    `<span class="trail">${trail}</span></button></li>`
  );
}

function render({ force = false } = {}) {
  if (!state.stores) return;
  const key = `${state.version}|${filter}|${$("storeSearch").value}`;
  if (!force && key === renderedKey) return; // nada cambió: se conserva el scroll
  renderedKey = key;

  const all = state.stores;
  $("countAll").textContent = all.length;
  $("countPending").textContent = all.filter(FILTERS.pending).length;
  $("countDone").textContent = all.filter(FILTERS.done).length;

  const items = filtered();
  const query = $("storeSearch").value.trim();
  $("clearSearch").hidden = !query;
  $("storesSummary").textContent = !all.length
    ? ""
    : query
      ? `${items.length} resultado(s) para “${query}”`
      : `${items.length} tienda(s)`;

  $("stores").innerHTML = items.slice(0, MAX_RENDERED).map(storeItem).join("");
  const more = items.length - MAX_RENDERED;
  $("storesMore").hidden = more <= 0;
  $("storesMore").textContent = `Y ${more} tienda(s) más. Escribí en el buscador para encontrar la tuya.`;

  if (!all.length) {
    setMsg("storesMsg", "No hay tiendas cargadas todavía. Pedile al administrador que cargue el listado.");
  } else if (!items.length) {
    setMsg("storesMsg", query ? "Ninguna tienda coincide con la búsqueda." : "No hay tiendas en este filtro.");
  } else {
    setMsg("storesMsg", "");
  }
}

async function refresh({ force = false } = {}) {
  if (!state.stores) setMsg("storesMsg", "Cargando tiendas…");
  const btn = $("refreshStores");
  btn.classList.add("spinning");
  try {
    await loadStores({ force });
    render();
    if (force) toast("Listado actualizado.");
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message) {
      if (state.stores) toast(message, "error");
      else setMsg("storesMsg", message, "error");
    }
  } finally {
    btn.classList.remove("spinning");
  }
}

$("storeSearch").addEventListener("input", () => {
  render();
  $("storesBody").scrollTop = 0;
});
$("clearSearch").addEventListener("click", () => {
  $("storeSearch").value = "";
  render();
  $("storeSearch").focus();
});
$("storeSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur(); // oculta el teclado para ver los resultados
});

for (const btn of document.querySelectorAll(".filter")) {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    for (const b of document.querySelectorAll(".filter")) {
      const on = b === btn;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    render();
    $("storesBody").scrollTop = 0;
  });
}

$("stores").addEventListener("click", (e) => {
  const item = e.target.closest(".store-item");
  if (item) go(`/tiendas/${item.dataset.id}`);
});

$("refreshStores").addEventListener("click", () => refresh({ force: true }));

$("lockBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "¿Salir de la app?",
    body: "<p>Se va a pedir la contraseña otra vez en este dispositivo.</p>",
    accept: "Salir",
  });
  if (ok) lockApp();
});

export const storesScreen = {
  id: "screenStores",
  enter() {
    render();
    refresh();
  },
};
