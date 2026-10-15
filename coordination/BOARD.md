# Tablero compartido

Estado actual del trabajo conjunto. Lo actualiza quien cambie algo (agregar, no borrar historial:
mover a "Cerradas" con la fecha y el mensaje donde se acordó).

## Responsables

| Área | Responsable | Carpeta |
|---|---|---|
| Backend / API / base de datos | Claude | `backend/` |
| Frontend Android | Kiro | `android/` (a crear por Kiro) |
| Web de prueba | Kiro | `backend/app/web/` (solo esos archivos) |
| Contrato de API | Ambos (lo edita Claude tras acuerdo) | `docs/API_CONTRACT.md` |

## Decisiones abiertas

| # | Tema | Propuesta | Esperando a | Hilo |
|---|---|---|---|---|
| D4 | Datos reales (clientes, transportistas con PIN, asignaciones) y quién mantiene el archivo de carga | Archivo JSON + `python -m scripts.seed`. Mientras tanto: datos de prueba `backend/seed/demo.json` | Equipo (lo enviará más adelante) | `20261015-1500_claude_contrato-api-v1.md` |

## Decisiones cerradas

| # | Tema | Resolución | Fecha | Hilo |
|---|---|---|---|---|
| D1 | Aprobación del contrato de API v1 | Kiro aprobó el contrato v1 sin cambios | 2026-10-15 | `20261015-1545_kiro_respuesta-contrato-api-v1.md` |
| D2 | Qué significa "seleccionar el punto" | El transportista marca una coordenada nueva (mapa/GPS) y se guarda con el POST; el GET lista las existentes | 2026-10-15 | idem |
| D5 | Transportista (datos personales) | Nombre, cédula y placa obligatorios; teléfono opcional. Se identifica por cédula | 2026-10-15 | `20261015-1615_claude_contrato-v1.1-transportistas.md` |
| D6 | Clientes por transportista | Solo los asignados: `GET /carriers/{id}/clients`; asignaciones cargadas con el seed | 2026-10-15 | idem |
| D7 | Autoría de ubicaciones | Cada ubicación registra el transportista (desde v1.2, tomado del token) | 2026-10-15 | idem |
| D8 | Etiqueta de la ubicación | Se pide antes de guardar y va en el mismo POST; sin PATCH | 2026-10-15 | idem |
| D9 | Aprobación del contrato v1.1 (transportistas) | Kiro aprobó v1.1 y adaptó la web de prueba | 2026-10-15 | `20261015-1700_kiro_aprobacion-contrato-v1.1.md` |
| D3 | Autenticación | Cédula + PIN (cargado por el supervisor) → token Bearer 30 días; bloqueo 15 min tras 5 fallos; sin auto-registro | 2026-10-15 | `20261015-1730_claude_contrato-v1.2-autenticacion.md` |
| D10 | Aprobación del contrato v1.2 (autenticación) | Kiro aprobó v1.2, reinició el server y adaptó la web de prueba (login + token) | 2026-10-15 | `20261015-1800_kiro_aprobacion-contrato-v1.2.md` |
| D11 | Endpoint de registros por transportista (v1.3) | Kiro aprobó v1.3; pantalla Registros migrada a `GET /carriers/{id}/locations` | 2026-10-15 | `20261015-1905_kiro_aprobacion-v1.3.md` |

## Estado

- **Backend v1.3:** implementado y probado (46 tests). v1.3 agrega el historial `GET /carriers/{id}/locations`. Base v1.2: login cédula + PIN, token en todas las
  rutas, clientes asignados, transportista tomado del token. Base local migrada y con datos de
  prueba (`seed/demo.json`). API en `http://localhost:8000`, docs en `/docs`.
- **Servidor en :8000:** reiniciado por Kiro con código v1.3 (2026-10-15). Recordatorio: tras cada
  cambio del backend hay que reiniciar uvicorn para que tome efecto.
- **Preview web:** `backend/app/web/` (mantiene Kiro). **Al día con v1.3** (2026-10-15): login
  cédula + PIN, token Bearer, POST de ubicación sin `carrierId`, manejo de 401/429, y pantalla
  **Registros** usando `GET /carriers/{id}/locations` (se actualiza al instante al guardar).
- **Android:** pendiente de inicio por Kiro en `android/`, directamente sobre v1.3.
