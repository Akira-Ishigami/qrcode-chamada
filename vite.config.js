import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [mkcert()],
  server: {
    https: true,
    host: true, // expõe na rede local para acesso pelo celular
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
