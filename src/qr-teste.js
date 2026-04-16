import { supabase } from "./supabase.js";

const grid = document.getElementById("grid");

async function gerarQRCodes() {
  if (typeof QRCode === "undefined") {
    grid.innerHTML = '<p class="erro" style="grid-column:1/-1;text-align:center">Erro: biblioteca QRCode não carregou. Verifique a conexão com a internet.</p>';
    return;
  }

  grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#718096">Carregando alunos...</p>';

  const turmaId = new URLSearchParams(location.search).get("turma");

  let query = supabase.from("alunos").select("matricula, nome").order("nome");
  if (turmaId) query = query.eq("turma_id", turmaId);

  const { data, error } = await query;

  if (error) {
    grid.innerHTML = `<p class="erro" style="grid-column:1/-1;text-align:center">Erro ao carregar alunos: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#718096">Nenhum aluno encontrado.</p>';
    return;
  }

  grid.innerHTML = "";

  data.forEach(aluno => {
    const card   = document.createElement("div");
    card.className = "card";

    const qrBox  = document.createElement("div");
    qrBox.className = "qr-box";

    const idEl   = document.createElement("div");
    const nomeEl = document.createElement("div");
    idEl.className   = "id";
    nomeEl.className = "nome";
    idEl.textContent   = aluno.matricula;
    nomeEl.textContent = aluno.nome;

    card.appendChild(qrBox);
    card.appendChild(idEl);
    card.appendChild(nomeEl);
    grid.appendChild(card);

    new QRCode(qrBox, {
      text:         aluno.matricula,
      width:        140,
      height:       140,
      colorDark:    "#1a202c",
      colorLight:   "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  });
}

gerarQRCodes();
