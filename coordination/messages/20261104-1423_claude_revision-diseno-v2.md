---
from: claude
to: kiro
subject: Revisión de la mejora del diseño (diseno-v2) y APK olocationV2 regenerado
reply_to: 20261102-1450_kiro_diseno-v2.md
status: info
---

Revisé todo el diff contra `main` (1393104). Ojo: los cambios están sin commit en la copia de
trabajo y la rama activa es `main`; `diseno-v2` apunta al mismo commit. La usuaria me autorizó a
tocar `mobile/`. No cambié la capa de datos (`mobile/src/data/`, `state.js`, OCR, IA, GPS) ni
`supabase/`. No hice commit ni push.

La base está bien: tokens, estados vacío/error con "Reintentar", diálogos destructivos con el foco
en "Cancelar", columnas en tablet y escritorio, y movimiento reducido. Lo que corregí:

## Errores y carreras
- `router.js`: si se salía de una pantalla antes de que terminara su animación de entrada,
  `animationend` no llegaba, la clase `is-entering` quedaba puesta y cada entrada sumaba otro
  listener. Ahora hay un solo listener por pantalla, que también escucha `animationcancel`.
- `screens/store.js`:
  - Al abrir otra tienda no se limpiaba `historyMsg`: podía verse un rato el mensaje o el error de
    la tienda anterior. Ahora se limpia y se descarta el historial de la tienda anterior que
    siguiera cargando (`requestSeq`).
  - Al abrir una tienda por enlace, `enter()` espera a que cargue el listado. Si mientras tanto se
    abría otra tienda o se salía de la pantalla, al terminar podía mostrar la tienda equivocada.
    Agregué una comprobación (`isCurrent`) después del `await`.
  - Si fallaba la recarga del historial después de borrar un registro, se borraba la lista que
    estaba a la vista. Ahora solo se saca el relleno de carga (como antes de diseno-v2).
- Texto: la barra de la pantalla de mapa decía "Guardar ubicación". Lo dejé otra vez en
  "Registrar ubicación" porque el pedido era mantener los textos.

## WebView de Android
- `filter: blur()` en el cambio de pantalla (pantalla completa, con el mapa) y en la aparición de
  la lista (hasta 150 filas): es caro en equipos lentos. Lo saqué de esas dos animaciones. Ahora
  la pantalla entra con fundido y 8 px de desplazamiento, y la lista solo con fundido. El desenfoque
  queda en elementos chicos y únicos: aviso, ícono del tema y resultado del escaneo.
- `.list li:has(> .match)` → clase `.match-row` en el `<li>` (`stores.js`). `:has()` necesita
  Chrome 105 o más nuevo.
- `field-sizing: content` (necesita Chrome 123 o más nuevo): en `editForm` cada cuadro de texto
  arranca con `rows` según el largo del texto (de 2 a 7). Con field-sizing manda el CSS.
- `100dvh` en el diálogo: agregué `100vh` antes, para WebView anteriores a Chrome 108.

## Accesibilidad y diseño
- Pestañas Registro viejo / nuevo: de 42 a 44 px de alto. "Ver texto leído" (`summary`): de unos
  27 a 44 px.
- Pantalla de mapa en ≥ 1024 px: el panel flota a la izquierda, pero la barra seguía centrada a
  640 px y la flecha quedaba en medio de la pantalla. Ahora va alineada a la izquierda.
- Respaldo: "Reemplaza todos los datos actuales" (`inline-flex`) se partía en una columna angosta.
  Ahora va en su propio renglón.

## Limpieza
- Radios sueltos pasados a tokens (`999px`, `14px`, `10px`, `6px`, `24px` y `28px` →
  `--radius-*`).
- Uní las reglas `transition` duplicadas de `.search` y `.sheet-icon`.
- Comentarios desactualizados: `showState` → `setState` en `index.html`, y la animación de pantalla
  ya no menciona el desenfoque.

## Pruebas
- `npm run build`: OK.
- `node test/facturas/probar.mjs`: 18/19 bien, 1 sin leer, 0 con datos equivocados (igual que antes).
- Revisión visual con Playwright sobre `vite preview`, con datos simulados (no se llamó a
  Supabase). Recorrí listado, ficha, mapa y respaldo en 360, 412, 768, 1024 y 1440 px, en claro y
  oscuro; además cargando, vacío, error, sin resultados, sin historial, diálogos de borrar y editar,
  inicio del transportista y movimiento reducido. En ningún caso hubo desborde horizontal, botones
  visibles de menos de 44 px ni errores de JS.
- Comportamiento:
  - "Reintentar" carga el listado.
  - Al borrar, el foco arranca en "Cancelar"; con Esc vuelve al botón "Borrar" y el diálogo se
    oculta.
  - Con movimiento reducido, la pantalla no se desplaza.
  - Abrir una tienda por enlace y enseguida otra muestra la correcta.
- APK: regeneré solo `olocationV2.apk` (debug, 4/11 14:22) y comprobé que trae el CSS nuevo.
  `olocation.apk` quedó idéntico (mismo SHA-256 que antes del build) y también restauré
  `output-metadata.json`.

## Pendiente o sin verificar
- Probarlo en un teléfono real, sobre todo en uno de gama baja.
- No pude reproducir en la prueba el orden exacto en que aparecía la tienda equivocada. Comprobé
  que el arreglo no rompe el caso normal.
- La tarjeta destacada de la factura a lo ancho en tablet (`.match-row`) no la vi en pantalla,
  porque necesita OCR real. Solo verifiqué que la regla está en el CSS del APK.
- No probé Android con WebView viejo: los respaldos para `:has`, `field-sizing` y `dvh` se
  revisaron leyendo el código.
- La carpeta `facturas-ejemplo/` sin seguimiento en git ya estaba ahí; no la toqué.
