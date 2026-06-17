import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { podeAdmin } from "./nav-role.js";
import { abrirModalGerenciar, iniciarModalGerenciar } from "./gerenciar.js";
import QRCode from "qrcode";
import JSZip from "jszip";
import { gerarCracha, downloadCracha, buscarCrachaConfig } from "./cracha.js";

let _crachaConfig = null; // carregado no init

// ─── State ────────────────────────────────────────────────────────────────────
let todosAlunos = [];
let alunosFiltrados = [];
let fotoBase64 = null;

// ─── Máscara de telefone ──────────────────────────────────────────────────────
function maskPhone(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 11);
    let masked = digits;
    if (digits.length > 2)  masked = `(${digits.slice(0,2)}) ${digits.slice(2)}`;
    if (digits.length > 7)  masked = `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
    if (digits.length > 10) masked = `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`;
    input.value = masked;
  });
}

// ─── Upload de foto ───────────────────────────────────────────────────────────
const fotoArea    = document.getElementById("foto-upload-area");
const fotoInput   = document.getElementById("foto_file");
const fotoPreview = document.getElementById("foto-preview");

fotoArea.addEventListener("click", () => fotoInput.click());
fotoInput.addEventListener("change", () => {
  const file = fotoInput.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast("Foto muito grande (máx 2MB).", "error"); return; }
  const reader = new FileReader();
  reader.onload = e => {
    fotoBase64 = e.target.result;
    fotoPreview.innerHTML = `<img src="${fotoBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" />`;
    fotoArea.classList.add("has-foto");
  };
  reader.readAsDataURL(file);
});

// ─── DOM: modal de aluno ──────────────────────────────────────────────────────
const modalAluno   = document.getElementById("modal-novo-aluno");
const btnNovoAluno = document.getElementById("btn-novo-aluno");
const btnFecharAluno = document.getElementById("btn-fechar-modal-aluno");
const btnAlunoCancel = document.getElementById("btn-aluno-cancel");

function abrirModalAluno() {
  modalAluno.classList.add("open");
  setTimeout(() => document.getElementById("nome")?.focus(), 120);
}

function fecharModalAluno() {
  modalAluno.classList.remove("open");
  fotoBase64 = null;
  fotoInput.value = "";
  fotoPreview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  fotoArea.classList.remove("has-foto");
}

btnNovoAluno.addEventListener("click", abrirModalAluno);
btnFecharAluno.addEventListener("click", fecharModalAluno);
btnAlunoCancel.addEventListener("click", fecharModalAluno);
modalAluno.addEventListener("click", e => { if (e.target === modalAluno) fecharModalAluno(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModalAluno(); });

// Máscara no campo de telefone do modal de novo aluno
maskPhone(document.getElementById("telefone"));

// ─── DOM: formulário ──────────────────────────────────────────────────────────
const selTurma  = document.getElementById("turma");
const btnSubmit = document.getElementById("btn-submit");
const feedback  = document.getElementById("feedback");

// ─── DOM: painel de alunos ────────────────────────────────────────────────────
const filterInst   = document.getElementById("filter-inst");
const filterTurma  = document.getElementById("filter-turma");
const filterBusca  = document.getElementById("filter-busca");
const alunosList   = document.getElementById("alunos-list");
const countBadge   = document.getElementById("count-badge");
const btnDlAll     = document.getElementById("btn-dl-all");
const btnDlAllQr   = document.getElementById("btn-dl-all-qr");

// ─── Carregar turmas (form) ───────────────────────────────────────────────────
async function carregarTurmas(instId, selecionarId = null) {
  selTurma.innerHTML = '<option value="">Carregando turmas…</option>';

  const { data, error } = await supabaseAdmin
    .from("turmas").select("id, nome")
    .eq("instituicao_id", instId).order("nome");

  if (error || !data?.length) {
    selTurma.innerHTML = '<option value="">Nenhuma turma cadastrada</option>';
    return;
  }

  selTurma.innerHTML = '<option value="">Selecione a turma…</option>';
  data.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.nome;
    selTurma.appendChild(opt);
  });

  if (selecionarId) selTurma.value = selecionarId;
}

// ─── Modal gerenciar (se existir o botão) ────────────────────────────────────
const btnAbrirGer = document.getElementById("btn-abrir-gerenciar");
if (btnAbrirGer && btnAbrirGer.tagName === "BUTTON") {
  btnAbrirGer.addEventListener("click", () => {
    abrirModalGerenciar(async (tipo, id) => {
      if (tipo === "instituicao") {
        await carregarInstituicoes(id);
        await carregarFiltroInstituicoes();
      }
      if (tipo === "turma") {
        await carregarTurmas(selInstituicao.value, id);
        await carregarAlunos();
      }
    });
  });
}

// ─── Submit: cadastrar aluno ──────────────────────────────────────────────────
document.getElementById("form-cadastro").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  setFeedback("", "");

  const nome           = document.getElementById("nome").value.trim();
  const matricula      = document.getElementById("matricula").value.trim();
  const telefone       = document.getElementById("telefone").value.trim()       || null;
  const dataNasc       = document.getElementById("data_nascimento").value       || null;
  const idEstadual     = document.getElementById("id_estadual").value.trim()    || null;
  const endereco       = document.getElementById("endereco").value.trim()       || null;
  const fotoUrl       = fotoBase64 || null;
  const instituicaoId = _adminInstId;
  const turmaId       = selTurma.value || null;

  let hasError = false;
  if (!nome)       { fieldError("nome",            "Nome é obrigatório.");            hasError = true; }
  if (!matricula)  { fieldError("matricula",       "Matrícula é obrigatória.");       hasError = true; }
  if (!dataNasc)   { fieldError("data_nascimento", "Data de nascimento obrigatória."); hasError = true; }
  if (!idEstadual) { fieldError("id_estadual",     "ID Estadual é obrigatório.");      hasError = true; }
  if (!turmaId)    { fieldError("turma",           "Selecione uma turma.");            hasError = true; }
  if (hasError) return;

  setLoading(true);

  const { error } = await supabaseAdmin.from("alunos").insert({
    nome,
    matricula,
    telefone,
    data_nascimento: dataNasc,
    id_estadual:     idEstadual,
    endereco,
    foto_url:        fotoUrl,
    instituicao_id:  instituicaoId,
    turma_id:        turmaId,
  });

  setLoading(false);

  if (error) {
    if (error.code === "23505") fieldError("matricula", "Matrícula já cadastrada.");
    else setFeedback("Erro ao cadastrar: " + error.message, "error");
    return;
  }

  fecharModalAluno();
  document.getElementById("form-cadastro").reset();
  await carregarTurmas(_adminInstId);
  clearErrors();
  setFeedback("", "");
  showToast("Aluno cadastrado com sucesso!", "success");

  // Recarrega a lista
  await carregarAlunos();
});

// ─── Carregar alunos (painel direito) ─────────────────────────────────────────
async function carregarAlunos() {
  alunosList.className = "alunos-list alunos-card-grid";
  alunosList.innerHTML = skeletonCards(8);

  let alunosQuery = supabaseAdmin
    .from("alunos")
    .select(`
      id, nome, matricula, foto_url, telefone, data_nascimento, id_estadual, endereco, user_id,
      turma:turmas(id, nome, horario),
      inst:instituicoes(id, nome)
    `)
    .order("nome");
  if (_adminInstId) alunosQuery = alunosQuery.eq("instituicao_id", _adminInstId);
  const { data, error } = await alunosQuery;

  if (error) {
    alunosList.innerHTML = `<div class="list-err">Erro ao carregar alunos: ${error.message}</div>`;
    return;
  }

  todosAlunos = data ?? [];
  aplicarFiltros();
}

// ─── Carregar turmas do filtro direto (para usuário instituição) ──────────────
async function carregarFiltroTurmasDaInst(instId) {
  const { data } = await supabaseAdmin.from("turmas").select("id, nome").eq("instituicao_id", instId).order("nome");
  filterTurma.innerHTML = '<option value="">Todas as turmas</option>';
  filterTurma.disabled = false;
  (data ?? []).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.nome;
    filterTurma.appendChild(opt);
  });
}

// ─── Carregar opções do filtro de instituições ────────────────────────────────
async function carregarFiltroInstituicoes() {
  const { data } = await supabase
    .from("instituicoes").select("id, nome").order("nome");

  filterInst.innerHTML = '<option value="">Todas as instituições</option>';
  (data ?? []).forEach(inst => {
    const opt = document.createElement("option");
    opt.value = inst.id; opt.textContent = inst.nome;
    filterInst.appendChild(opt);
  });
}

// ─── Filtrar e renderizar alunos ──────────────────────────────────────────────
function aplicarFiltros() {
  const instId  = filterInst.value;
  const turmaId = filterTurma.value;
  const busca   = filterBusca.value.toLowerCase().trim();

  alunosFiltrados = todosAlunos.filter(a => {
    if (instId  && a.inst?.id  !== instId)  return false;
    if (turmaId && a.turma?.id !== turmaId) return false;
    if (busca) {
      const match = a.nome.toLowerCase().includes(busca) ||
                    a.matricula.toLowerCase().includes(busca);
      if (!match) return false;
    }
    return true;
  });

  renderAlunos();
}

const SVG_ALUNO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22">
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
</svg>`;

function skeletonCards(n = 8) {
  return Array.from({ length: n }, (_, i) => `
    <div class="aluno-card aluno-card-skeleton" style="--delay:${i * 0.06}s">
      <div class="sk-avatar"></div>
      <div class="sk-line sk-name"></div>
      <div class="sk-line sk-meta"></div>
      <div class="sk-actions"></div>
    </div>`).join("");
}

const ALUNO_PALETTES = [
  ["#dbeafe","#1d4ed8"], ["#dcfce7","#15803d"], ["#fce7f3","#be185d"],
  ["#fef9c3","#a16207"], ["#ede9fe","#6d28d9"], ["#ffedd5","#c2410c"],
  ["#cffafe","#0e7490"], ["#fef2f2","#b91c1c"],
];

// Cor por turma (estável: deriva do id da turma), para identificar quem é de qual turma
const TURMA_CORES = [
  { solid:"#2563eb", tint:"#eff6ff", text:"#1e40af" },
  { solid:"#16a34a", tint:"#f0fdf4", text:"#15803d" },
  { solid:"#db2777", tint:"#fdf2f8", text:"#9d174d" },
  { solid:"#ea580c", tint:"#fff7ed", text:"#c2410c" },
  { solid:"#7c3aed", tint:"#f5f3ff", text:"#5b21b6" },
  { solid:"#0891b2", tint:"#ecfeff", text:"#0e7490" },
  { solid:"#ca8a04", tint:"#fefce8", text:"#a16207" },
  { solid:"#dc2626", tint:"#fef2f2", text:"#b91c1c" },
  { solid:"#0d9488", tint:"#f0fdfa", text:"#115e59" },
  { solid:"#4f46e5", tint:"#eef2ff", text:"#3730a3" },
];
function corDaTurma(turmaId) {
  const s = String(turmaId || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TURMA_CORES[h % TURMA_CORES.length];
}

function renderAlunos() {
  countBadge.textContent = alunosFiltrados.length;
  btnDlAll.disabled    = alunosFiltrados.length === 0;
  if (btnDlAllQr) btnDlAllQr.disabled = alunosFiltrados.length === 0;

  if (alunosFiltrados.length === 0) {
    alunosList.className = "alunos-list";
    alunosList.innerHTML = `
      <div class="tv-empty">
        <div class="tv-empty-icon inst">${SVG_ALUNO}</div>
        <h3>${todosAlunos.length === 0 ? "Nenhum aluno cadastrado ainda" : "Nenhum aluno encontrado"}</h3>
        <p>${todosAlunos.length === 0 ? "Clique em \"Novo Aluno\" para cadastrar o primeiro." : "Tente ajustar os filtros acima."}</p>
      </div>`;
    return;
  }

  const SVG_EDIT   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const SVG_CRACHA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/><path d="M9 18h6"/></svg>`;

  alunosList.className = "alunos-list alunos-card-grid";
  alunosList.innerHTML = "";

  const SVG_QR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="11" height="11"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="18" y1="6" x2="18" y2="6"/><line x1="18" y1="18" x2="18" y2="18"/></svg>`;

  alunosFiltrados.forEach((a, i) => {
    const initials = a.nome.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
    const [bg, fg] = ALUNO_PALETTES[(a.nome.charCodeAt(0) || 0) % ALUNO_PALETTES.length];
    const ct = a.turma?.id ? corDaTurma(a.turma.id) : null;

    const card = document.createElement("div");
    card.className = "aluno-card";
    card.style.animationDelay = `${i * 0.03}s`;
    if (ct) card.style.setProperty("--turma-c", ct.solid);

    card.innerHTML = `
      <div class="aluno-card-avatar" style="background:${bg};color:${fg}${ct ? `;box-shadow:0 0 0 3px #fff,0 0 0 5px ${ct.solid}` : ""}">
        ${a.foto_url ? `<img src="${a.foto_url}" alt="${initials}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : initials}
      </div>
      <div class="aluno-card-name">${a.nome}</div>
      <div class="aluno-card-meta">
        <span class="aluno-card-mat">${a.matricula}</span>
        ${a.turma?.nome ? `<span class="aluno-card-turma" style="background:${ct.solid};color:#fff;border-color:transparent">${a.turma.nome}</span>` : ""}
      </div>
      <div class="aluno-card-actions">
        <button class="aluno-btn-edit aluno-card-btn" title="Editar">${SVG_EDIT} Editar</button>
        <button class="aluno-btn-qr aluno-card-btn aluno-card-btn-qr" data-id="${a.id}" title="QR Code">${SVG_QR} QR</button>
        <button class="aluno-btn-cracha aluno-card-btn aluno-card-btn-cracha" data-id="${a.id}" title="Crachá">${SVG_CRACHA} Crachá</button>
      </div>
    `;

    card.addEventListener("click", e => {
      if (e.target.closest(".aluno-card-actions")) return;
      abrirModalVisualizar(a);
    });
    card.querySelector(".aluno-btn-edit").addEventListener("click", () => abrirModalEditar(a));
    card.querySelector(".aluno-btn-qr").addEventListener("click", () => baixarQRAluno(a));
    card.querySelector(".aluno-btn-cracha").addEventListener("click", () => baixarCrachaAluno(a));
    alunosList.appendChild(card);
  });
}

// ─── Modal visualizar aluno ───────────────────────────────────────────────────
function abrirModalVisualizar(aluno) {
  document.getElementById("modal-visualizar-aluno")?.remove();

  const initials = aluno.nome.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
  const [bg, fg] = ALUNO_PALETTES[(aluno.nome.charCodeAt(0) || 0) % ALUNO_PALETTES.length];
  const ct = aluno.turma?.id ? corDaTurma(aluno.turma.id) : null;
  const heroC = ct ? ct.solid : fg;   // hero usa a cor da turma

  const fmtNasc = s => s ? new Date(s + "T00:00:00").toLocaleDateString("pt-BR") : null;

  const campos = [
    { lbl: "Matrícula",   val: aluno.matricula },
    { lbl: "Turma",       val: aluno.turma?.nome },
    { lbl: "Telefone",    val: aluno.telefone },
    { lbl: "Nascimento",  val: fmtNasc(aluno.data_nascimento) },
    { lbl: "ID Estadual", val: aluno.id_estadual },
    { lbl: "Endereço",    val: aluno.endereco },
  ].filter(c => c.val);

  const overlay = document.createElement("div");
  overlay.id = "modal-visualizar-aluno";
  overlay.className = "form-modal";

  overlay.innerHTML = `
    <div class="mv-card">
      <button class="mv-close" id="mv-close" title="Fechar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <div class="mv-hero" style="background:linear-gradient(150deg,${heroC} 0%,${heroC}cc 100%)">
        <div class="mv-avatar-ring">
          <div class="mv-avatar" style="background:${bg};color:${heroC}">
            ${aluno.foto_url
              ? `<img src="${aluno.foto_url}" alt="${initials}" />`
              : `<span>${initials}</span>`}
          </div>
        </div>
        <h2 class="mv-name">${aluno.nome}</h2>
        ${aluno.turma?.nome ? `<span class="mv-pill">${aluno.turma.nome}</span>` : ""}
        ${aluno.inst?.nome  ? `<span class="mv-inst">${aluno.inst.nome}</span>` : ""}
      </div>

      <div class="mv-body">
        ${campos.length ? `
          <div class="mv-grid">
            ${campos.map(c => `
              <div class="mv-item ${c.lbl === 'Endereço' ? 'mv-item-full' : ''}">
                <span class="mv-lbl">${c.lbl}</span>
                <span class="mv-val">${c.val}</span>
              </div>`).join("")}
          </div>` : `<p style="text-align:center;color:var(--text-3);font-size:.85rem">Nenhuma informação adicional.</p>`}
      </div>

      <div class="mv-footer">
        <button class="mv-btn mv-btn-edit" id="mv-btn-edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="mv-btn mv-btn-qr" id="mv-btn-qr">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
          QR Code
        </button>
        <button class="mv-btn mv-btn-cracha" id="mv-btn-cracha">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/><path d="M9 18h6"/></svg>
          Crachá
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  const fechar = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 360); };
  overlay.querySelector("#mv-close").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });

  overlay.querySelector("#mv-btn-edit").addEventListener("click", () => {
    fechar(); setTimeout(() => abrirModalEditar(aluno), 180);
  });
  overlay.querySelector("#mv-btn-qr").addEventListener("click", () => baixarQRAluno(aluno));
  overlay.querySelector("#mv-btn-cracha").addEventListener("click", () => baixarCrachaAluno(aluno));
}

// ─── Modal editar aluno ───────────────────────────────────────────────────────
function abrirModalEditar(aluno) {
  document.getElementById("modal-editar-aluno")?.remove();

  const nascVal = aluno.data_nascimento ?? "";
  const overlay = document.createElement("div");
  overlay.id = "modal-editar-aluno";
  overlay.className = "form-modal";

  overlay.innerHTML = `
    <div class="form-modal-card ed-card">
      <div class="ed-modal-header">
        <div class="ed-modal-hinfo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" style="opacity:.75">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <span>Editar Aluno</span>
        </div>
        <button class="ed-modal-close" id="ed-fechar" title="Fechar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="form-modal-body">
        <!-- Avatar + foto -->
        <div class="ed-avatar-row">
          <div class="ed-avatar-wrap">
            <div class="ed-avatar" id="ed-avatar-preview">
              ${aluno.foto_url
                ? `<img src="${aluno.foto_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`
                : `<span>${aluno.nome.split(" ").slice(0,2).map(n=>n[0]).join("").toUpperCase()}</span>`}
            </div>
            <button class="ed-foto-btn" id="ed-foto-btn" title="Trocar foto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
            <input type="file" id="ed-foto-input" accept="image/*" style="display:none" />
          </div>
          <div style="flex:1;min-width:0">
            <div class="fld">
              <label class="required">Nome completo</label>
              <input type="text" id="ed-nome" value="${aluno.nome}" autocomplete="off" />
              <span class="fld-err" id="ed-err-nome"></span>
            </div>
            <div class="fld" style="margin-top:10px">
              <label class="required">Matrícula</label>
              <input type="text" id="ed-matricula" value="${aluno.matricula}" autocomplete="off" />
              <span class="fld-err" id="ed-err-matricula"></span>
            </div>
          </div>
        </div>

        <!-- Linha: telefone + nascimento -->
        <div class="fld-row" style="margin-top:14px">
          <div class="fld fld-half">
            <label>Telefone</label>
            <input type="tel" id="ed-telefone" value="${aluno.telefone ?? ""}" />
          </div>
          <div class="fld fld-half">
            <label>Data de nascimento</label>
            <input type="date" id="ed-nascimento" value="${nascVal}" />
          </div>
        </div>

        <!-- ID Estadual -->
        <div class="fld" style="margin-top:10px">
          <label>ID Estadual / RG</label>
          <input type="text" id="ed-id-estadual" value="${aluno.id_estadual ?? ""}" />
        </div>

        <!-- Endereço -->
        <div class="fld" style="margin-top:10px">
          <label>Endereço</label>
          <input type="text" id="ed-endereco" value="${aluno.endereco ?? ""}" />
        </div>

        <!-- Turma -->
        <div class="fld" style="margin-top:10px">
          <label class="required">Turma</label>
          <select id="ed-turma"><option value="">Carregando turmas…</option></select>
          <span class="fld-err" id="ed-err-turma"></span>
        </div>

        <!-- Acesso do aluno (login) -->
        <div style="margin-top:16px;padding:13px 14px;border:1px solid var(--border);border-radius:11px;background:#f8fafc">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span style="font-size:.82rem;font-weight:800;color:#0f172a">Acesso do aluno</span>
            <span id="ed-acesso-status" style="margin-left:auto;font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:99px"></span>
          </div>
          <div style="font-size:.68rem;color:var(--text-3);line-height:1.5;margin-bottom:9px">
            E-mail e senha que o aluno usará para entrar no portal e ver faltas, horários e crachá.
          </div>
          <div class="fld">
            <label>E-mail</label>
            <input type="email" id="ed-aluno-email" autocomplete="off" placeholder="email@exemplo.com" />
          </div>
          <div class="fld" style="margin-top:8px">
            <label id="ed-senha-label">Senha</label>
            <input type="text" id="ed-aluno-senha" autocomplete="new-password" placeholder="Mínimo 6 caracteres" />
          </div>
          <button class="fmb-cancel" id="ed-salvar-acesso" style="margin-top:10px;color:#2563eb;border-color:#bfdbfe;width:100%;justify-content:center">
            Salvar acesso
          </button>
          <span id="ed-acesso-fb" style="font-size:.72rem;font-weight:600;min-height:14px;display:block;margin-top:6px"></span>
        </div>

        <div class="fld" style="margin-top:10px">
          <span id="ed-feedback" style="font-size:.78rem;color:var(--red);font-weight:600;min-height:16px;display:block"></span>
        </div>
      </div>

      <div class="form-modal-footer" style="justify-content:space-between">
        <div style="display:flex;gap:8px">
          <button class="fmb-cancel ed-btn-excluir" id="ed-excluir" style="color:var(--red);border-color:#fca5a5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Excluir
          </button>
          <button class="fmb-cancel" id="ed-transferir" style="color:#7c3aed;border-color:#c4b5fd">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            Transferir
          </button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="fmb-cancel" id="ed-cancelar">Cancelar</button>
          <button class="fmb-submit" id="ed-salvar">
            <span id="ed-btn-label">Salvar alterações</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  // Máscara no campo de telefone do modal de edição
  maskPhone(overlay.querySelector("#ed-telefone"));

  // ── foto ──
  let novaFotoBase64 = null;
  const edFotoInput  = overlay.querySelector("#ed-foto-input");
  overlay.querySelector("#ed-foto-btn").addEventListener("click", () => edFotoInput.click());
  edFotoInput.addEventListener("change", () => {
    const file = edFotoInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast("Foto muito grande (máx 2MB).", "error"); return; }
    const reader = new FileReader();
    reader.onload = e => {
      novaFotoBase64 = e.target.result;
      overlay.querySelector("#ed-avatar-preview").innerHTML =
        `<img src="${novaFotoBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`;
    };
    reader.readAsDataURL(file);
  });

  // ── fechar ──
  const fechar = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 360); };
  overlay.querySelector("#ed-fechar").addEventListener("click", fechar);
  overlay.querySelector("#ed-cancelar").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });

  // ── carregar turmas no select ──
  const edSelTurma = overlay.querySelector("#ed-turma");

  async function carregarTurmasEd() {
    const instId = _adminInstId || aluno.inst?.id;
    if (!instId) { edSelTurma.innerHTML = '<option value="">Sem instituição</option>'; return; }
    const { data } = await supabaseAdmin.from("turmas").select("id, nome")
      .eq("instituicao_id", instId).order("nome");
    edSelTurma.innerHTML = '<option value="">Selecione…</option>';
    (data ?? []).forEach(t => {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.nome;
      if (t.id === aluno.turma?.id) o.selected = true;
      edSelTurma.appendChild(o);
    });
  }

  carregarTurmasEd();

  // ── acesso do aluno (login) ──
  let _alunoUserId = aluno.user_id || null;
  const acStatus = overlay.querySelector("#ed-acesso-status");
  const acEmail  = overlay.querySelector("#ed-aluno-email");
  const acSenha  = overlay.querySelector("#ed-aluno-senha");
  const acLabel  = overlay.querySelector("#ed-senha-label");
  const acFb     = overlay.querySelector("#ed-acesso-fb");

  const pintarStatus = () => {
    if (_alunoUserId) {
      acStatus.textContent = "Ativo";
      acStatus.style.cssText = "margin-left:auto;font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:99px;background:#dcfce7;color:#15803d";
      acLabel.innerHTML = `Nova senha <span style="font-weight:400;color:var(--text-3)">(deixe em branco para manter)</span>`;
      acSenha.placeholder = "Deixe em branco para manter";
    } else {
      acStatus.textContent = "Não configurado";
      acStatus.style.cssText = "margin-left:auto;font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:99px;background:#f1f5f9;color:#64748b";
    }
  };
  pintarStatus();

  // Prefill do e-mail se já existe acesso
  if (_alunoUserId) {
    supabaseAdmin.from("profiles").select("email").eq("id", _alunoUserId).maybeSingle()
      .then(({ data }) => { if (data?.email) acEmail.value = data.email; });
  }

  overlay.querySelector("#ed-salvar-acesso").addEventListener("click", async () => {
    acFb.textContent = ""; acFb.style.color = "var(--red)";
    const email = acEmail.value.trim().toLowerCase();
    const senha = acSenha.value;
    const instId = _adminInstId || aluno.inst?.id || null;

    if (!email) { acFb.textContent = "Informe o e-mail do aluno."; return; }
    if (!_alunoUserId && senha.length < 6) { acFb.textContent = "Crie uma senha de ao menos 6 caracteres."; return; }
    if (senha && senha.length < 6)         { acFb.textContent = "A senha deve ter ao menos 6 caracteres."; return; }

    const btn = overlay.querySelector("#ed-salvar-acesso");
    btn.disabled = true; const txt = btn.textContent; btn.textContent = "Salvando…";

    try {
      if (_alunoUserId) {
        // Atualiza conta existente
        const updates = { email };
        if (senha) updates.password = senha;
        const { error } = await supabaseAdmin.auth.admin.updateUserById(_alunoUserId, updates);
        if (error) throw error;
        await supabaseAdmin.from("profiles").update({ email, nome: aluno.nome }).eq("id", _alunoUserId);
      } else {
        // Cria conta nova
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email, password: senha, email_confirm: true,
          user_metadata: { nome: aluno.nome, role: "aluno" },
        });
        if (error) throw error;
        _alunoUserId = data.user.id;
        await supabaseAdmin.from("profiles")
          .update({ nome: aluno.nome, email, role: "aluno", instituicao_id: instId }).eq("id", _alunoUserId);
        await supabaseAdmin.from("alunos").update({ user_id: _alunoUserId }).eq("id", aluno.id);
        aluno.user_id = _alunoUserId;
      }
      acSenha.value = "";
      pintarStatus();
      acFb.style.color = "#15803d";
      acFb.textContent = "Acesso salvo com sucesso!";
      showToast("Acesso do aluno salvo!", "success");
    } catch (e) {
      const msg = String(e.message || e);
      acFb.textContent = msg.includes("already been registered") || msg.includes("duplicate")
        ? "Este e-mail já está em uso por outra conta."
        : "Erro: " + msg;
    } finally {
      btn.disabled = false; btn.textContent = txt;
    }
  });

  // ── salvar ──
  overlay.querySelector("#ed-salvar").addEventListener("click", async () => {
    const errFb   = overlay.querySelector("#ed-feedback");
    const errNome = overlay.querySelector("#ed-err-nome");
    const errMat  = overlay.querySelector("#ed-err-matricula");
    const errTur  = overlay.querySelector("#ed-err-turma");
    errFb.textContent = errNome.textContent = errMat.textContent = errTur.textContent = "";

    const nome       = overlay.querySelector("#ed-nome").value.trim();
    const matricula  = overlay.querySelector("#ed-matricula").value.trim();
    const telefone   = overlay.querySelector("#ed-telefone").value.trim()    || null;
    const dataNasc   = overlay.querySelector("#ed-nascimento").value         || null;
    const idEstadual = overlay.querySelector("#ed-id-estadual").value.trim() || null;
    const endereco   = overlay.querySelector("#ed-endereco").value.trim()    || null;
    const instId     = _adminInstId || aluno.inst?.id || null;
    const turmaId    = edSelTurma.value || null;
    const fotoUrl    = novaFotoBase64 ?? aluno.foto_url ?? null;

    let ok = true;
    if (!nome)      { errNome.textContent = "Obrigatório."; ok = false; }
    if (!matricula) { errMat.textContent  = "Obrigatório."; ok = false; }
    if (!turmaId)   { errTur.textContent  = "Selecione.";   ok = false; }
    if (!ok) return;

    const btn = overlay.querySelector("#ed-salvar");
    btn.disabled = true;
    overlay.querySelector("#ed-btn-label").textContent = "Salvando...";

    const { error } = await supabaseAdmin.from("alunos").update({
      nome, matricula, telefone,
      data_nascimento: dataNasc,
      id_estadual:     idEstadual,
      endereco,
      foto_url:        fotoUrl,
      instituicao_id:  instId,
      turma_id:        turmaId,
    }).eq("id", aluno.id);

    btn.disabled = false;
    overlay.querySelector("#ed-btn-label").textContent = "Salvar alterações";

    if (error) {
      errFb.textContent = error.code === "23505" ? "Matrícula já existe." : error.message;
      return;
    }

    fechar();
    showToast("Aluno atualizado com sucesso!", "success");
    await carregarAlunos();
  });

  // ── excluir ──
  overlay.querySelector("#ed-excluir").addEventListener("click", () => {
    confirmarExcluirAluno(aluno, async () => {
      const { error } = await supabaseAdmin.from("alunos").delete().eq("id", aluno.id);
      if (error) { showToast("Erro ao excluir: " + error.message, "error"); return; }
      fechar();
      showToast(`"${aluno.nome}" excluído.`, "success");
      await carregarAlunos();
    });
  });

  // ── transferir turma ──
  overlay.querySelector("#ed-transferir").addEventListener("click", () => {
    const instId = _adminInstId || aluno.inst?.id;
    abrirModalTransferirAluno(aluno, instId, async (novaTurmaId) => {
      const { error } = await supabaseAdmin.from("alunos")
        .update({ turma_id: novaTurmaId }).eq("id", aluno.id);
      if (error) { showToast("Erro ao transferir: " + error.message, "error"); return; }
      fechar();
      showToast(`"${aluno.nome}" transferido com sucesso!`, "success");
      await carregarAlunos();
    });
  });
}

// ── Escaping helper local ─────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Modal de confirmação de exclusão ─────────────────────────────────────────
function confirmarExcluirAluno(aluno, onConfirm) {
  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed;inset:0;z-index:900;
    display:flex;align-items:center;justify-content:center;padding:20px;
    background:rgba(7,9,18,0.7);backdrop-filter:blur(6px);
    opacity:0;transition:opacity .2s;
  `;

  ov.innerHTML = `
    <div style="
      background:var(--surface);border:1px solid rgba(220,38,38,0.25);
      border-radius:18px;padding:32px 28px;max-width:380px;width:100%;
      box-shadow:0 24px 64px rgba(0,0,0,0.5),0 0 0 1px rgba(220,38,38,0.08);
      transform:scale(.94) translateY(12px);transition:transform .25s cubic-bezier(.22,1,.36,1);
      text-align:center;
    " id="del-card">

      <!-- Ícone -->
      <div style="
        width:56px;height:56px;border-radius:50%;margin:0 auto 20px;
        background:rgba(220,38,38,0.1);border:2px solid rgba(220,38,38,0.3);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 24px rgba(220,38,38,0.2);
      ">
        <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" width="24" height="24">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </div>

      <p style="font-size:.62rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.12em;margin-bottom:10px">
        Ação irreversível
      </p>
      <h3 style="font-size:1.1rem;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-bottom:8px">
        Excluir aluno?
      </h3>
      <p style="font-size:.84rem;color:var(--text-2);line-height:1.6;margin-bottom:6px">
        O aluno <strong style="color:var(--text)">${_esc(aluno.nome)}</strong> será removido permanentemente do sistema.
      </p>
      <p style="font-size:.76rem;color:var(--text-3);margin-bottom:28px">
        Esta ação não pode ser desfeita.
      </p>

      <div style="display:flex;gap:10px">
        <button id="del-cancel" style="
          flex:1;padding:11px;border:1px solid var(--border-2);border-radius:10px;
          background:var(--surface-2);color:var(--text-2);font-size:.84rem;font-weight:600;
          cursor:pointer;font-family:inherit;transition:all .13s;
        ">Cancelar</button>
        <button id="del-confirm" style="
          flex:1;padding:11px;border:none;border-radius:10px;
          background:var(--red);color:white;font-size:.84rem;font-weight:700;
          cursor:pointer;font-family:inherit;transition:all .13s;
          box-shadow:0 4px 14px rgba(220,38,38,0.35);
        ">Excluir permanentemente</button>
      </div>
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = "1";
    ov.querySelector("#del-card").style.transform = "scale(1) translateY(0)";
  });

  const fecharDel = () => {
    ov.style.opacity = "0";
    ov.querySelector("#del-card").style.transform = "scale(.94) translateY(12px)";
    setTimeout(() => ov.remove(), 360);
  };

  ov.querySelector("#del-cancel").addEventListener("click", fecharDel);
  ov.addEventListener("click", e => { if (e.target === ov) fecharDel(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fecharDel(); document.removeEventListener("keydown", onEsc); }
  });

  ov.querySelector("#del-cancel").addEventListener("mouseenter", function() { this.style.background = "var(--surface-3)"; this.style.color = "var(--text)"; });
  ov.querySelector("#del-cancel").addEventListener("mouseleave", function() { this.style.background = "var(--surface-2)"; this.style.color = "var(--text-2)"; });
  ov.querySelector("#del-confirm").addEventListener("mouseenter", function() { this.style.background = "var(--red-2)"; this.style.transform = "translateY(-1px)"; });
  ov.querySelector("#del-confirm").addEventListener("mouseleave", function() { this.style.background = "var(--red)"; this.style.transform = ""; });

  ov.querySelector("#del-confirm").addEventListener("click", async () => {
    const btn = ov.querySelector("#del-confirm");
    btn.disabled = true; btn.textContent = "Excluindo…";
    await onConfirm();
    fecharDel();
  });
}

// ── Modal de transferência de turma ──────────────────────────────────────────
async function abrirModalTransferirAluno(aluno, instId, onConfirm) {
  const { data: turmas } = await supabaseAdmin
    .from("turmas").select("id, nome")
    .eq("instituicao_id", instId).order("nome");

  const opcoes = (turmas ?? []).filter(t => t.id !== aluno.turma?.id);

  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed;inset:0;z-index:900;
    display:flex;align-items:center;justify-content:center;padding:20px;
    background:rgba(7,9,18,0.7);backdrop-filter:blur(6px);
    opacity:0;transition:opacity .2s;
  `;

  ov.innerHTML = `
    <div style="
      background:var(--surface);border:1px solid rgba(124,58,237,0.25);
      border-radius:18px;padding:32px 28px;max-width:400px;width:100%;
      box-shadow:0 24px 64px rgba(0,0,0,0.5),0 0 0 1px rgba(124,58,237,0.08);
      transform:scale(.94) translateY(12px);transition:transform .25s cubic-bezier(.22,1,.36,1);
    " id="tr-card">

      <!-- Ícone -->
      <div style="
        width:52px;height:52px;border-radius:14px;margin-bottom:20px;
        background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 20px rgba(124,58,237,0.15);
      ">
        <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" width="22" height="22">
          <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </div>

      <h3 style="font-size:1.05rem;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-bottom:5px">
        Transferir aluno
      </h3>
      <p style="font-size:.82rem;color:var(--text-2);margin-bottom:20px">
        <strong style="color:var(--text)">${_esc(aluno.nome)}</strong> —
        turma atual: <em style="color:var(--text-3)">${_esc(aluno.turma?.nome || "Sem turma")}</em>
      </p>

      <label style="font-size:.65rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:7px">
        Nova turma
      </label>
      <select id="tr-select" style="
        width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;
        background:var(--surface-2);color:var(--text);font-size:.88rem;font-family:inherit;
        font-weight:500;outline:none;margin-bottom:24px;cursor:pointer;
        transition:border-color .15s,box-shadow .15s;
      ">
        <option value="">Selecione uma turma…</option>
        ${opcoes.map(t => `<option value="${_esc(t.id)}">${_esc(t.nome)}</option>`).join("")}
        ${opcoes.length === 0 ? `<option disabled>Nenhuma outra turma disponível</option>` : ""}
      </select>
      <span id="tr-err" style="display:block;font-size:.76rem;color:var(--red);font-weight:600;min-height:16px;margin-top:-18px;margin-bottom:16px"></span>

      <div style="display:flex;gap:10px">
        <button id="tr-cancel" style="
          flex:1;padding:11px;border:1px solid var(--border-2);border-radius:10px;
          background:var(--surface-2);color:var(--text-2);font-size:.84rem;font-weight:600;
          cursor:pointer;font-family:inherit;transition:all .13s;
        ">Cancelar</button>
        <button id="tr-confirm" style="
          flex:1;padding:11px;border:none;border-radius:10px;
          background:#7c3aed;color:white;font-size:.84rem;font-weight:700;
          cursor:pointer;font-family:inherit;transition:all .13s;
          box-shadow:0 4px 14px rgba(124,58,237,0.35);
        ">Confirmar transferência</button>
      </div>
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = "1";
    ov.querySelector("#tr-card").style.transform = "scale(1) translateY(0)";
  });

  const fecharTr = () => {
    ov.style.opacity = "0";
    ov.querySelector("#tr-card").style.transform = "scale(.94) translateY(12px)";
    setTimeout(() => ov.remove(), 360);
  };

  ov.querySelector("#tr-cancel").addEventListener("click", fecharTr);
  ov.addEventListener("click", e => { if (e.target === ov) fecharTr(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fecharTr(); document.removeEventListener("keydown", onEsc); }
  });

  const sel = ov.querySelector("#tr-select");
  sel.addEventListener("focus", () => { sel.style.borderColor = "var(--acc)"; sel.style.boxShadow = "0 0 0 3px var(--acc-sub)"; });
  sel.addEventListener("blur",  () => { sel.style.borderColor = "var(--border)"; sel.style.boxShadow = ""; });

  ov.querySelector("#tr-confirm").addEventListener("click", async () => {
    const err = ov.querySelector("#tr-err");
    const novaTurmaId = sel.value;
    if (!novaTurmaId) { err.textContent = "Selecione uma turma de destino."; return; }
    err.textContent = "";
    const btn = ov.querySelector("#tr-confirm");
    btn.disabled = true; btn.textContent = "Transferindo…";
    await onConfirm(novaTurmaId);
    fecharTr();
  });
}

// ─── Filtro: instituição → carrega turmas correspondentes ─────────────────────
filterInst.addEventListener("change", async () => {
  const instId = filterInst.value;
  filterTurma.innerHTML = '<option value="">Todas as turmas</option>';
  filterTurma.disabled  = !instId;

  if (instId) {
    const { data } = await supabase
      .from("turmas").select("id, nome")
      .eq("instituicao_id", instId).order("nome");

    (data ?? []).forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id; opt.textContent = t.nome;
      filterTurma.appendChild(opt);
    });
  }

  aplicarFiltros();
});

filterTurma.addEventListener("change", aplicarFiltros);
filterBusca.addEventListener("input",  aplicarFiltros);

// ─── Gerar imagem de QR Code (cartão com nome e matrícula) ────────────────────
async function gerarQRCard(aluno) {
  const W = 380;
  const H = 460;
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Fundo
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Cabeçalho azul
  ctx.fillStyle = "#2b6cb0";
  ctx.fillRect(0, 0, W, 54);

  // Texto do cabeçalho
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Chamada QR", W / 2, 33);

  // QR Code (280x280)
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, aluno.matricula, {
    width: 280,
    margin: 1,
    color: { dark: "#1a202c", light: "#ffffff" },
  });
  ctx.drawImage(qrCanvas, (W - 280) / 2, 66);

  // Linha divisória
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(32, 362);
  ctx.lineTo(W - 32, 362);
  ctx.stroke();

  // Nome do aluno
  ctx.fillStyle  = "#1a202c";
  ctx.font       = "bold 17px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign  = "center";
  const nomeDisplay = aluno.nome.length > 32 ? aluno.nome.substring(0, 30) + "..." : aluno.nome;
  ctx.fillText(nomeDisplay, W / 2, 392);

  // Matrícula
  ctx.fillStyle = "#718096";
  ctx.font      = "13px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`Matrícula: ${aluno.matricula}`, W / 2, 414);

  // Turma / Instituição
  const extra = [aluno.inst?.nome, aluno.turma?.nome].filter(Boolean).join(" · ");
  if (extra) {
    ctx.fillStyle = "#a0aec0";
    ctx.font      = "12px 'Segoe UI', Arial, sans-serif";
    const extraDisplay = extra.length > 46 ? extra.substring(0, 43) + "..." : extra;
    ctx.fillText(extraDisplay, W / 2, 434);
  }

  // Borda externa arredondada (simulada via retângulo)
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), "image/png"));
}

// ─── Download QR individual ───────────────────────────────────────────────────
// ─── Baixar crachá individual ─────────────────────────────────────────────────
async function baixarQRAluno(aluno) {
  const btn = alunosList.querySelector(`.aluno-btn-qr[data-id="${aluno.id}"]`);
  if (btn) { btn.style.opacity = "0.5"; btn.disabled = true; }
  try {
    const blob = await gerarQRCard(aluno);
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const nomeSafe = aluno.nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
    link.href = url;
    link.download = `QR_${nomeSafe}.png`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast("Erro ao gerar QR Code.", "error");
  } finally {
    if (btn) { btn.style.opacity = ""; btn.disabled = false; }
  }
}

async function baixarCrachaAluno(aluno) {
  const btn = alunosList.querySelector(`.aluno-btn-cracha[data-id="${aluno.id}"]`);
  if (btn) { btn.style.opacity = "0.5"; btn.disabled = true; }

  try {
    const { data: inst } = await supabaseAdmin
      .from("instituicoes").select("nome").eq("id", aluno.inst?.id || _adminInstId).maybeSingle();
    const instNome = inst?.nome || "";
    const dataUrl  = await gerarCracha(aluno, _crachaConfig, instNome);
    downloadCracha(dataUrl, aluno.nome);
  } catch (err) {
    showToast("Erro ao gerar crachá.", "error");
  } finally {
    if (btn) { btn.style.opacity = ""; btn.disabled = false; }
  }
}

// ─── Download todos os crachás como ZIP ───────────────────────────────────────
btnDlAll.addEventListener("click", async () => {
  if (!alunosFiltrados.length) return;

  btnDlAll.disabled  = true;
  btnDlAll.classList.add("loading");
  btnDlAll.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"
      style="animation: spin 1s linear infinite">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/>
    </svg>
    Gerando ZIP...
  `;

  try {
    const { data: inst } = await supabaseAdmin
      .from("instituicoes").select("nome").eq("id", _adminInstId).maybeSingle();
    const instNome = inst?.nome || "";

    const zip = new JSZip();
    for (const aluno of alunosFiltrados) {
      const dataUrl  = await gerarCracha(aluno, _crachaConfig, instNome);
      const base64   = dataUrl.split(",")[1];
      const nomeSafe = aluno.nome.normalize("NFD").replace(/[̀-ͯ]/g,"")
        .replace(/[^a-zA-Z0-9 ]/g,"").trim().replace(/\s+/g,"_");
      zip.file(`Cracha_${nomeSafe}.png`, base64, { base64: true });
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href     = url;
    link.download = "Crachas_Alunos.zip";
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${alunosFiltrados.length} crachás baixados!`, "success");
  } catch (err) {
    showToast("Erro ao gerar ZIP: " + err.message, "error");
  } finally {
    btnDlAll.disabled = false;
    btnDlAll.classList.remove("loading");
    btnDlAll.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15">
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        <circle cx="12" cy="14" r="2"/><path d="M9 18h6"/>
      </svg>
      Baixar todos os crachás
    `;
  }
});

// ─── Download bulk QR Codes ───────────────────────────────────────────────────
btnDlAllQr?.addEventListener("click", async () => {
  if (!alunosFiltrados.length) return;
  btnDlAllQr.disabled = true;
  const orig = btnDlAllQr.innerHTML;
  btnDlAllQr.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Gerando...`;
  try {
    const zip = new JSZip();
    for (const aluno of alunosFiltrados) {
      const blob = await gerarQRCard(aluno);
      const nomeSafe = aluno.nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
      zip.file(`QR_${nomeSafe}.png`, blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url; link.download = "QRCodes_Alunos.zip";
    link.click(); URL.revokeObjectURL(url);
    showToast(`${alunosFiltrados.length} QR Codes baixados!`, "success");
  } catch (err) {
    showToast("Erro ao gerar ZIP: " + err.message, "error");
  } finally {
    btnDlAllQr.disabled = false;
    btnDlAllQr.innerHTML = orig;
  }
});

// ─── Helpers de formulário ────────────────────────────────────────────────────
function fieldError(id, msg) {
  const el    = document.getElementById(`err-${id}`);
  const input = document.getElementById(id);
  if (el)    el.textContent = msg;
  if (input) input.classList.toggle("error", !!msg);
}

function clearErrors() {
  ["nome", "matricula", "data_nascimento", "id_estadual", "turma"].forEach(id => fieldError(id, ""));
  ["nome", "matricula", "telefone", "data_nascimento", "id_estadual", "endereco", "foto_url", "turma"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove("error"); });
}

function setLoading(on) {
  btnSubmit.disabled = on;
  btnSubmit.classList.toggle("loading", on);
  document.getElementById("btn-label").textContent = on ? "Cadastrando..." : "Cadastrar Aluno";
}

function setFeedback(msg, type) {
  feedback.textContent = msg;
  feedback.className   = `form-feedback ${type}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
let _adminInstId = null;

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

  if (!profile)                       { window.location.href = "/login.html"; return; }
  if (profile.role === "admin")       { window.location.href = "/dashboard.html"; return; }
  if (profile.role === "professor")   { window.location.href = "/chamada.html"; return; }

  // instituicao: escopo limitado à sua instituição
  if (profile.role === "instituicao" && profile.instituicao_id) {
    _adminInstId = profile.instituicao_id;

    // Esconde filtro de instituição (desnecessário — já estão no escopo certo)
    const filterInstGroup = filterInst.closest(".filter-group");
    if (filterInstGroup) filterInstGroup.style.display = "none";
    const dividerAposInst = filterInstGroup?.nextElementSibling;
    if (dividerAposInst?.classList.contains("filter-divider")) dividerAposInst.style.display = "none";

    // Carrega turmas do filtro direto
    await carregarFiltroTurmasDaInst(_adminInstId);
  }

  iniciarModalGerenciar();
  if (_adminInstId) carregarTurmas(_adminInstId);
  if (!_adminInstId) carregarFiltroInstituicoes();

  if (_adminInstId) {
    // Paralelo: turmas do filtro + config do crachá (não dependem uma da outra)
    const [, cfg] = await Promise.all([
      carregarFiltroTurmasDaInst(_adminInstId),
      buscarCrachaConfig(supabaseAdmin, _adminInstId),
    ]);
    _crachaConfig = cfg;
  } else {
    carregarFiltroInstituicoes();
  }
  carregarAlunos();
})();
