// Historial de facturas de una tienda: lista con la foto y la fecha/hora de registro.
import { deleteInvoice, getInvoiceImage, listInvoices, registerInvoice } from "../data/index.js";
import { getToken } from "../lib/access.js";
import { escapeHtml, formatDateTime } from "../lib/format.js";
import { $, confirmDialog, icon, setMsg, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { findStore, loadStores, updateStore } from "../state.js";
import { handleDataError, openImageViewer, pickInvoicePhoto } from "./common.js";

let storeId = null;
let requestSeq = 0;
let invoices = []; // más reciente primero
let images = new Map(); // invoiceId → { url, revoke }
let deleting = false;
let saving = false;

function revokeImages() {
  for (const image of images.values()) image.revoke?.();
  images = new Map();
}

function render() {
  const total = invoices.length;
  $("invoicesList").innerHTML = invoices
    .map((inv, i) => {
      return (
        `<li class="invoice-item" data-id="${inv.id}">` +
        `<span class="invoice-num">#${total - i}</span>` +
        `<button class="invoice-thumb" type="button" data-view="${inv.id}" aria-label="Ver factura #${total - i}">` +
        `<img data-img="${inv.id}" alt="Factura #${total - i}" />` +
        `<span class="invoice-thumb-loading">${icon("i-image")}</span>` +
        `</button>` +
        `<div class="invoice-item-txt">` +
        `<span class="invoice-date">${escapeHtml(formatDateTime(inv.createdAt))}</span>` +
        `</div>` +
        `<button class="icon-btn small invoice-delete" type="button" data-del="${inv.id}"` +
        ` aria-label="Borrar factura #${total - i}" title="Borrar factura">${icon("i-trash")}</button>` +
        `</li>`
      );
    })
    .join("");
  setMsg("invoicesMsg", total ? "" : "Todavía no se registró ninguna factura de esta tienda.");
  loadImages();
}

/** Carga la imagen de cada factura y la coloca en su miniatura. */
async function loadImages() {
  const seq = requestSeq;
  for (const inv of invoices) {
    if (images.has(inv.id)) {
      applyImage(inv.id);
      continue;
    }
    try {
      const image = await getInvoiceImage(getToken(), storeId, inv.id);
      if (seq !== requestSeq) {
        image.revoke?.();
        return;
      }
      images.set(inv.id, image);
      applyImage(inv.id);
    } catch {
      // una imagen que falla no rompe la lista; la miniatura queda con el ícono de carga
    }
  }
}

function applyImage(invoiceId) {
  const img = document.querySelector(`#invoicesList img[data-img="${invoiceId}"]`);
  const image = images.get(invoiceId);
  if (img && image) {
    img.src = image.url;
    img.closest(".invoice-thumb")?.classList.add("ready");
  }
}

async function load() {
  const seq = ++requestSeq;
  setMsg("invoicesMsg", "Cargando facturas…");
  try {
    const items = await listInvoices(getToken(), storeId);
    if (seq !== requestSeq) return;
    revokeImages();
    invoices = items;
    render();
  } catch (e) {
    const message = handleDataError(e, { silent: true });
    if (message && seq === requestSeq) setMsg("invoicesMsg", message, "error");
  }
}

$("invoicesList").addEventListener("click", async (e) => {
  const view = e.target.closest("[data-view]");
  if (view) {
    const image = images.get(Number(view.dataset.view));
    if (image) openImageViewer(image.url); // la pantalla sigue usando la URL: no se revoca aquí
    return;
  }
  const del = e.target.closest("[data-del]");
  if (!del || deleting) return;
  const invoice = invoices.find((inv) => inv.id === Number(del.dataset.del));
  if (!invoice) return;
  const number = invoices.length - invoices.indexOf(invoice);
  const ok = await confirmDialog({
    title: `¿Borrar la factura #${number}?`,
    body:
      `<p>${escapeHtml(formatDateTime(invoice.createdAt))}</p>` +
      `<p class="muted">La foto se borra definitivamente. No se puede deshacer.</p>`,
    accept: "Borrar",
  });
  if (!ok) return;

  deleting = true;
  del.disabled = true;
  const id = storeId;
  try {
    const { store } = await deleteInvoice(getToken(), id, invoice.id);
    updateStore(store);
    images.get(invoice.id)?.revoke?.();
    images.delete(invoice.id);
    toast("Factura borrada.", "ok");
    if (storeId === id) await load();
  } catch (e) {
    handleDataError(e);
    if (e.code === "INVOICE_NOT_FOUND" && storeId === id) load(); // ya no existía
    del.disabled = false;
  } finally {
    deleting = false;
  }
});

async function addInvoice() {
  if (saving || storeId == null) return;
  const photo = await pickInvoicePhoto();
  if (!photo) return;
  saving = true;
  const id = storeId;
  $("addInvoiceFromList").disabled = true;
  try {
    const { store } = await registerInvoice(getToken(), id, photo);
    updateStore(store);
    toast(`Factura registrada · total ${store.invoiceCount}`, "ok");
    if (storeId === id) await load();
  } catch (e) {
    handleDataError(e);
  } finally {
    saving = false;
    $("addInvoiceFromList").disabled = false;
  }
}

$("addInvoiceFromList").addEventListener("click", addInvoice);

export const invoicesScreen = {
  id: "screenInvoices",
  parent: ({ id }) => `/tiendas/${id}`,
  async enter({ id }) {
    const changed = storeId !== Number(id);
    storeId = Number(id);
    if (changed) {
      revokeImages();
      invoices = [];
      $("invoicesList").innerHTML = "";
      $("screenInvoices").querySelector(".screen-body").scrollTop = 0;
    }
    let store = findStore(id);
    if (!store) {
      try {
        await loadStores();
      } catch (e) {
        const message = handleDataError(e, { silent: true });
        if (message) setMsg("invoicesMsg", message, "error");
        return;
      }
      store = findStore(id);
    }
    if (!store) {
      $("invoicesTitle").textContent = "Tienda no encontrada";
      setMsg("invoicesMsg", "Esta tienda ya no existe en el listado.", "error");
      return;
    }
    $("invoicesTitle").textContent = store.name;
    load();
  },
  leave() {
    // No se revocan las imágenes al salir hacia el detalle para no recargar al volver;
    // se liberan cuando se entra a otra tienda (changed) o al borrar.
  },
};
