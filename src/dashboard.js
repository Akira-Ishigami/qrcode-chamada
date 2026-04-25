import { supabase } from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", session.user.id).single();

  if (!profile || profile.role !== "super_admin") {
    window.location.href = profile?.role === "professor" ? "/minhas-turmas.html" : "/turmas.html";
    return;
  }

  await renderDashboard();
}

async function renderDashboard() {
  const hoje = new Date().toISOString().split("T")[0];

  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const [
    { data: instituicoes },
    { data: alunos },
    { data: profiles },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("instituicoes").select("id, nome").order("nome"),
    supabase.from("alunos").select("id, instituicao_id"),
    supabase.from("profiles").select("id, role, instituicao_id"),
    supabase.from("chamadas").select("id, turma_id, aberta, turmas(instituicao_id)").eq("data", hoje),
  ]);

  const insts = instituicoes ?? [];

  // Mapeia contagens por instituição
  const alunosPorInst   = {};
  const profsPorInst    = {};
  const chamadasPorInst = {};
  const abertosPorInst  = {};

  (alunos ?? []).forEach(a => {
    if (a.instituicao_id) alunosPorInst[a.instituicao_id] = (alunosPorInst[a.instituicao_id] ?? 0) + 1;
  });
  (profiles ?? []).forEach(p => {
    if (p.role === "professor" && p.instituicao_id)
      profsPorInst[p.instituicao_id] = (profsPorInst[p.instituicao_id] ?? 0) + 1;
  });
  (chamadas ?? []).forEach(c => {
    const iid = c.turmas?.instituicao_id;
    if (!iid) return;
    chamadasPorInst[iid] = (chamadasPorInst[iid] ?? 0) + 1;
    if (c.aberta) abertosPorInst[iid] = (abertosPorInst[iid] ?? 0) + 1;
  });

  const totalAlunos   = (alunos ?? []).length;
  const totalProfs    = (profiles ?? []).filter(p => p.role === "professor").length;
  const totalChamadas = (chamadas ?? []).length;
  const totalAbertos  = (chamadas ?? []).filter(c => c.aberta).length;

  const dataFormatada = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  root.innerHTML = `
    <div class="dash-header">
      <div>
        <div class="dash-title">Dashboard</div>
        <div class="dash-subtitle">${dataFormatada}</div>
      </div>
    </div>

    <div class="dash-stats-row">
      <div class="dash-stat-card">
        <div class="dash-stat-icon blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </div>
        <div class="dash-stat-num">${insts.length}</div>
        <div class="dash-stat-lbl">Instituições</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          </svg>
        </div>
        <div class="dash-stat-num">${totalAlunos}</div>
        <div class="dash-stat-lbl">Alunos</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon purple">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div class="dash-stat-num">${totalProfs}</div>
        <div class="dash-stat-lbl">Professores</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-icon orange">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
            <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
            <rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/>
            <rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/>
          </svg>
        </div>
        <div class="dash-stat-num">${totalChamadas}</div>
        <div class="dash-stat-lbl">Chamadas hoje${totalAbertos ? ` <span class="dash-badge-aberta">${totalAbertos} abertas</span>` : ""}</div>
      </div>
    </div>

    <div class="dash-section-title">Instituições</div>

    ${insts.length === 0 ? `
      <div class="dash-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.25"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <p>Nenhuma instituição cadastrada ainda.</p>
        <a href="turmas.html" class="dash-btn-link">Criar instituição</a>
      </div>
    ` : `
      <div class="dash-inst-grid" id="inst-grid"></div>
    `}
  `;

  if (insts.length > 0) {
    const grid = document.getElementById("inst-grid");
    insts.forEach((inst, i) => {
      const na     = alunosPorInst[inst.id]   ?? 0;
      const np     = profsPorInst[inst.id]    ?? 0;
      const nc     = chamadasPorInst[inst.id] ?? 0;
      const nabr   = abertosPorInst[inst.id]  ?? 0;

      const card = document.createElement("div");
      card.className = "dash-inst-card";
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="dic-header">
          <div class="dic-name">${esc(inst.nome)}</div>
          ${nabr ? `<span class="dash-badge-aberta">${nabr} aberta${nabr > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="dic-stats">
          <div class="dic-stat">
            <span class="dic-num">${na}</span>
            <span class="dic-lbl">alunos</span>
          </div>
          <div class="dic-divider"></div>
          <div class="dic-stat">
            <span class="dic-num">${np}</span>
            <span class="dic-lbl">profs</span>
          </div>
          <div class="dic-divider"></div>
          <div class="dic-stat">
            <span class="dic-num">${nc}</span>
            <span class="dic-lbl">chamadas hoje</span>
          </div>
        </div>
        <div class="dic-footer">
          <a href="relatorio.html" class="dic-link">Ver relatório →</a>
          <a href="turmas.html" class="dic-link">Ver turmas →</a>
        </div>
      `;
      grid.appendChild(card);
    });
  }
}

init();
