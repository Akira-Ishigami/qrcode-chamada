import { supabase } from "./supabase.js";

let _callback = null;

// ─── Inicializar eventos do modal (chamar uma vez por página) ─────────────────
export function iniciarModalGerenciar() {
  document.getElementById("btn-fechar-gerenciar")
    .addEventListener("click", fecharModalGerenciar);

  document.getElementById("modal-gerenciar")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) fecharModalGerenciar();
    });

  document.getElementById("ger-btn-add-inst")
    .addEventListener("click", adicionarInstituicao);

  document.getElementById("ger-btn-add-turma")
    .addEventListener("click", adicionarTurma);

  document.getElementById("ger-inst-nome")
    .addEventListener("keydown", (e) => { if (e.key === "Enter") adicionarInstituicao(); });
}

// ─── Abrir modal ──────────────────────────────────────────────────────────────
export async function abrirModalGerenciar(callback = null) {
  _callback = callback;
  document.getElementById("modal-gerenciar").classList.add("open");
  await carregarInstituicoesNoModal();
}

export function fecharModalGerenciar() {
  document.getElementById("modal-gerenciar").classList.remove("open");
  limparFeedbacks();
}

// ─── Carregar lista de instituições no modal ──────────────────────────────────
async function carregarInstituicoesNoModal() {
  const list   = document.getElementById("ger-inst-list");
  const selGer = document.getElementById("ger-turma-inst");

  list.innerHTML   = '<div style="color:#a0aec0;font-size:0.82rem;padding:4px 0">Carregando...</div>';
  selGer.innerHTML = '<option value="">Selecione...</option>';

  const { data } = await supabase
    .from("instituicoes").select("id, nome").order("nome");

  list.innerHTML = "";

  if (!data || !data.length) {
    list.innerHTML = '<div style="color:#a0aec0;font-size:0.82rem;padding:4px 0">Nenhuma instituição cadastrada.</div>';
    return;
  }

  data.forEach(inst => {
    const item = document.createElement("div");
    item.className   = "ger-item";
    item.textContent = inst.nome;
    list.appendChild(item);

    const opt = document.createElement("option");
    opt.value = inst.id; opt.textContent = inst.nome;
    selGer.appendChild(opt);
  });
}

// ─── Adicionar instituição ────────────────────────────────────────────────────
async function adicionarInstituicao() {
  const input    = document.getElementById("ger-inst-nome");
  const feedEl   = document.getElementById("ger-inst-feedback");
  const btn      = document.getElementById("ger-btn-add-inst");
  const nome     = input.value.trim();

  if (!nome) { input.focus(); return; }

  btn.disabled    = true;
  btn.textContent = "Salvando...";
  setGerFeedback(feedEl, "", "");

  const { data, error } = await supabase
    .from("instituicoes").insert({ nome }).select("id").single();

  btn.disabled    = false;
  btn.textContent = "Adicionar";

  if (error) {
    const msg = error.code === "23505" ? "Já existe uma instituição com este nome." : error.message;
    setGerFeedback(feedEl, msg, "error");
    return;
  }

  input.value = "";
  setGerFeedback(feedEl, `"${nome}" adicionada!`, "success");
  await carregarInstituicoesNoModal();

  if (_callback) _callback("instituicao", data.id);
}

// ─── Adicionar turma ──────────────────────────────────────────────────────────
async function adicionarTurma() {
  const selGer   = document.getElementById("ger-turma-inst");
  const nomeInp  = document.getElementById("ger-turma-nome");
  const profInp  = document.getElementById("ger-turma-prof");
  const horInp   = document.getElementById("ger-turma-horario");
  const feedEl   = document.getElementById("ger-turma-feedback");
  const btn      = document.getElementById("ger-btn-add-turma");

  const instId = selGer.value;
  const nome   = nomeInp.value.trim();

  if (!instId) { setGerFeedback(feedEl, "Selecione a instituição.", "error"); return; }
  if (!nome)   { nomeInp.focus(); return; }

  btn.disabled    = true;
  btn.textContent = "Salvando...";
  setGerFeedback(feedEl, "", "");

  const { data, error } = await supabase
    .from("turmas")
    .insert({
      nome,
      professor:      profInp.value.trim() || null,
      horario:        horInp.value.trim()  || null,
      instituicao_id: instId,
    })
    .select("id").single();

  btn.disabled    = false;
  btn.textContent = "Adicionar Turma";

  if (error) {
    setGerFeedback(feedEl, "Erro: " + error.message, "error");
    return;
  }

  nomeInp.value = profInp.value = horInp.value = "";
  setGerFeedback(feedEl, `Turma "${nome}" adicionada!`, "success");

  if (_callback) _callback("turma", data.id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setGerFeedback(el, msg, type) {
  el.textContent = msg;
  el.className   = `ger-feedback ${type}`;
}

function limparFeedbacks() {
  ["ger-inst-feedback", "ger-turma-feedback"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ""; el.className = "ger-feedback"; }
  });
}
