import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig(({ command }) => ({
  // mkcert só no servidor de dev — nunca no build de produção (Vercel)
  plugins: command === "serve" ? [mkcert()] : [],

  server: {
    https: true,
    host: true, // acesso pelo celular na rede local
  },

  build: {
    target: "esnext",
    rollupOptions: {
      input: [
        "index.html",
        "login.html",
        "cadastro.html",
        "chamada.html",
        "qr-teste.html",
        "turmas.html",
        "horarios.html",
        "professores.html",
        "relatorio.html",
        "relatorio-dia.html",
        "minhas-turmas.html",
        "dashboard.html",
        "inst-dashboard.html",
        "suporte.html",
        "cracha.html",
      ],
    },
  },
}));
