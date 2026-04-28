import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true, // expõe na rede local (permite acesso pelo celular)
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: [
        "index.html", "login.html", "cadastro.html", "chamada.html",
        "qr-teste.html", "turmas.html", "horarios.html", "professores.html",
        "relatorio.html", "minhas-turmas.html", "dashboard.html",
        "inst-dashboard.html", "relatorio-dia.html",
      ],
    },
  },
});
