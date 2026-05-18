import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

const root = document.getElementById("page-root");
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

let _instId = null;
let _professores = [];

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }
  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

  if (!profile || profile.role !== "instituicao") {
    window.location.href = "/inst-dashboard.html"; return;
  }

  _instId = profile.instituicao_id;

  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, nome, email")
    .eq("instituicao_id", _instId)
    .eq("role", "professor")
    .order("nome");

  _professores = profs ?? [];

  await renderPage();
}

// ── Render principal ──────────────────────────────────────────────────────────
async function renderPage() {
  root.innerHTML = `
    <div class="mat-topbar">
      <div>
        <div class="mat-eyebrow">Configuração</div>
        <div class="mat-title">Matérias</div>
      </div>
      <button class="mat-btn-nova" id="btn-nova-mat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova matéria
      </button>
    </div>
    <div id="mat-list" class="mat-list"></div>
  `;

  document.getElementById("btn-nova-mat").addEventListener("click", abrirModalNova);
  await renderMaterias();
}

// ── Modal nova matéria ────────────────────────────────────────────────────────
function abrirModalNova() {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov";
  ov.innerHTML = `
    <div class="mat-modal">
      <div class="mat-modal-head">
        <div class="mat-modal-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <div>
          <div class="mat-modal-title">Nova matéria</div>
          <div class="mat-modal-sub">Digite o nome da disciplina</div>
        </div>
        <button class="mat-modal-x" id="modal-x">✕</button>
      </div>
      <div class="mat-modal-body">
        <label class="mat-label">Nome</label>
        <input id="modal-input" class="mat-input" type="text" placeholder="Ex: Matemática, Português, Ciências…" maxlength="80" autofocus />
        <div id="modal-err" class="mat-modal-err"></div>
      </div>
      <div class="mat-modal-foot">
        <button class="mat-btn-ghost" id="modal-cancel">Cancelar</button>
        <button class="mat-btn-criar" id="modal-criar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar matéria
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => {
    ov.classList.remove("open");
    setTimeout(() => ov.remove(), 200);
  };

  ov.querySelector("#modal-x").addEventListener("click", fechar);
  ov.querySelector("#modal-cancel").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  const input = ov.querySelector("#modal-input");
  const err   = ov.querySelector("#modal-err");
  const btn   = ov.querySelector("#modal-criar");

  const criar = async () => {
    const nome = input.value.trim();
    err.textContent = "";
    if (!nome) { err.textContent = "Digite o nome da matéria."; return; }

    btn.disabled = true; btn.textContent = "Criando…";

    const { error } = await supabaseAdmin
      .from("materias").insert({ nome, instituicao_id: _instId });

    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Criar matéria`;

    if (error) {
      err.textContent = error.code === "23505" ? "Já existe uma matéria com esse nome." : "Erro: " + error.message;
      return;
    }

    fechar();
    showToast(`"${nome}" criada!`, "success");
    await renderMaterias();
  };

  btn.addEventListener("click", criar);
  input.addEventListener("keydown", e => { if (e.key === "Enter") criar(); });
  setTimeout(() => input.focus(), 80);
}

// ── Lista de matérias ─────────────────────────────────────────────────────────
async function renderMaterias() {
  const lista = document.getElementById("mat-list");
  if (!lista) return;

  const { data: materias } = await supabaseAdmin
    .from("materias").select("id, nome").eq("instituicao_id", _instId).order("nome");

  if (!materias?.length) {
    lista.innerHTML = `
      <div class="mat-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <p>Nenhuma matéria cadastrada ainda.<br>Clique em <strong>Nova matéria</strong> para começar.</p>
      </div>`;
    return;
  }

  const matIds = materias.map(m => m.id);
  const { data: vinculos } = await supabaseAdmin
    .from("professor_materias")
    .select("materia_id, professor_id, profiles(id, nome, email)")
    .in("materia_id", matIds);

  const vinculosPorMateria = {};
  (vinculos ?? []).forEach(v => { (vinculosPorMateria[v.materia_id] ??= []).push(v); });

  lista.innerHTML = "";

  materias.forEach((mat, idx) => {
    const profs       = vinculosPorMateria[mat.id] ?? [];
    const vinculadosIds = new Set(profs.map(v => v.professor_id));
    const disponiveis   = _professores.filter(p => !vinculadosIds.has(p.id));

    const card = document.createElement("div");
    card.className = "mat-card";
    card.style.animationDelay = `${idx * .04}s`;
    card.dataset.id = mat.id;

    const profChips = profs.length
      ? profs.map(v => {
          const p   = v.profiles;
          const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
          return `<span class="mat-chip-prof" title="${esc(p?.nome || p?.email || "")}">${esc(ini)}</span>`;
        }).join("")
      : `<span class="mat-chip-none">Sem professores</span>`;

    card.innerHTML = `
      <div class="mat-card-head">
        <div class="mat-icon">${esc(mat.nome[0].toUpperCase())}</div>
        <div class="mat-card-info">
          <div class="mat-nome">${esc(mat.nome)}</div>
          <div class="mat-chips">${profChips}</div>
        </div>
        <div class="mat-card-actions">
          <span class="mat-profs-count">${profs.length} prof${profs.length !== 1 ? "s" : ""}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" style="color:var(--text-3)"><polyline points="9 18 15 12 9 6"/></svg>
          <button class="mat-btn-del" title="Excluir matéria">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    `;

    card.querySelector(".mat-card-head").addEventListener("click", e => {
      if (e.target.closest(".mat-btn-del")) return;
      abrirModalMateria(mat, profs, disponiveis);
    });

    card.querySelector(".mat-btn-del").addEventListener("click", () => confirmarExcluir(mat.id, mat.nome));

    lista.appendChild(card);
  });
}

// ── Modal de gerenciamento da matéria ─────────────────────────────────────────
function abrirModalMateria(mat, profsIniciais, disponiveisIniciais) {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov";
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => { ov.classList.remove("open"); setTimeout(() => ov.remove(), 200); };

  const renderConteudo = (profs, disponiveis) => {
    const profRows = profs.length === 0
      ? `<div class="mat-prof-vazio">Nenhum professor vinculado ainda.</div>`
      : profs.map(v => {
          const p   = v.profiles;
          const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
          return `
            <div class="mat-prof-row">
              <div class="mat-prof-avatar">${esc(ini)}</div>
              <div class="mat-prof-nome">${esc(p?.nome || p?.email || "—")}</div>
              <button class="mat-prof-del" data-unlink-pm="${v.materia_id}" data-unlink-prof="${v.professor_id}" title="Desvincular">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>`;
        }).join("");

    const addRow = disponiveis.length > 0 ? `
      <div class="mat-add-prof" style="margin-top:12px">
        <select id="modal-sel-prof" class="mat-sel-prof">
          <option value="">Selecione o professor…</option>
          ${disponiveis.map(p => `<option value="${p.id}">${esc(p.nome || p.email)}</option>`).join("")}
        </select>
        <button class="mat-btn-vincular" id="modal-btn-vincular">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Vincular
        </button>
      </div>` : `<div class="mat-all-linked" style="margin-top:10px">Todos os professores já vinculados.</div>`;

    ov.innerHTML = `
      <div class="mat-modal">
        <div class="mat-modal-head">
          <div class="mat-modal-icon">${esc(mat.nome[0].toUpperCase())}</div>
          <div>
            <div class="mat-modal-title">${esc(mat.nome)}</div>
            <div class="mat-modal-sub">Professores vinculados</div>
          </div>
          <button class="mat-modal-x" id="mgr-x">✕</button>
        </div>
        <div class="mat-modal-body" style="gap:0">
          <div class="mat-profs-title">Professores</div>
          <div class="mat-prof-list">${profRows}</div>
          ${addRow}
        </div>
        <div class="mat-modal-foot" style="justify-content:flex-start">
          <button class="mat-btn-ghost" id="mgr-fechar">Fechar</button>
        </div>
      </div>`;

    ov.querySelector("#mgr-x").addEventListener("click", fechar);
    ov.querySelector("#mgr-fechar").addEventListener("click", fechar);
    ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

    ov.querySelectorAll("[data-unlink-pm]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await desvincularProfessor(btn.dataset.unlinkPm, btn.dataset.unlinkProf);
        // Re-fetch e re-renderiza modal
        const { data: vinculos } = await supabaseAdmin
          .from("professor_materias").select("materia_id, professor_id, profiles(id, nome, email)")
          .eq("materia_id", mat.id);
        const novosProfs = vinculos ?? [];
        const vinculadosIds = new Set(novosProfs.map(v => v.professor_id));
        const novosDisp = _professores.filter(p => !vinculadosIds.has(p.id));
        renderConteudo(novosProfs, novosDisp);
      });
    });

    const btnVin = ov.querySelector("#modal-btn-vincular");
    if (btnVin) {
      btnVin.addEventListener("click", async () => {
        const sel = ov.querySelector("#modal-sel-prof");
        const profId = sel?.value;
        if (!profId) { showToast("Selecione um professor.", "error"); return; }
        await vincularProfessor(mat.id, profId);
        const { data: vinculos } = await supabaseAdmin
          .from("professor_materias").select("materia_id, professor_id, profiles(id, nome, email)")
          .eq("materia_id", mat.id);
        const novosProfs = vinculos ?? [];
        const vinculadosIds = new Set(novosProfs.map(v => v.professor_id));
        const novosDisp = _professores.filter(p => !vinculadosIds.has(p.id));
        renderConteudo(novosProfs, novosDisp);
      });
    }
  };

  renderConteudo(profsIniciais, disponiveisIniciais);
}

// ── Confirmar exclusão (modal inline) ────────────────────────────────────────
function confirmarExcluir(id, nome) {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov";
  ov.innerHTML = `
    <div class="mat-modal" style="max-width:400px">
      <div class="mat-modal-head">
        <div class="mat-modal-icon" style="background:#fef2f2;color:#dc2626">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </div>
        <div>
          <div class="mat-modal-title">Excluir matéria</div>
          <div class="mat-modal-sub">Esta ação não pode ser desfeita</div>
        </div>
        <button class="mat-modal-x" id="del-x">✕</button>
      </div>
      <div class="mat-modal-body">
        <p style="font-size:.875rem;color:var(--text-2);line-height:1.6">
          Tem certeza que deseja excluir <strong>${esc(nome)}</strong>?<br>
          Os vínculos com professores e entradas na grade de horários também serão removidos.
        </p>
      </div>
      <div class="mat-modal-foot">
        <button class="mat-btn-ghost" id="del-cancel">Cancelar</button>
        <button class="mat-btn-del-confirm" id="del-confirm">Excluir</button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => { ov.classList.remove("open"); setTimeout(() => ov.remove(), 200); };
  ov.querySelector("#del-x").addEventListener("click", fechar);
  ov.querySelector("#del-cancel").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  ov.querySelector("#del-confirm").addEventListener("click", async () => {
    const btn = ov.querySelector("#del-confirm");
    btn.disabled = true; btn.textContent = "Excluindo…";
    await excluirMateria(id, nome);
    fechar();
  });
}

async function excluirMateria(id, nome) {
  // Cascade manual: remove vínculos e horários antes
  await supabaseAdmin.from("professor_materias").delete().eq("materia_id", id);
  await supabaseAdmin.from("horarios").delete().eq("materia_id", id);
  const { error } = await supabaseAdmin.from("materias").delete().eq("id", id);

  if (error) { showToast("Erro: " + error.message, "error"); return; }
  showToast(`"${nome}" excluída.`, "success");
  await renderMaterias();
}

// ── Vincular professor ────────────────────────────────────────────────────────
async function vincularProfessor(materiaId, profId) {
  if (!profId) { showToast("Selecione um professor.", "error"); return; }

  const { error } = await supabaseAdmin
    .from("professor_materias").insert({ professor_id: profId, materia_id: materiaId });

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor vinculado!", "success");
  await renderMaterias();
}

// ── Desvincular professor ─────────────────────────────────────────────────────
async function desvincularProfessor(materiaId, profId) {
  const { error } = await supabaseAdmin
    .from("professor_materias").delete().eq("materia_id", materiaId).eq("professor_id", profId);

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor desvinculado.", "success");
  await renderMaterias();
}

init();
