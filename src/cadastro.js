import { supabase } from "./supabase.js";
import { podeAdmin } from "./nav-role.js";
import { abrirModalGerenciar, iniciarModalGerenciar } from "./gerenciar.js";
import QRCode from "qrcode";
import JSZip from "jszip";

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

// ─── Carregar turmas (form) ───────────────────────────────────────────────────
async function carregarTurmas(instId, selecionarId = null) {
  selTurma.innerHTML = '<option value="">Carregando turmas…</option>';

  const { data, error } = await supabase
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
  if (!nome)      { fieldError("nome",      "Nome é obrigatório.");      hasError = true; }
  if (!matricula) { fieldError("matricula", "Matrícula é obrigatória."); hasError = true; }
  if (!turmaId)   { fieldError("turma",     "Selecione uma turma.");     hasError = true; }
  if (hasError) return;

  setLoading(true);

  const { error } = await supabase.from("alunos").insert({
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
  alunosList.innerHTML = `<div class="list-empty"><p>Carregando...</p></div>`;

  let alunosQuery = supabase
    .from("alunos")
    .select(`
      id, nome, matricula, foto_url, telefone, data_nascimento, id_estadual, endereco,
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
  const { data } = await supabase.from("turmas").select("id, nome").eq("instituicao_id", instId).order("nome");
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

function renderAlunos() {
  countBadge.textContent = alunosFiltrados.length;
  btnDlAll.disabled      = alunosFiltrados.length === 0;

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

  alunosList.className = "alunos-list alunos-container";
  alunosList.innerHTML = "";

  const SVG_TEL  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const SVG_CAL  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const SVG_DOC  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const SVG_PIN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const SVG_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const SVG_DL   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  alunosFiltrados.forEach((a, i) => {
    const initials = a.nome.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
    const nasc = a.data_nascimento
      ? new Date(a.data_nascimento + "T12:00:00").toLocaleDateString("pt-BR")
      : null;

    const tags = [
      a.telefone    ? `<span class="aluno-tag">${SVG_TEL}${a.telefone}</span>` : "",
      nasc          ? `<span class="aluno-tag">${SVG_CAL}${nasc}</span>` : "",
      a.id_estadual ? `<span class="aluno-tag">${SVG_DOC}${a.id_estadual}</span>` : "",
      a.endereco    ? `<span class="aluno-tag">${SVG_PIN}${a.endereco}</span>` : "",
    ].filter(Boolean).join("");

    const row = document.createElement("div");
    row.className = "aluno-row";
    row.style.animationDelay = `${i * 0.04}s`;

    row.innerHTML = `
      <div class="aluno-avatar">
        ${a.foto_url ? `<img src="${a.foto_url}" alt="${initials}" />` : initials}
      </div>
      <div class="aluno-info">
        <div class="aluno-name-line">
          <span class="aluno-name">${a.nome}</span>
          <span class="aluno-mat">${a.matricula}</span>
        </div>
        ${tags ? `<div class="aluno-tags">${tags}</div>` : ""}
      </div>
      <div class="aluno-actions">
        ${a.turma?.nome ? `<span class="aluno-badge-turma">${a.turma.nome}</span>` : ""}
        <button class="aluno-btn-edit" title="Editar">${SVG_EDIT}</button>
        <button class="aluno-btn-qr" data-id="${a.id}">${SVG_DL} QR</button>
      </div>
    `;

    row.querySelector(".aluno-btn-edit").addEventListener("click", () => abrirModalEditar(a));
    row.querySelector(".aluno-btn-qr").addEventListener("click", () => baixarQR(a));
    alunosList.appendChild(row);
  });
}

// ─── Modal editar aluno ───────────────────────────────────────────────────────
function abrirModalEditar(aluno) {
  document.getElementById("modal-editar-aluno")?.remove();

  const nascVal = aluno.data_nascimento ?? "";
  const overlay = document.createElement("div");
  overlay.id = "modal-editar-aluno";
  overlay.className = "form-modal open";

  overlay.innerHTML = `
    <div class="form-modal-card" style="max-width:560px;max-height:92vh;overflow-y:auto">
      <div class="form-modal-header">
        <div class="form-modal-title">
          <div class="form-modal-icon blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <h3>Editar Aluno</h3>
        </div>
        <button class="form-modal-close" id="ed-fechar">✕</button>
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

        <div class="fld" style="margin-top:10px">
          <span id="ed-feedback" style="font-size:.78rem;color:var(--red);font-weight:600;min-height:16px;display:block"></span>
        </div>
      </div>

      <div class="form-modal-footer" style="justify-content:space-between">
        <button class="fmb-cancel ed-btn-excluir" id="ed-excluir" style="color:var(--red);border-color:#fca5a5">
          Excluir aluno
        </button>
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
  const fechar = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
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
    const { data } = await supabase.from("turmas").select("id, nome")
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

    const { error } = await supabase.from("alunos").update({
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
  overlay.querySelector("#ed-excluir").addEventListener("click", async () => {
    if (!confirm(`Excluir "${aluno.nome}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("alunos").delete().eq("id", aluno.id);
    if (error) { showToast("Erro ao excluir: " + error.message, "error"); return; }
    fechar();
    showToast(`"${aluno.nome}" excluído.`, "success");
    await carregarAlunos();
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
async function baixarQR(aluno) {
  const btn = alunosList.querySelector(`[data-id="${aluno.id}"]`);
  if (btn) btn.style.opacity = "0.5";

  try {
    const blob = await gerarQRCard(aluno);
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const nomeSafe = aluno.nome.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
    link.href     = url;
    link.download = `QR_${nomeSafe}_${aluno.matricula}.png`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast("Erro ao gerar QR Code.", "error");
  } finally {
    if (btn) btn.style.opacity = "";
  }
}

// ─── Download todos os QR Codes como ZIP ──────────────────────────────────────
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
    const zip = new JSZip();

    for (const aluno of alunosFiltrados) {
      const blob     = await gerarQRCard(aluno);
      const nomeSafe = aluno.nome.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
      zip.file(`QR_${nomeSafe}_${aluno.matricula}.png`, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url  = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href     = url;
    link.download = "QRCodes_Alunos.zip";
    link.click();
    URL.revokeObjectURL(url);

    showToast(`${alunosFiltrados.length} QR Codes baixados com sucesso!`, "success");
  } catch (err) {
    showToast("Erro ao gerar ZIP: " + err.message, "error");
  } finally {
    btnDlAll.disabled = false;
    btnDlAll.classList.remove("loading");
    btnDlAll.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Baixar todos os QR Codes
    `;
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
  ["nome", "matricula", "turma"].forEach(id => fieldError(id, ""));
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
  carregarAlunos();
})();
