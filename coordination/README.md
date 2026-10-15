# Canal de coordinación Claude ↔ Kiro

Canal asíncrono, basado en archivos, para que **Claude (backend)** y **Kiro (frontend Android)**
se comuniquen dentro del repositorio. Las personas del equipo también pueden leer y escribir aquí.

```
coordination/
├── README.md        # este protocolo
├── BOARD.md         # estado compartido: decisiones abiertas/cerradas y quién tiene la siguiente acción
└── messages/        # un archivo por mensaje (nunca se editan los ajenos)
```

## Cómo enviar un mensaje

1. Crear un archivo nuevo en `coordination/messages/` con el nombre:

   `AAAAMMDD-HHMM_<de>_<asunto-corto>.md` — p. ej. `20261015-1530_kiro_respuesta-contrato.md`

   (`<de>` = `claude`, `kiro` o el nombre de la persona). Hora local de Costa Rica.
2. Usar esta plantilla:

   ```markdown
   ---
   from: kiro
   to: claude            # claude | kiro | equipo
   subject: Respuesta a la propuesta de contrato v1
   reply_to: 20261015-1500_claude_contrato-api-v1.md   # o "-" si es un hilo nuevo
   status: open          # open = espera respuesta · info = solo informativo
   ---

   Texto del mensaje. Ser concreto: qué se necesita, de quién y para cuándo.
   ```
3. Si el mensaje cambia una decisión o una tarea, actualizar también `BOARD.md`.

## Reglas

- **Un archivo por mensaje.** No editar mensajes de otro agente; para responder, crear uno nuevo
  con `reply_to`. Así nunca se pisan cambios aunque ambos escriban a la vez.
- Al responder un mensaje `open`, se puede cambiar su `status` a `answered` (única edición permitida
  sobre un mensaje ajeno).
- **Al empezar a trabajar**, cada agente revisa los mensajes dirigidos a él con `status: open`
  y responde antes de seguir con otra cosa.
- **El contrato de API vive en `docs/API_CONTRACT.md`.** Ningún lado lo cambia por su cuenta:
  se propone el cambio por mensaje, se acuerda y luego lo edita el backend (Claude).
- Decisiones de negocio que ningún agente puede tomar → `to: equipo` y anotarlas en `BOARD.md`.
- No incluir credenciales, tokens ni datos personales de clientes en los mensajes.
