# OLOCATION — App móvil (Android)

App para que los transportistas registren la ubicación real de las tiendas: listado con buscador
(con la coordenada vigente de cada tienda), detalle con conteo e historial de cambios (se pueden
borrar registros), y registro **solo con la ubicación actual del teléfono (GPS)**: el mapa es
fijo, no se mueve ni deja elegir un punto. Pestaña **Respaldo** para descargar/restaurar un
respaldo JSON y descargar las tiendas en CSV. Acceso con contraseña general, opción de recordar
el dispositivo y tema claro/oscuro.

- **Stack:** Vite + JavaScript (sin framework) + [Capacitor 8](https://capacitorjs.com) para Android
  + Leaflet / OpenStreetMap.
- **Datos:** capa intercambiable en `src/data/` — hoy backend FastAPI (`../backend`), preparada
  para Supabase (`../docs/SUPABASE.md`).
- **Diseño:** identidad de OLO Soluciones Logísticas (verde `#00a785`, carbón `#251e1f`,
  Open Sans + Roboto incluidas en la app).

```
mobile/
├── index.html              # las 4 pantallas + íconos SVG
├── src/
│   ├── main.js             # arranque, rutas y botón "atrás" de Android
│   ├── router.js           # navegación por hash (#/tiendas/12)
│   ├── state.js            # listado de tiendas en memoria
│   ├── config.js           # variables VITE_* y constantes (GPS, mapa)
│   ├── styles.css
│   ├── data/               # capa de datos: index.js (interfaz), api.js, supabase.js
│   ├── lib/                # acceso, tema, GPS, mapa, formato, UI (diálogo, avisos)
│   └── screens/            # access, stores, store, locate
├── assets/                 # fuentes del ícono y splash (se generan con @capacitor/assets)
├── android/                # proyecto de Android Studio (generado por Capacitor)
└── capacitor.config.json   # appId com.ologistics.olocation
```

## Requisitos

- Node.js 20+ (probado con 24) y npm.
- Para Android: Android Studio (trae el SDK y Java). El proyecto usa **Gradle 9.1** porque el
  Java 25 de Android Studio no corre con la versión que trae Capacitor; el JDK 21 que piden
  algunos plugins se descarga solo la primera vez (plugin *foojay* en `android/settings.gradle`).

```bash
cd mobile
npm install
cp .env.example .env      # y completar VITE_API_URL (ver abajo)
```

## Probar en el PC (navegador)

Con el backend corriendo (`cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`):

```bash
npm run dev               # http://localhost:5173 (proxy de /api al backend)
```

O compilar y dejar que el backend la sirva en <http://localhost:8000/>:

```bash
npm run build
```

En el navegador la app usa la misma dirección desde la que se abrió, así que `VITE_API_URL`
solo importa para el APK. Para simular un teléfono: DevTools → modo dispositivo.

## Generar el APK (Android Studio)

1. En `mobile/.env`, `VITE_API_URL` = dirección del backend **vista desde el teléfono**:

   | Dónde corre la app | `VITE_API_URL` |
   |---|---|
   | Teléfono en la misma Wi‑Fi que el PC | `http://<IP-del-PC>:8000` (ver `ipconfig`) |
   | Emulador de Android Studio | `http://10.0.2.2:8000` |
   | Servidor publicado | `https://<dominio>` |

   El backend debe correr con `--host 0.0.0.0` y el puerto 8000 permitido en el firewall.
2. Compilar la web y copiarla al proyecto Android:

   ```bash
   npm run android:sync
   ```

3. Abrir en Android Studio: `npm run android:open` (o *File → Open* → `mobile/android`).
4. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. El archivo queda en
   `android/app/build/outputs/apk/debug/app-debug.apk`. Pasarlo al teléfono e instalarlo
   (hay que permitir "instalar apps de origen desconocido").

   Por consola, sin abrir Android Studio (PowerShell):

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   npm run android:apk
   ```

5. Para publicar (APK/AAB **release** firmado): *Build → Generate Signed App Bundle / APK* y
   crear un keystore. Guardar el keystore y sus claves fuera del repositorio.

**Cada cambio en `src/` o en `.env` requiere `npm run android:sync`** antes de compilar de nuevo.

### Ícono y pantalla de inicio

Salen de `assets/` (logo OLO sobre carbón). Para regenerarlos después de cambiar esas imágenes:

```bash
npx capacitor-assets generate --android --iconBackgroundColor "#251e1f" --iconBackgroundColorDark "#0e0b0b" --splashBackgroundColor "#251e1f" --splashBackgroundColorDark "#0e0b0b"
```

## Notas

- **HTTP en desarrollo:** `capacitor.config.json` permite `http://` (`cleartext`,
  `allowMixedContent`) para hablar con el backend local. En producción usar HTTPS y quitarlos.
- **GPS:** en el teléfono usa el plugin nativo (pide permiso de ubicación la primera vez). Al abrir
  "Registrar ubicación" empieza a medir solo: escucha el GPS hasta ~12 s y se queda con la lectura
  más precisa (para en cuanto logra ±15 m); si la precisión es peor que ±50 m lo avisa y se puede
  "Volver a medir". No hay forma de elegir ni ajustar el punto a mano.
- **Respaldo / CSV en Android:** el WebView no descarga archivos, así que se guardan con
  `@capacitor/filesystem` en **Documentos/OLOCATION** y la app ofrece compartirlos
  (`@capacitor/share`: Drive, Gmail, WhatsApp…). Para restaurar se elige el `.json` con el
  selector de archivos del teléfono. En el navegador se descargan normalmente.
- **Mapa:** teselas de OpenStreetMap (requieren internet, sin API key). Para uso intensivo en
  producción conviene un proveedor de teselas con plan (MapTiler, Stadia, etc.).
- **Botón atrás de Android:** cierra diálogos, vuelve de pantalla y en el listado sale de la app.
- **Recordar este dispositivo:** guarda solo el token (nunca la contraseña). Si no se marca, el
  acceso dura hasta cerrar la app. El candado del listado sale y olvida el dispositivo.
