/**
 * Error común a todos los proveedores de datos. La app decide siempre por `code`:
 *   UNAUTHORIZED        acceso vencido o contraseña cambiada → volver a la pantalla de acceso
 *   INVALID_PASSWORD    contraseña incorrecta
 *   TOO_MANY_ATTEMPTS   demasiados intentos fallidos
 *   STORE_NOT_FOUND     la tienda no existe
 *   VALIDATION_ERROR    datos inválidos
 *   NETWORK             sin conexión con el servidor
 *   NOT_CONFIGURED      falta configuración (contraseña en el servidor, claves de Supabase…)
 *   UNKNOWN             cualquier otro
 */
export class DataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DataError";
    this.code = code;
  }
}
