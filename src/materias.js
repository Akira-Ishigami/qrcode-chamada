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

  // Carrega professores da instituição
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
    <div class="mat-header">
      <div class="mat-eyebrow">Configuração</div>
      <div class="mat-title">Matérias</div>
      <div class="mat-sub">Crie as disciplinas e vincule os professores responsáveis</div>
    </div>

    <div class="mat-new-card">
      <h3>Nova matéria</h3>
      <div class="mat-new-row">
        <input type="text" id="input-nova-mat" placeholder="Ex: Matemática, Português, Ciências…" maxlength="80" />
        <button class="mat-btn-add" id="btn-criar-mat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar matéria
        </button>
      </div>
      <div id="mat-feedback" style="font-size:.78rem;color:var(--red);margin-top:8px;min-height:16px"></div>
    </div>

    <div id="mat-list" class="mat-list"></div>
  `;

  document.getElementById("btn-criar-mat").addEventListener("click", criarMateria);
  document.getElementById("input-nova-mat").addEventListener("keydown", e => { if (e.key === "Enter") criarMateria(); });

  await renderMaterias();
}

// ── Lista de matérias ─────────────────────────────────────────────────────────
async function renderMaterias() {
  const lista = document.getElementById("mat-list");
  if (!lista) return;

  const { data: materias } = await supabaseAdmin
    .from("materias")
    .select("id, nome")
    .eq("instituicao_id", _instId)
    .order("nome");

  if (!materias?.length) {
    lista.innerHTML = `
      <div class="mat-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.25">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <p>Nenhuma matéria cadastrada ainda.<br>Crie a primeira acima.</p>
      </div>`;
    return;
  }

  // Busca vínculos professor-matéria
  const matIds = materias.map(m => m.id);
  const { data: vinculos } = await supabaseAdmin
    .from("professor_materias")
    .select("materia_id, professor_id, profiles(id, nome, email)")
    .in("materia_id", matIds);

  const vinculosPorMateria = {};
  (vinculos ?? []).forEach(v => {
    (vinculosPorMateria[v.materia_id] ??= []).push(v);
  });

  lista.innerHTML = "";

  materias.forEach((mat, idx) => {
    const profs = vinculosPorMateria[mat.id] ?? [];
    const ini   = mat.nome[0].toUpperCase();

    const card = document.createElement("div");
    card.className = "mat-card";
    card.style.animationDelay = `${idx * .05}s`;
    card.dataset.id = mat.id;

    // Professores disponíveis para vincular (exclui já vinculados)
    const vinculadosIds = new Set(profs.map(v => v.professor_id));
    const disponiveis   = _professores.filter(p => !vinculadosIds.has(p.id));

    card.innerHTML = `
      <div class="mat-card-head">
        <div class="mat-icon">${esc(ini)}</div>
        <div class="mat-nome">${esc(mat.nome)}</div>
        <span class="mat-profs-count">${profs.length} prof${profs.length !== 1 ? "s" : ""}</span>
        <div class="mat-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <button class="mat-btn-del" data-del="${mat.id}" title="Excluir matéria">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>

      <div class="mat-profs-panel">
        <div class="mat-profs-title">Professores vinculados</div>
        <div class="mat-prof-list" id="profs-${mat.id}">
          ${profs.length === 0
            ? `<div style="font-size:.8rem;color:var(--text-3);padding:4px 0">Nenhum professor vinculado ainda.</div>`
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
              }).join("")}
        </div>

        ${disponiveis.length > 0 ? `
          <div class="mat-add-prof">
            <select id="sel-prof-${mat.id}">
              <option value="">Selecione o professor…</option>
              ${disponiveis.map(p => `<option value="${p.id}">${esc(p.nome || p.email)}</option>`).join("")}
            </select>
            <button class="mat-btn-vincular" data-vincular="${mat.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Vincular
            </button>
          </div>` : `
          <div style="font-size:.75rem;color:var(--text-3);margin-top:6px">
            Todos os professores já estão vinculados.
          </div>`}
      </div>
    `;

    // Toggle expandir
    card.querySelector(".mat-card-head").addEventListener("click", e => {
      if (e.target.closest(".mat-btn-del")) return;
      card.classList.toggle("open");
    });

    // Excluir matéria
    card.querySelector(".mat-btn-del").addEventListener("click", () => excluirMateria(mat.id, mat.nome));

    // Vincular professor
    card.querySelector(`[data-vincular]`)?.addEventListener("click", () => vincularProfessor(mat.id));

    // Desvincular professores
    card.querySelectorAll("[data-unlink-pm]").forEach(btn => {
      btn.addEventListener("click", () => desvincularProfessor(btn.dataset.unlinkPm, btn.dataset.unlinkProf));
    });

    lista.appendChild(card);
  });
}

// ── Criar matéria ─────────────────────────────────────────────────────────────
async function criarMateria() {
  const input    = document.getElementById("input-nova-mat");
  const feedback = document.getElementById("mat-feedback");
  const nome     = input.value.trim();

  feedback.textContent = "";
  if (!nome) { feedback.textContent = "Digite o nome da matéria."; return; }

  const btn = document.getElementById("btn-criar-mat");
  btn.disabled = true;

  const { error } = await supabaseAdmin
    .from("materias")
    .insert({ nome, instituicao_id: _instId });

  btn.disabled = false;

  if (error) {
    if (error.code === "23505") {
      feedback.textContent = "Já existe uma matéria com esse nome.";
    } else {
      feedback.textContent = "Erro: " + error.message;
    }
    return;
  }

  input.value = "";
  showToast(`"${nome}" criada!`, "success");
  await renderMaterias();
}

// ── Excluir matéria ───────────────────────────────────────────────────────────
async function excluirMateria(id, nome) {
  if (!confirm(`Excluir "${nome}"? Isso também remove os vínculos com professores e horários.`)) return;

  const { error } = await supabaseAdmin.from("materias").delete().eq("id", id);
  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast(`"${nome}" excluída.`, "success");
  await renderMaterias();
}

// ── Vincular professor ────────────────────────────────────────────────────────
async function vincularProfessor(materiaId) {
  const sel     = document.getElementById(`sel-prof-${materiaId}`);
  const profId  = sel?.value;
  if (!profId) { showToast("Selecione um professor.", "error"); return; }

  const { error } = await supabaseAdmin
    .from("professor_materias")
    .insert({ professor_id: profId, materia_id: materiaId });

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor vinculado!", "success");
  await renderMaterias();
  // Reabre o card
  const card = document.querySelector(`.mat-card[data-id="${materiaId}"]`);
  card?.classList.add("open");
}

// ── Desvincular professor ─────────────────────────────────────────────────────
async function desvincularProfessor(materiaId, profId) {
  const { error } = await supabaseAdmin
    .from("professor_materias")
    .delete()
    .eq("materia_id", materiaId)
    .eq("professor_id", profId);

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor desvinculado.", "success");
  await renderMaterias();
  const card = document.querySelector(`.mat-card[data-id="${materiaId}"]`);
  card?.classList.add("open");
}

init();
