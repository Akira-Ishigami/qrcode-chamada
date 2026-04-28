import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

const root = document.getElementById("page-root");
const hoje = new Date().toISOString().split("T")[0];

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, nome, instituicao_id").eq("id", session.user.id).single();

  if (!profile) { window.location.href = "/login.html"; return; }
  if (profile.role === "admin")       { window.location.href = "/dashboard.html"; return; }
  if (profile.role === "instituicao") { window.location.href = "/inst-dashboard.html"; return; }

  await renderPage(profile, session.user.id);
}

// ─── Render principal ─────────────────────────────────────────────────────────
async function renderPage(profile, userId) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const nomeProfessor = profile.nome || "";

  // 1. Busca turmas pelo professor_id (UUID — campo correto, migration 003)
  const { data: turmasPorId } = await supabaseAdmin
    .from("turmas")
    .select("id, nome, materia, horario, instituicao_id, instituicoes(nome)")
    .eq("professor_id", userId)
    .order("nome");

  // 2. Fallback: turmas legacy com professor (nome texto) sem professor_id
  const { data: turmasLegacy } = await supabaseAdmin
    .from("turmas")
    .select("id, nome, materia, horario, instituicao_id, instituicoes(nome)")
    .eq("professor", nomeProfessor)
    .is("professor_id", null)
    .order("nome");

  // Mescla sem duplicatas
  const idsVistos = new Set((turmasPorId ?? []).map(t => t.id));
  const turmas = [
    ...(turmasPorId ?? []),
    ...(turmasLegacy ?? []).filter(t => !idsVistos.has(t.id)),
  ];

  // 3. Chamadas de hoje
  const { data: chamadas } = await supabaseAdmin
    .from("chamadas")
    .select("id, turma_id, aberta, data")
    .eq("data", hoje);

  const chamadaMap = {};
  (chamadas ?? []).forEach(c => { chamadaMap[c.turma_id] = c; });

  if (turmas.length === 0) {
    root.innerHTML = `
      <div class="mt-header">
        <div class="mt-title">Olá, ${esc(nomeProfessor || "Professor")}</div>
        <div class="mt-subtitle">Nenhuma turma atribuída ainda.</div>
      </div>
      <div class="mt-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.25">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <p>Nenhuma turma foi atribuída ao seu perfil.<br>Entre em contato com o administrador.</p>
      </div>`;
    return;
  }

  // Agrupa por matéria
  const grupos = {};
  turmas.forEach(t => {
    const mat = t.materia || "Geral";
    if (!grupos[mat]) grupos[mat] = [];
    grupos[mat].push(t);
  });

  const dataFmt = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });

  root.innerHTML = `
    <div class="mt-header">
      <div>
        <div class="mt-title">Olá, ${esc(nomeProfessor || "Professor")}</div>
        <div class="mt-subtitle">${dataFmt} · ${turmas.length} turma${turmas.length !== 1 ? "s" : ""}</div>
      </div>
    </div>
    <div id="mt-grupos"></div>
  `;

  const container = document.getElementById("mt-grupos");

  Object.entries(grupos).forEach(([mat, lista]) => {
    const section = document.createElement("div");
    section.className = "mt-group";
    section.innerHTML = `
      <div class="mt-group-label">${esc(mat)}</div>
      <div class="mt-cards"></div>
    `;
    container.appendChild(section);

    const cards = section.querySelector(".mt-cards");
    lista.forEach(t => {
      const chamada = chamadaMap[t.id];
      let statusBadge = "";
      let actionBtn   = "";

      if (chamada && !chamada.aberta) {
        statusBadge = `<span class="mt-badge mt-badge-done">Encerrada</span>`;
        actionBtn   = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-ghost">Ver chamada</a>`;
      } else if (chamada && chamada.aberta) {
        statusBadge = `<span class="mt-badge mt-badge-open">Em andamento</span>`;
        actionBtn   = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-primary">Continuar</a>`;
      } else {
        actionBtn = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-primary">Fazer Chamada</a>`;
      }

      const card = document.createElement("div");
      card.className = "mt-card";
      card.innerHTML = `
        <div class="mt-card-top">
          <div class="mt-card-info">
            <div class="mt-card-nome">${esc(t.nome)}</div>
            ${t.instituicoes?.nome ? `<div class="mt-card-inst">${esc(t.instituicoes.nome)}</div>` : ""}
            ${t.horario ? `<div class="mt-card-horario">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" style="margin-right:3px;opacity:.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${esc(t.horario)}</div>` : ""}
          </div>
          ${statusBadge}
        </div>
        <div class="mt-card-actions">
          ${actionBtn}
          <button class="mt-btn mt-btn-ghost btn-ver-alunos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Ver alunos
          </button>
        </div>
      `;

      card.querySelector(".btn-ver-alunos").addEventListener("click", () =>
        abrirModalAlunos(t.id, t.nome));

      cards.appendChild(card);
    });
  });
}

// ─── Modal: Alunos da turma (somente visualização) ────────────────────────────
async function abrirModalAlunos(turmaId, turmaNome) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay open";
  overlay.innerHTML = `
    <div class="modal" style="max-height:90vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>Alunos — ${esc(turmaNome)}</h2>
        <button class="close-btn" id="modal-close">✕</button>
      </div>
      <div id="modal-alunos-body" style="overflow-y:auto;padding:16px;flex:1">
        <div style="padding:32px;text-align:center;color:var(--text-3)">Carregando…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-close").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });

  const { data: alunos, error } = await supabaseAdmin
    .from("alunos")
    .select("id, nome, matricula")
    .eq("turma_id", turmaId)
    .order("nome");

  const body = document.getElementById("modal-alunos-body");
  if (!body) return;

  if (error || !alunos || alunos.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-3)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.3;margin-bottom:10px">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        </svg>
        <p style="font-size:.875rem">${error ? "Erro ao carregar." : "Nenhum aluno nesta turma."}</p>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:10px">
      ${alunos.length} aluno${alunos.length !== 1 ? "s" : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;">
      ${alunos.map((a, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;">
          <span style="font-size:.72rem;color:var(--text-3);font-weight:600;width:20px;text-align:right;flex-shrink:0">${i+1}</span>
          <span style="flex:1;font-size:.875rem;font-weight:600;color:var(--text)">${esc(a.nome)}</span>
          ${a.matricula ? `<span style="font-size:.72rem;color:var(--text-3);background:var(--surface);border:1px solid var(--border);padding:2px 8px;border-radius:5px">${esc(a.matricula)}</span>` : ""}
        </div>`).join("")}
    </div>
  `;
}

init();
