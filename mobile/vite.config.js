import { defineConfig } from "vite";

export default defineConfig({
  // Rutas relativas: la app funciona servida por Capacitor (Android), por FastAPI o por Vite.
  base: "./",
  server: {
    host: true, // accesible desde el celular en la misma Wi‑Fi
    port: 5173,
    proxy: {
      // En desarrollo, /api/... va al backend FastAPI local.
      "/api": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
