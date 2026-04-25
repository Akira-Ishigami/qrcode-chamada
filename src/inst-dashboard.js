import { supabase }     from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile, error } = await supabase
    .from("profiles").select("role, nome, email, instituicao_id").eq("id", session.user.id).single();

  if (error || !profile) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar perfil. <a href="/login.html">Login</a></div>`;
    return;
  }
  if (profile.role === "admin")     { window.location.href = "/dashboard.html"; return; }
  if (profile.role === "professor") { window.location.href = "/chamada.html";   return; }

  await applyNavRole();

  // Mostra nome da instituição na sidebar
  const instNameEl = document.getElementById("sidebar-inst-name");
  if (instNameEl && profile.instituicao_id) {
    const { data: inst } = await supabase
      .from("instituicoes").select("nome").eq("id", profile.instituicao_id).single();
    if (inst && instNameEl) instNameEl.textContent = inst.nome;
  }

  await render(profile);
}

async function render(profile) {
  const instId = profile.instituicao_id;
  const hoje   = new Date().toISOString().split("T")[0];
  const hora   = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const data   = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  root.innerHTML = `<div style="color:var(--text-3);padding:40px;text-align:center">Carregando…</div>`;

  const [
    { data: turmas },
    { data: alunos },
    { data: profs },
    { data: chamadas },
    { data: inst },
  ] = await Promise.all([
    supabase.from("turmas").select("id, nome").eq("instituicao_id", instId),
    supabase.from("alunos").select("id").eq("instituicao_id", instId),
    supabase.from("profiles").select("id").eq("instituicao_id", instId).eq("role", "professor"),
    supabase.from("chamadas")
      .select("id, aberta, turmas!inner(nome, professor, instituicao_id)")
      .eq("data", hoje)
      .eq("turmas.instituicao_id", instId),
    instId ? supabase.from("instituicoes").select("nome").eq("id", instId).single() : { data: null },
  ]);

  const nTurmas  = (turmas  ?? []).length;
  const nAlunos  = (alunos  ?? []).length;
  const nProfs   = (profs   ?? []).length;
  const nCham    = (chamadas ?? []).length;
  const nAbertas = (chamadas ?? []).filter(c => c.aberta).length;
  const instNome = inst?.nome ?? profile.nome ?? "Instituição";

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();

  root.innerHTML = `
    <div class="idash-header">
      <div>
        <div class="idash-greeting">${greeting}</div>
        <div class="idash-title">${instNome}</div>
      </div>
      <div class="idash-date-pill">
        <span class="idash-date-dot"></span>
        ${hora} · ${data}
      </div>
    </div>

    <div class="idash-stats">
      ${stat("blue",   svgTurma(), nTurmas, "Turmas")}
      ${stat("green",  svgAluno(), nAlunos, "Alunos")}
      ${stat("purple", svgProf(),  nProfs,  "Professores")}
      ${stat("orange", svgQr(),    nCham,   nAbertas ? `Chamadas <span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:5px;padding:1px 6px;font-size:.65rem;font-weight:700;margin-left:4px">${nAbertas} abertas</span>` : "Chamadas hoje")}
    </div>

    <div class="idash-section-head">
      <span class="idash-section-title">Acesso Rápido</span>
    </div>
    <div class="idash-nav-grid">
      ${navCard("turmas.html",      "c-blue",   svgTurma(), "Turmas",      "Turmas e matrículas",    0)}
      ${navCard("cadastro.html",    "c-green",  svgAluno(), "Alunos",      "Cadastro de alunos",     1)}
      ${navCard("professores.html", "c-violet", svgProf(),  "Professores", "Equipe docente",         2)}
      ${navCard("horarios.html",    "c-amber",  svgClock(), "Horários",    "Grade de aulas",         3)}
      ${navCard("relatorio-dia.html","c-sky",   svgRel(),   "Rel. do Dia", "Frequência diária",      4)}
    </div>

    <div class="idash-section-head">
      <span class="idash-section-title">Chamadas de Hoje</span>
      ${nAbertas > 0 ? `<span style="font-size:.72rem;font-weight:700;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;padding:3px 10px;border-radius:20px">${nAbertas} aberta${nAbertas > 1 ? "s" : ""}</span>` : ""}
    </div>

    ${nCham > 0 ? `
      <div class="idash-chamadas">
        ${(chamadas ?? []).map((c, i) => `
          <div class="idash-cham-row" style="animation-delay:${i * .04}s">
            <div class="idash-cham-dot ${c.aberta ? "aberta" : "fechada"}"></div>
            <div class="idash-cham-info">
              <div class="idash-cham-turma">${esc(c.turmas?.nome ?? "—")}</div>
              ${c.turmas?.professor ? `<div class="idash-cham-meta">${esc(c.turmas.professor)}</div>` : ""}
            </div>
            <span class="idash-cham-badge ${c.aberta ? "aberta" : "fechada"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
          </div>
        `).join("")}
      </div>
    ` : `<div class="idash-empty-box">Nenhuma chamada registrada hoje.</div>`}
  `;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function stat(color, icon, num, lbl) {
  return `
    <div class="idash-stat">
      <div class="idash-stat-top">
        <div class="idash-stat-icon ${color}">${icon}</div>
      </div>
      <div class="idash-stat-num">${num}</div>
      <div class="idash-stat-lbl">${lbl}</div>
    </div>`;
}

function navCard(href, cls, icon, label, desc, idx) {
  return `
    <a href="${href}" class="idash-nav-card ${cls}" style="animation-delay:${idx * .06}s">
      <div class="idash-nav-icon">${icon}</div>
      <div class="idash-nav-body">
        <div class="idash-nav-label">${label}</div>
        <div class="idash-nav-desc">${desc}</div>
      </div>
      <div class="idash-nav-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </a>`;
}

function svgTurma()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`; }
function svgProf()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgQr()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgClock()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`; }
function svgRel()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; }

init();
