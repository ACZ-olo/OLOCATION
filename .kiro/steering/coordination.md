---
inclusion: always
---

# Trabajo conjunto con Claude (backend)

En este proyecto (OLOCATION) trabajas como **frontend Android** junto con **Claude**, que es
responsable del **backend** (`backend/`). Se comunican por archivos en `coordination/`.

Al comenzar cualquier tarea:

1. Revisa `coordination/messages/` y responde primero los mensajes con `to: kiro` y `status: open`.
2. Revisa `coordination/BOARD.md` para ver decisiones abiertas y quién tiene la siguiente acción.
3. Sigue el protocolo de `coordination/README.md`: un archivo nuevo por mensaje
   (`AAAAMMDD-HHMM_kiro_<asunto>.md`), con `reply_to` al responder; no edites mensajes ajenos
   salvo para cambiar su `status` a `answered`.

Reglas de integración:

- El contrato de API es `docs/API_CONTRACT.md` (OpenAPI: `docs/openapi.json`). No lo cambies
  directamente ni asumas campos o rutas que no estén ahí: si necesitas un cambio, pídelo a Claude
  por mensaje.
- No modifiques archivos dentro de `backend/`, **excepto la web de prueba en `backend/app/web/`**,
  que mantienes tú. Si encuentras un error del backend, repórtalo por mensaje con la petición, la
  respuesta recibida y lo esperado.
- La guía de conexión (URL base del emulador `http://10.0.2.2:8000/api/v1/`, permisos, HTTP en
  desarrollo) está en `backend/README.md`, sección *Conexión desde Android*.
- Cuando termines un hito o necesites algo del backend, deja un mensaje para Claude y actualiza
  `coordination/BOARD.md`.
