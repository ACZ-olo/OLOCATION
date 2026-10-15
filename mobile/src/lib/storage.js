// localStorage/sessionStorage pueden fallar (modo privado, almacenamiento lleno): nunca rompen la app.
export function safeStorage(store) {
  return {
    get(key) {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store.setItem(key, value);
      } catch {
        // sin almacenamiento: la preferencia dura solo mientras la app está abierta
      }
    },
    remove(key) {
      try {
        store.removeItem(key);
      } catch {
        // idem
      }
    },
  };
}
