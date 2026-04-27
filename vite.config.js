import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      input: ["index.html", "login.html", "cadastro.html", "chamada.html", "qr-teste.html", "turmas.html", "horarios.html", "professores.html", "relatorio.html", "minhas-turmas.html", "dashboard.html", "relatorio-dia.html"],
    },
  },
});
