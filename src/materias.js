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
    .from("materias").select("id, nome, aulas_semestre, limite_faltas").eq("instituicao_id", _instId).order("nome");

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
    const profs = vinculosPorMateria[mat.id] ?? [];

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
      <div class="mat-card-top">
        <div class="mat-icon">${esc(mat.nome[0].toUpperCase())}</div>
        <button class="mat-btn-del" title="Excluir matéria">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
      <div class="mat-nome">${esc(mat.nome)}</div>
      <div class="mat-chips">${profChips}</div>
      <div class="mat-card-footer">
        <span class="mat-profs-count">${profs.length} prof${profs.length !== 1 ? "s" : ""}</span>
        <span class="mat-faltas-badge" title="Aulas e limite de faltas no semestre">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${mat.limite_faltas != null
            ? `${mat.limite_faltas} falta${mat.limite_faltas !== 1 ? "s" : ""}${mat.aulas_semestre != null ? ` / ${mat.aulas_semestre} aulas` : ""}`
            : (mat.aulas_semestre != null ? `${mat.aulas_semestre} aulas` : "sem limite")}
        </span>
      </div>
    `;

    card.addEventListener("click", e => {
      if (e.target.closest(".mat-btn-del")) return;
      abrirModalMateria(mat, profs);
    });

    card.querySelector(".mat-btn-del").addEventListener("click", () => confirmarExcluir(mat.id, mat.nome));

    lista.appendChild(card);
  });
}

// ── Modal da matéria: ver profs (read-only) + editar nome ─────────────────────
function abrirModalMateria(mat, profs) {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov";
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => { ov.classList.remove("open"); setTimeout(() => ov.remove(), 200); };

  const profRows = profs.length === 0
    ? `<div class="mat-prof-vazio">Nenhum professor vinculado. Gerencie em <strong>Professores</strong>.</div>`
    : profs.map(v => {
        const p   = v.profiles;
        const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
        return `
          <div class="mat-prof-row">
            <div class="mat-prof-avatar">${esc(ini)}</div>
            <div class="mat-prof-nome">${esc(p?.nome || p?.email || "—")}</div>
          </div>`;
      }).join("");

  ov.innerHTML = `
    <div class="mat-modal">
      <div class="mat-modal-head">
        <div class="mat-modal-icon">${esc(mat.nome[0].toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div class="mat-modal-title" id="mgr-nome-display">${esc(mat.nome)}</div>
          <div class="mat-modal-sub">${profs.length} professor${profs.length !== 1 ? "es" : ""} vinculado${profs.length !== 1 ? "s" : ""}</div>
        </div>
        <button class="mat-btn-ghost" id="mgr-editar-nome" style="padding:6px 12px;font-size:.75rem">Editar nome</button>
        <button class="mat-modal-x" id="mgr-x">✕</button>
      </div>

      <div id="mgr-edit-area" style="display:none;padding:14px 20px 0;border-bottom:1px solid var(--border)">
        <label class="mat-label">Novo nome</label>
        <div style="display:flex;gap:8px;margin-top:5px">
          <input id="mgr-input-nome" class="mat-input" type="text" value="${esc(mat.nome)}" maxlength="80" />
          <button class="mat-btn-criar" id="mgr-salvar-nome" style="white-space:nowrap">Salvar</button>
        </div>
        <div id="mgr-nome-err" class="mat-modal-err"></div>
      </div>

      <div class="mat-modal-body" style="gap:14px">
        <div class="mat-faltas-box">
          <div class="mat-faltas-title-row">
            <div class="mat-faltas-label">Frequência do semestre</div>
            <div class="mat-faltas-hint">Defina o total de aulas e quantas faltas o aluno pode ter no semestre. Vazio = não definido.</div>
          </div>
          <div class="mat-faltas-fields">
            <div class="mat-faltas-field">
              <label>Aulas no semestre</label>
              <input id="mgr-aulas" class="mat-input" type="number" min="0" max="999"
                value="${mat.aulas_semestre ?? ""}" placeholder="—" style="text-align:center" />
            </div>
            <div class="mat-faltas-field">
              <label>Faltas permitidas</label>
              <input id="mgr-faltas" class="mat-input" type="number" min="0" max="999"
                value="${mat.limite_faltas ?? ""}" placeholder="—" style="text-align:center" />
            </div>
            <button class="mat-btn-criar" id="mgr-salvar-faltas" style="white-space:nowrap;align-self:flex-end;height:38px">Salvar</button>
          </div>
          <div id="mgr-faltas-resumo" class="mat-faltas-resumo"></div>
        </div>
        <div id="mgr-faltas-err" class="mat-modal-err"></div>

        <div>
          <div class="mat-profs-title">Professores vinculados</div>
          <div class="mat-prof-list">${profRows}</div>
        </div>
      </div>
      <div class="mat-modal-foot" style="justify-content:flex-start">
        <button class="mat-btn-ghost" id="mgr-fechar">Fechar</button>
      </div>
    </div>`;

  ov.querySelector("#mgr-x").addEventListener("click", fechar);
  ov.querySelector("#mgr-fechar").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  // Toggle editar nome
  ov.querySelector("#mgr-editar-nome").addEventListener("click", () => {
    const area = ov.querySelector("#mgr-edit-area");
    const visible = area.style.display !== "none";
    area.style.display = visible ? "none" : "";
    if (!visible) setTimeout(() => ov.querySelector("#mgr-input-nome")?.focus(), 60);
  });

  // Parse de campo numérico opcional (vazio = null)
  const parseOpt = (raw) => {
    raw = raw.trim();
    if (raw === "") return { ok: true, val: null };
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return { ok: false };
    return { ok: true, val: n };
  };

  // Mostra resumo (presença mínima) conforme os campos
  const atualizarResumo = () => {
    const resumo = ov.querySelector("#mgr-faltas-resumo");
    const a = parseOpt(ov.querySelector("#mgr-aulas").value);
    const f = parseOpt(ov.querySelector("#mgr-faltas").value);
    if (a.ok && f.ok && a.val != null && f.val != null && a.val > 0) {
      const presPct = Math.round((a.val - Math.min(f.val, a.val)) / a.val * 100);
      resumo.textContent = `Presença mínima exigida: ${presPct}% (${a.val - Math.min(f.val, a.val)} de ${a.val} aulas).`;
      resumo.style.display = "";
    } else {
      resumo.style.display = "none";
    }
  };

  // Salvar aulas + limite de faltas
  const salvarFaltas = async () => {
    const err = ov.querySelector("#mgr-faltas-err");
    err.textContent = "";
    const a = parseOpt(ov.querySelector("#mgr-aulas").value);
    const f = parseOpt(ov.querySelector("#mgr-faltas").value);
    if (!a.ok || !f.ok) { err.textContent = "Informe números válidos (0 ou mais)."; return; }
    if (a.val != null && f.val != null && f.val > a.val) {
      err.textContent = "As faltas permitidas não podem ser maiores que o total de aulas.";
      return;
    }

    const btn = ov.querySelector("#mgr-salvar-faltas");
    btn.disabled = true; btn.textContent = "Salvando…";

    const { error } = await supabaseAdmin
      .from("materias").update({ aulas_semestre: a.val, limite_faltas: f.val }).eq("id", mat.id);

    btn.disabled = false; btn.textContent = "Salvar";
    if (error) { err.textContent = "Erro: " + error.message; return; }

    mat.aulas_semestre = a.val;
    mat.limite_faltas  = f.val;
    showToast("Frequência atualizada!", "success");
    await renderMaterias();
  };

  ov.querySelector("#mgr-salvar-faltas").addEventListener("click", salvarFaltas);
  ov.querySelector("#mgr-aulas").addEventListener("input", atualizarResumo);
  ov.querySelector("#mgr-faltas").addEventListener("input", atualizarResumo);
  ov.querySelector("#mgr-aulas").addEventListener("keydown", e => { if (e.key === "Enter") salvarFaltas(); });
  ov.querySelector("#mgr-faltas").addEventListener("keydown", e => { if (e.key === "Enter") salvarFaltas(); });
  atualizarResumo();

  // Salvar nome
  const salvarNome = async () => {
    const novoNome = ov.querySelector("#mgr-input-nome").value.trim();
    const err = ov.querySelector("#mgr-nome-err");
    err.textContent = "";
    if (!novoNome) { err.textContent = "Digite o nome."; return; }
    if (novoNome === mat.nome) { ov.querySelector("#mgr-edit-area").style.display = "none"; return; }

    const btn = ov.querySelector("#mgr-salvar-nome");
    btn.disabled = true; btn.textContent = "Salvando…";

    const { error } = await supabaseAdmin.from("materias").update({ nome: novoNome }).eq("id", mat.id);

    btn.disabled = false; btn.textContent = "Salvar";
    if (error) { err.textContent = "Erro: " + error.message; return; }

    ov.querySelector("#mgr-nome-display").textContent = novoNome;
    ov.querySelector("#mgr-edit-area").style.display = "none";
    mat.nome = novoNome;
    showToast("Nome atualizado!", "success");
    await renderMaterias();
  };

  ov.querySelector("#mgr-salvar-nome").addEventListener("click", salvarNome);
  ov.querySelector("#mgr-input-nome").addEventListener("keydown", e => { if (e.key === "Enter") salvarNome(); });
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
