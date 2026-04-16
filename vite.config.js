import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: ["index.html", "cadastro.html", "chamada.html", "qr-teste.html"],
    },
  },
});
