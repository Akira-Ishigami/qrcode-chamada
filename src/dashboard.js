import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";
import { gerarCracha, downloadCracha, buscarCrachaConfig } from "./cracha.js";

const root = document.getElementById("page-root");

let _clockInterval = null;
function clearClock() {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

function setActive(id) {
  document.querySelectorAll(".sidebar-nav .sidebar-link").forEach(el => el.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, id").eq("id", session.user.id).single();

  if (!profile || profile.role !== "admin") {
    window.location.href = profile?.role === "professor" ? "/chamada.html" : "/inst-dashboard.html";
    return;
  }

  // Guarda user id para notas
  window._adminId = session.user.id;

  const sairKanban = () => root.classList.remove("kanban-mode");

  document.getElementById("nav-dashboard").addEventListener("click", () => {
    setActive("nav-dashboard"); sairKanban(); window.scrollTo(0, 0);
    renderDashboard();
  });
  document.getElementById("nav-instituicoes").addEventListener("click", () => {
    setActive("nav-instituicoes"); sairKanban(); window.scrollTo(0, 0);
    renderInstituicoes();
  });
  document.getElementById("nav-suporte").addEventListener("click", () => {
    setActive("nav-suporte");
    renderPedidos(); // kanban-mode adicionado dentro da função
  });

  // Realtime — atualiza a view ativa quando o banco muda
  setupRealtime();

  await renderDashboard();
  await atualizarBadgePedidos();
}

// ─── Realtime ─────────────────────────────────────────────────────────────────
function setupRealtime() {
  supabase
    .channel("adm-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "instituicoes" }, () => {
      const active = document.querySelector(".sidebar-nav .sidebar-link.active")?.id;
      if (active === "nav-dashboard")    renderDashboard();
      if (active === "nav-instituicoes") renderInstituicoes();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "chamadas" }, () => {
      const active = document.querySelector(".sidebar-nav .sidebar-link.active")?.id;
      if (active === "nav-dashboard") renderDashboard();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "turmas" }, () => {
      const active = document.querySelector(".sidebar-nav .sidebar-link.active")?.id;
      if (active === "nav-instituicoes") renderInstituicoes();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "alunos" }, () => {
      const active = document.querySelector(".sidebar-nav .sidebar-link.active")?.id;
      if (active === "nav-instituicoes") renderInstituicoes();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "feedbacks" }, () => {
      const active = document.querySelector(".sidebar-nav .sidebar-link.active")?.id;
      if (active === "nav-suporte") renderPedidos();
      atualizarBadgePedidos();
    })
    .subscribe();
}

// Atualiza o badge de abertos na sidebar
async function atualizarBadgePedidos() {
  const { count } = await supabaseAdmin
    .from("feedbacks").select("id", { count: "exact", head: true })
    .eq("status", "aberto");
  const badge = document.getElementById("badge-suporte");
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = ""; }
  else           { badge.style.display = "none"; }
}

// ══ VIEW 1: DASHBOARD (read-only) ════════════════════════════════════════════
async function renderDashboard() {
  clearClock();
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje    = new Date().toISOString().split("T")[0];
  const dataFmt = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });
  const h       = new Date().getHours();
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

  const [
    { data: instituicoes, error: e1 },
    { data: alunos,       error: e2 },
    { data: profs,        error: e3 },
    { data: chamadas,     error: e4 },
  ] = await Promise.all([
    supabaseAdmin.from("instituicoes").select("id, nome"),
    supabaseAdmin.from("alunos").select("id"),
    supabaseAdmin.from("profiles").select("id").eq("role", "professor"),
    supabaseAdmin.from("chamadas")
      .select("id, aberta, turmas(nome, instituicoes(nome))")
      .eq("data", hoje)
      .limit(15),
  ]);

  const fetchErr = e1 || e2 || e3 || e4;
  if (fetchErr) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar dados: ${fetchErr.message}</div>`;
    return;
  }

  const nInst   = (instituicoes ?? []).length;
  const nAlunos = (alunos ?? []).length;
  const nProfs  = (profs ?? []).length;
  const nCham   = (chamadas ?? []).length;
  const nAbr    = (chamadas ?? []).filter(c => c.aberta).length;

  const hora = new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });

  root.innerHTML = `
    <!-- Banner executivo -->
    <div class="dash-banner">
      <div class="dash-banner-dots"></div>
      <div class="dash-banner-glow1"></div>
      <div class="dash-banner-glow2"></div>
      <div class="dash-banner-left">
        <div class="dash-greeting">${greeting}</div>
        <div class="dash-title">Painel Administrativo</div>
        <div class="dash-subtitle">${dataFmt}</div>
        ${nAbr > 0
          ? `<div class="dash-live-pill"><span class="dash-live-dot"></span>${nAbr} chamada${nAbr>1?"s":""} aberta${nAbr>1?"s":""}</div>`
          : `<div class="dash-live-pill quiet">Nenhuma chamada aberta</div>`
        }
      </div>
      <div class="dash-banner-right">
        <div class="dash-clock" id="dash-clock">${hora}</div>
        <div class="dash-clock-label">horário atual</div>
      </div>
    </div>

    <!-- Stats -->
    <div class="dash-stats-row">
      <div class="dash-stat-card" style="animation-delay:.05s">
        <div class="dash-stat-icon blue">${svgInst()}</div>
        <div class="dash-stat-info">
          <div class="dash-stat-num">${nInst}</div>
          <div class="dash-stat-lbl">Instituições</div>
        </div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.1s">
        <div class="dash-stat-icon green">${svgAluno()}</div>
        <div class="dash-stat-info">
          <div class="dash-stat-num">${nAlunos}</div>
          <div class="dash-stat-lbl">Alunos cadastrados</div>
        </div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.15s">
        <div class="dash-stat-icon purple">${svgProf()}</div>
        <div class="dash-stat-info">
          <div class="dash-stat-num">${nProfs}</div>
          <div class="dash-stat-lbl">Professores</div>
        </div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.2s">
        <div class="dash-stat-icon orange">${svgQr()}</div>
        <div class="dash-stat-info">
          <div class="dash-stat-num">${nCham}</div>
          <div class="dash-stat-lbl">Chamadas hoje${nAbr ? `<span class="dash-badge-aberta">${nAbr} abertas</span>` : ""}</div>
        </div>
      </div>
    </div>

    <!-- Chamadas de hoje -->
    <div class="dash-section-head">
      <div class="dash-section-title">Chamadas de hoje</div>
      <div class="dash-section-line"></div>
    </div>
    ${nCham === 0
      ? `<div class="dash-empty-feed">Nenhuma chamada registrada hoje.</div>`
      : `<div class="dash-activity">
          ${(chamadas ?? []).map((c, i) => `
            <div class="dash-act-row" style="animation-delay:${i*.04}s">
              <div class="dash-act-dot ${c.aberta ? "aberta" : "fechada"}"></div>
              <div class="dash-act-info">
                <div class="dash-act-turma">${esc(c.turmas?.nome ?? "—")}</div>
                ${c.turmas?.instituicoes?.nome ? `<div class="dash-act-inst">${esc(c.turmas.instituicoes.nome)}</div>` : ""}
              </div>
              <span class="dash-act-badge ${c.aberta ? "aberta" : "fechada"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
            </div>`).join("")}
        </div>`
    }
  `;

  // Live clock — ticks every second
  const clockEl = document.getElementById("dash-clock");
  if (clockEl) {
    _clockInterval = setInterval(() => {
      clockEl.textContent = new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
    }, 1000);
  }
}

// ══ VIEW 2: INSTITUIÇÕES (lista + detalhe) ════════════════════════════════════
async function renderInstituicoes() {
  clearClock();
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];

  const [
    { data: instituicoes, error: e1 },
    { data: alunos,       error: e2 },
    { data: profs,        error: e3 },
    { data: chamadas,     error: e4 },
  ] = await Promise.all([
    supabaseAdmin.from("instituicoes").select("id, nome").order("nome"),
    supabaseAdmin.from("alunos").select("id, instituicao_id"),
    supabaseAdmin.from("profiles").select("id, instituicao_id").eq("role", "professor"),
    supabaseAdmin.from("chamadas").select("id, aberta, turmas(instituicao_id)").eq("data", hoje),
  ]);

  const fetchErr = e1 || e2 || e3 || e4;
  if (fetchErr) { root.innerHTML = `<div class="tv-error">Erro ao carregar dados: ${fetchErr.message}</div>`; return; }

  const insts = instituicoes ?? [];
  const alunosPorInst = {};
  const profsPorInst  = {};
  const chamPorInst   = {};

  (alunos   ?? []).forEach(a => { if (a.instituicao_id) alunosPorInst[a.instituicao_id] = (alunosPorInst[a.instituicao_id]??0)+1; });
  (profs    ?? []).forEach(p => { if (p.instituicao_id) profsPorInst [p.instituicao_id] = (profsPorInst [p.instituicao_id]??0)+1; });
  (chamadas ?? []).forEach(c => { const id = c.turmas?.instituicao_id; if (id) chamPorInst[id] = (chamPorInst[id]??0)+1; });

  const PALETTE = [
    { bg: "#eff6ff", fg: "#2563eb" }, { bg: "#f0fdf4", fg: "#16a34a" },
    { bg: "#faf5ff", fg: "#7c3aed" }, { bg: "#fff7ed", fg: "#ea580c" },
    { bg: "#fdf4ff", fg: "#9333ea" }, { bg: "#ecfeff", fg: "#0891b2" },
  ];

  root.innerHTML = `
    <div class="il-header">
      <div>
        <div class="il-title">Instituições</div>
        <div class="il-subtitle">${insts.length} instituição${insts.length !== 1 ? "s" : ""} cadastrada${insts.length !== 1 ? "s" : ""}</div>
      </div>
      <button class="il-btn-new" id="btn-nova-inst">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Instituição
      </button>
    </div>
    ${insts.length === 0
      ? `<div class="il-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.15"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
           <p>Nenhuma instituição cadastrada ainda.</p>
         </div>`
      : `<div class="ig-grid" id="ig-grid"></div>`
    }
  `;

  document.getElementById("btn-nova-inst").addEventListener("click", abrirModalNovaInst);

  if (insts.length > 0) {
    const grid = document.getElementById("ig-grid");
    insts.forEach((inst, i) => {
      const na  = alunosPorInst[inst.id] ?? 0;
      const np  = profsPorInst [inst.id] ?? 0;
      const nc  = chamPorInst  [inst.id] ?? 0;
      const pal = PALETTE[(inst.nome.charCodeAt(0) || 0) % PALETTE.length];

      const card = document.createElement("div");
      card.className = "ig-card";
      card.style.cssText = `animation-delay:${i * .05}s; --card-fg:${pal.fg}; --card-bg:${pal.bg}`;
      card.innerHTML = `
        <div class="ig-card-avatar" style="background:${pal.bg};color:${pal.fg}">${esc(inst.nome.charAt(0).toUpperCase())}</div>
        <div class="ig-card-name">${esc(inst.nome)}</div>
        <div class="ig-card-stats">
          <div class="ig-stat">
            <span class="ig-stat-num">${na}</span>
            <span class="ig-stat-lbl">alunos</span>
          </div>
          <div class="ig-stat-div"></div>
          <div class="ig-stat">
            <span class="ig-stat-num">${np}</span>
            <span class="ig-stat-lbl">prof.</span>
          </div>
          ${nc > 0 ? `
          <div class="ig-stat-div"></div>
          <div class="ig-stat">
            <span class="ig-stat-num" style="color:#16a34a">${nc}</span>
            <span class="ig-stat-lbl" style="color:#16a34a">hoje</span>
          </div>` : ""}
        </div>
      `;
      card.addEventListener("click", () => renderInstDetalhe(inst.id, inst.nome));
      grid.appendChild(card);
    });
  }
}

// ── Detalhe de uma instituição ────────────────────────────────────────────────
async function renderInstDetalhe(instId, instNome) {
  clearClock();
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];

  const [
    { data: turmas,   error: e1 },
    { data: alunos,   error: e2 },
    { data: profs,    error: e3 },
    { data: chamadas, error: e4 },
  ] = await Promise.all([
    supabaseAdmin.from("turmas").select("id, nome, materia").eq("instituicao_id", instId).order("nome"),
    supabaseAdmin.from("alunos").select("id, nome, matricula, turma_id").eq("instituicao_id", instId).order("nome"),
    supabaseAdmin.from("profiles").select("id, nome, email").eq("instituicao_id", instId).eq("role", "professor").order("nome"),
    supabaseAdmin.from("chamadas")
      .select("id, aberta, data, turmas!inner(nome, instituicao_id)")
      .eq("turmas.instituicao_id", instId)
      .order("data", { ascending: false })
      .limit(20),
  ]);

  const fetchErr = e1 || e2 || e3 || e4;
  if (fetchErr) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar detalhes: ${fetchErr.message}</div>`;
    return;
  }

  const chamHoje = (chamadas ?? []).filter(c => c.data === hoje);
  const abertas  = chamHoje.filter(c => c.aberta).length;

  // Agrupa alunos por turma
  const turmaMap = {};
  (turmas ?? []).forEach(t => { turmaMap[t.id] = { ...t, alunos: [] }; });
  (alunos ?? []).forEach(a => { if (turmaMap[a.turma_id]) turmaMap[a.turma_id].alunos.push(a); });

  const gruposTurma = Object.values(turmaMap);
  const semTurma    = (alunos ?? []).filter(a => !turmaMap[a.turma_id]);

  const instInitial = instNome.charAt(0).toUpperCase();
  const PALETTE = [
    { bg: "#eff6ff", fg: "#2563eb" }, { bg: "#f0fdf4", fg: "#16a34a" },
    { bg: "#faf5ff", fg: "#7c3aed" }, { bg: "#fff7ed", fg: "#ea580c" },
    { bg: "#fdf4ff", fg: "#9333ea" }, { bg: "#ecfeff", fg: "#0891b2" },
  ];
  const pal = PALETTE[(instNome.charCodeAt(0) || 0) % PALETTE.length];

  root.innerHTML = `
    <div class="det-breadcrumb">
      <button class="det-btn-back" id="btn-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
        Instituições
      </button>
      <span class="det-bc-sep">/</span>
      <span class="det-bc-name">${esc(instNome)}</span>
    </div>

    <div class="det-header">
      <div class="det-header-left">
        <div class="det-avatar" style="background:${pal.bg};color:${pal.fg}">${instInitial}</div>
        <div class="det-title">${esc(instNome)}</div>
      </div>
      <div class="det-header-actions">
        <button class="det-btn-reset" id="btn-reset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          Redefinir senha
        </button>
        <button class="det-btn-del" id="btn-del">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Excluir
        </button>
      </div>
    </div>

    <div class="det-stats">
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#eff6ff;color:#2563eb">${svgTurma()}</div>
        <div class="det-stat-num">${(turmas??[]).length}</div>
        <div class="det-stat-lbl">Turmas</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#f0fdf4;color:#16a34a">${svgAluno()}</div>
        <div class="det-stat-num">${(alunos??[]).length}</div>
        <div class="det-stat-lbl">Alunos</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#faf5ff;color:#7c3aed">${svgProf()}</div>
        <div class="det-stat-num">${(profs??[]).length}</div>
        <div class="det-stat-lbl">Professores</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#fff7ed;color:#ea580c">${svgQr()}</div>
        <div class="det-stat-num">${chamHoje.length}</div>
        <div class="det-stat-lbl">Chamadas hoje${abertas ? `<br><span style="font-size:.6rem;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;font-weight:700">${abertas} abertas</span>` : ""}</div>
      </div>
    </div>

    <div class="det-body">
      <!-- Coluna principal: alunos por turma -->
      <div class="det-main-col">
        <div class="det-section">
          <div class="det-section-title">Alunos por turma (${(alunos??[]).length})</div>
          ${gruposTurma.length === 0 && semTurma.length === 0
            ? `<div class="det-empty">Nenhum aluno cadastrado.</div>`
            : `<div id="det-alunos-list"></div>`
          }
        </div>
      </div>

      <!-- Coluna lateral: professores + chamadas -->
      <div class="det-side-col">
        <div class="det-section">
          <div class="det-section-title">Professores (${(profs??[]).length})</div>
          ${(profs??[]).length === 0
            ? `<div class="det-empty">Nenhum professor cadastrado.</div>`
            : `<div class="det-table-wrap">
                <table class="det-table">
                  <thead><tr><th>Nome</th><th>E-mail</th></tr></thead>
                  <tbody>
                    ${(profs??[]).map(p => `
                      <tr>
                        <td>
                          <div class="det-prof-cell">
                            <div class="det-prof-avatar">${esc((p.nome||p.email||"?").charAt(0).toUpperCase())}</div>
                            <span class="det-td-name">${esc(p.nome||"—")}</span>
                          </div>
                        </td>
                        <td><span class="det-td-sub">${esc(p.email||"—")}</span></td>
                      </tr>`).join("")}
                  </tbody>
                </table>
              </div>`
          }
        </div>

        <div class="det-section">
          <div class="det-section-title">Chamadas recentes (${(chamadas??[]).length})</div>
          ${(chamadas??[]).length === 0
            ? `<div class="det-empty">Nenhuma chamada registrada ainda.</div>`
            : `<div class="det-table-wrap">
                ${(chamadas??[]).map(c => `
                  <div class="det-cham-row">
                    <div class="det-cham-dot ${c.aberta ? "open" : "done"}"></div>
                    <div class="det-cham-info">
                      <div class="det-cham-nome">${esc(c.turmas?.nome??"—")}</div>
                      <div class="det-cham-data">${new Date(c.data+"T00:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"numeric",month:"short"})}</div>
                    </div>
                    <span class="det-badge ${c.aberta?"open":"done"}">${c.aberta?"Aberta":"Encerrada"}</span>
                  </div>`).join("")}
              </div>`
          }
        </div>

        <!-- Crachá preview -->
        <div class="det-section">
          <div class="det-section-title" style="display:flex;align-items:center;justify-content:space-between">
            Crachá da Instituição
          </div>
          <div id="det-cracha-box" class="det-cracha-box">
            <div class="det-cracha-loading">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28" style="opacity:.2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/><path d="M9 18h6"/></svg>
              <span>Gerando preview…</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Popula alunos por turma com accordion
  if (document.getElementById("det-alunos-list")) {
    const list = document.getElementById("det-alunos-list");
    gruposTurma.forEach(t => {
      const group = document.createElement("div");
      group.className = "det-turma-group";
      group.innerHTML = `
        <div class="det-turma-label" data-open="false">
          <span>${esc(t.nome)}${t.materia ? ` <span style="color:var(--text-3);font-weight:500">· ${esc(t.materia)}</span>` : ""}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="det-turma-count">${t.alunos.length} aluno${t.alunos.length!==1?"s":""}</span>
            <svg class="det-turma-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="det-turma-body">
          ${t.alunos.length === 0
            ? `<div style="padding:10px 14px;color:var(--text-3);font-size:.82rem">Nenhum aluno nesta turma.</div>`
            : t.alunos.map((a, i) => `
                <div class="det-aluno-row">
                  <span class="det-aluno-num">${i+1}</span>
                  <span class="det-aluno-nome">${esc(a.nome)}</span>
                  ${a.matricula ? `<span class="det-aluno-mat">${esc(a.matricula)}</span>` : ""}
                  <button class="det-cracha-btn" data-aluno-id="${esc(a.id)}" title="Baixar crachá">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/><path d="M9 18h6"/></svg>
                    Crachá
                  </button>
                </div>`).join("")
          }
        </div>
      `;
      const label = group.querySelector(".det-turma-label");
      const body  = group.querySelector(".det-turma-body");
      label.addEventListener("click", () => {
        const open = label.dataset.open === "true";
        label.dataset.open = !open;
        label.classList.toggle("open", !open);
        body.classList.toggle("open", !open);
      });
      list.appendChild(group);
    });

    if (semTurma.length > 0) {
      const group = document.createElement("div");
      group.className = "det-turma-group";
      group.innerHTML = `
        <div class="det-turma-label" data-open="false">
          <span style="color:var(--text-3)">Sem turma atribuída</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="det-turma-count">${semTurma.length} aluno${semTurma.length!==1?"s":""}</span>
            <svg class="det-turma-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="det-turma-body">
          ${semTurma.map((a, i) => `
            <div class="det-aluno-row">
              <span class="det-aluno-num">${i+1}</span>
              <span class="det-aluno-nome">${esc(a.nome)}</span>
              ${a.matricula ? `<span class="det-aluno-mat">${esc(a.matricula)}</span>` : ""}
            </div>`).join("")}
        </div>
      `;
      const label = group.querySelector(".det-turma-label");
      const body  = group.querySelector(".det-turma-body");
      label.addEventListener("click", () => {
        const open = label.dataset.open === "true";
        label.dataset.open = !open;
        label.classList.toggle("open", !open);
        body.classList.toggle("open", !open);
      });
      list.appendChild(group);
    }
  }

  document.getElementById("btn-back").addEventListener("click", () => renderInstituicoes());
  document.getElementById("btn-reset").addEventListener("click", () => abrirModalResetSenha(instId, instNome));
  document.getElementById("btn-del").addEventListener("click", () => confirmarExcluir(instId, instNome));

  // Preview do crachá da instituição (lado direito)
  const crachaConfig = await buscarCrachaConfig(supabaseAdmin, instId);
  const crachaBox = document.getElementById("det-cracha-box");
  if (crachaBox) {
    try {
      const demoAluno = {
        nome: (alunos??[])[0]?.nome || "Aluno Demo",
        matricula: (alunos??[])[0]?.matricula || "001",
        foto_url: (alunos??[])[0]?.foto_url || null,
        turma: { nome: (turmas??[])[0]?.nome || "Turma" },
      };
      const dataUrl = await gerarCracha(demoAluno, crachaConfig, instNome);
      crachaBox.innerHTML = `
        <img src="${dataUrl}"
          class="det-cracha-img"
          title="Clique para ampliar"
          alt="Preview do crachá" />
        <div class="det-cracha-hint">Clique para ampliar · Baseado no 1º aluno</div>
      `;
      crachaBox.querySelector("img").addEventListener("click", () => {
        const overlay = document.createElement("div");
        overlay.className = "cracha-lightbox";
        overlay.innerHTML = `<img src="${dataUrl}" /><button class="cracha-lb-close">✕</button>`;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.classList.add("open"), 10);
        const close = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 250); };
        overlay.querySelector(".cracha-lb-close").addEventListener("click", close);
        overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
      });
    } catch {
      crachaBox.innerHTML = `<div class="det-cracha-loading"><span style="color:var(--text-3);font-size:.78rem">Sem configuração de crachá ainda.</span></div>`;
    }
  }

  // Botões de crachá nos alunos
  root.querySelectorAll(".det-cracha-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const alunoId = btn.dataset.alunoId;
      const aluno   = [...gruposTurma.flatMap(t => t.alunos), ...semTurma].find(a => a.id === alunoId);
      if (!aluno) return;
      btn.disabled = true; btn.style.opacity = "0.5";
      try {
        // Monta objeto aluno com turma
        const turmaInfo = gruposTurma.find(t => t.alunos.some(a => a.id === alunoId));
        const alunoComTurma = { ...aluno, turma: turmaInfo ? { nome: turmaInfo.nome } : null };
        const dataUrl = await gerarCracha(alunoComTurma, crachaConfig, instNome);
        downloadCracha(dataUrl, aluno.nome);
      } catch (e) {
        showToast("Erro ao gerar crachá.", "error");
      } finally {
        btn.disabled = false; btn.style.opacity = "";
      }
    });
  });
}

// ══ VIEW 3: SUPORTE — KANBAN ═════════════════════════════════════════════════
async function renderPedidos() {
  clearClock();
  root.classList.add("kanban-mode");
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const { data: feedbacks, error } = await supabaseAdmin
    .from("feedbacks")
    .select("id, tipo, titulo, descricao, status, criado_em, instituicoes(nome)")
    .order("criado_em", { ascending: false });

  if (error) {
    root.classList.remove("kanban-mode");
    root.innerHTML = `<div class="tv-error">Erro: ${error.message}</div>`;
    return;
  }

  const todos = feedbacks ?? [];

  // Atualiza badge sidebar
  const badge = document.getElementById("badge-suporte");
  const nAbr = todos.filter(p => p.status === "aberto").length;
  if (badge) { badge.textContent = nAbr; badge.style.display = nAbr > 0 ? "" : "none"; }

  const tipoLabel = { bug: "Bug", melhoria: "Melhoria" };
  const fmtData = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day:"numeric", month:"short" });

  const colunas = [
    { id: "aberto",     label: "Aberto",     cor: "#f59e0b" },
    { id: "em_analise", label: "Em análise", cor: "#2563eb" },
    { id: "resolvido",  label: "Resolvido",  cor: "#16a34a" },
  ];

  // ── Monta o HTML do Kanban ────────────────────────────────────────────────
  root.innerHTML = `<div class="kanban-wrap" id="kanban-wrap"></div>`;
  const wrap = document.getElementById("kanban-wrap");

  // Atualiza status no banco e move o card visualmente
  const mudarStatus = async (pedidoId, novoStatus, cardEl, targetCol) => {
    const { error: err } = await supabaseAdmin
      .from("feedbacks").update({ status: novoStatus }).eq("id", pedidoId);
    if (err) { showToast("Erro ao atualizar.", "error"); return; }
    showToast("Status atualizado!", "success");
    // Move o card para a coluna destino
    const targetCards = targetCol.querySelector(".kanban-cards");
    cardEl.dataset.status = novoStatus;
    cardEl.className = `kanban-card tipo-${cardEl.dataset.tipo}`;
    targetCards.insertBefore(cardEl, targetCards.firstChild);
    // Atualiza contadores
    atualizarContadoresKanban();
    atualizarBadgePedidos();
  };

  // Cria um card arrastável
  const criarCard = (p, idx) => {
    const card = document.createElement("div");
    card.className = `kanban-card tipo-${p.tipo}`;
    card.draggable = true;
    card.dataset.id     = p.id;
    card.dataset.status = p.status;
    card.dataset.tipo   = p.tipo;
    card.style.animationDelay = `${idx * .04}s`;
    card.innerHTML = `
      <div class="kanban-card-inst">
        ${p.instituicoes?.nome ? esc(p.instituicoes.nome) : "—"}
        <span class="kanban-tipo-pill ${p.tipo}">${tipoLabel[p.tipo] ?? p.tipo}</span>
      </div>
      <div class="kanban-card-title">${esc(p.titulo)}</div>
      <div class="kanban-card-desc">${esc(p.descricao)}</div>
      <div class="kanban-card-foot">
        <span class="kanban-card-date">${fmtData(p.criado_em)}</span>
        <span class="kanban-drag-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" style="margin-right:3px"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          arrastar
        </span>
      </div>
    `;

    // Click abre modal (distingue do drag)
    let dragOccurred = false;
    card.addEventListener("mousedown", () => { dragOccurred = false; });
    card.addEventListener("dragstart", (e) => {
      dragOccurred = true;
      e.dataTransfer.setData("text/plain", p.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => card.classList.add("dragging"), 0);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("click", () => {
      if (dragOccurred) return;
      abrirModalFeedback(p, tipoLabel, fmtData);
    });

    return card;
  };

  // Cria colunas e popula com cards
  colunas.forEach(col => {
    const items = todos.filter(p => p.status === col.id);
    const colEl = document.createElement("div");
    colEl.className = "kanban-col";
    colEl.dataset.colStatus = col.id;
    colEl.innerHTML = `
      <div class="kanban-col-head">
        <div class="kanban-col-dot ${col.id}"></div>
        <div class="kanban-col-name">${col.label}</div>
        <div class="kanban-col-count ${items.length > 0 ? "has-items" : ""}" id="count-${col.id}">${items.length}</div>
      </div>
      <div class="kanban-cards" id="cards-${col.id}">
        ${items.length === 0 ? `
          <div class="kanban-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28" style="opacity:.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p>Nenhuma solicitação</p>
          </div>` : ""}
      </div>
    `;
    wrap.appendChild(colEl);

    // Popula cards
    const cardsArea = colEl.querySelector(".kanban-cards");
    items.forEach((p, idx) => cardsArea.appendChild(criarCard(p, idx)));

    // Drop zone handlers
    colEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      colEl.classList.add("drag-over");
    });
    colEl.addEventListener("dragleave", (e) => {
      if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drag-over");
    });
    colEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      colEl.classList.remove("drag-over");
      const pedidoId = e.dataTransfer.getData("text/plain");
      const cardEl   = document.querySelector(`.kanban-card[data-id="${pedidoId}"]`);
      if (!cardEl || cardEl.dataset.status === col.id) return;
      await mudarStatus(pedidoId, col.id, cardEl, colEl);
    });
  });

  // Atualiza os contadores de cada coluna
  function atualizarContadoresKanban() {
    colunas.forEach(col => {
      const n = document.querySelectorAll(`.kanban-card[data-status="${col.id}"]`).length;
      const el = document.getElementById(`count-${col.id}`);
      if (el) { el.textContent = n; el.className = `kanban-col-count ${n > 0 ? "has-items" : ""}`; }
    });
  }
}

// ══ ANOTAÇÕES (legado — substituído por Pedidos no ADM) ═══════════════════════
function renderAnotacoes() {
  // Mantido para compatibilidade, redireciona para pedidos
  renderPedidos();
}

function _renderAnotacoesLegado() {
  const storageKey = `adm_notes_v2_${window._adminId || "local"}`;
  const COLORS     = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4"];
  const timers     = {};

  const loadNotes = () => JSON.parse(localStorage.getItem(storageKey) || "[]");
  const saveNotes = (notes) => localStorage.setItem(storageKey, JSON.stringify(notes));

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day:"numeric", month:"short" }) + " " +
           d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
  };

  const newNote = () => ({
    id: crypto.randomUUID(),
    title: "", content: "",
    color: COLORS[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const renderGrid = () => {
    const notes = loadNotes();
    const grid  = document.getElementById("notes-grid");
    if (!grid) return;

    if (notes.length === 0) {
      grid.innerHTML = `
        <div class="notes-empty">
          <div class="notes-empty-icon">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" width="52" height="52">
              <rect x="8" y="6" width="32" height="36" rx="4"/>
              <line x1="16" y1="16" x2="32" y2="16"/>
              <line x1="16" y1="23" x2="28" y2="23"/>
              <line x1="16" y1="30" x2="22" y2="30"/>
            </svg>
          </div>
          <div class="notes-empty-title">Nenhuma anotação ainda</div>
          <div class="notes-empty-sub">Clique em "Nova nota" para começar</div>
        </div>`;
      return;
    }

    grid.innerHTML = notes.map((note, i) => `
      <div class="note-card" data-id="${note.id}" style="--note-color:${note.color};animation-delay:${i * .045}s">
        <button class="note-del" data-id="${note.id}" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="note-inner">
          <input  class="note-title"   data-id="${note.id}" placeholder="Título" value="${esc(note.title)}" maxlength="80"/>
          <textarea class="note-content" data-id="${note.id}" placeholder="Escreva aqui…" rows="4">${esc(note.content)}</textarea>
        </div>
        <div class="note-footer">
          <div class="note-colors">
            ${COLORS.map(c => `<div class="note-color-dot${note.color===c?" active":""}" data-id="${note.id}" data-color="${c}" style="background:${c}"></div>`).join("")}
          </div>
          <div class="note-timestamp">${fmtDate(note.updatedAt)}</div>
        </div>
      </div>`).join("");

    grid.querySelectorAll(".note-content").forEach(ta => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    });

    attachEvents();
  };

  const attachEvents = () => {
    const grid = document.getElementById("notes-grid");
    if (!grid) return;

    grid.querySelectorAll(".note-title").forEach(inp => {
      inp.addEventListener("input", () => scheduleAutosave(inp.dataset.id));
    });

    grid.querySelectorAll(".note-content").forEach(ta => {
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
        scheduleAutosave(ta.dataset.id);
      });
    });

    grid.querySelectorAll(".note-color-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        const { id, color } = dot.dataset;
        const notes = loadNotes();
        const note  = notes.find(n => n.id === id);
        if (!note) return;
        note.color = color;
        note.updatedAt = new Date().toISOString();
        saveNotes(notes);
        const card = grid.querySelector(`.note-card[data-id="${id}"]`);
        if (card) {
          card.style.setProperty("--note-color", color);
          card.querySelectorAll(".note-color-dot").forEach(d => d.classList.toggle("active", d.dataset.color === color));
          const ts = card.querySelector(".note-timestamp");
          if (ts) ts.textContent = fmtDate(note.updatedAt);
        }
      });
    });

    grid.querySelectorAll(".note-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const id   = btn.dataset.id;
        const card = grid.querySelector(`.note-card[data-id="${id}"]`);
        if (!card) return;
        card.classList.add("removing");
        card.addEventListener("animationend", () => {
          saveNotes(loadNotes().filter(n => n.id !== id));
          renderGrid();
        }, { once: true });
      });
    });
  };

  const scheduleAutosave = (id) => {
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => {
      const grid = document.getElementById("notes-grid");
      if (!grid) return;
      const titleEl   = grid.querySelector(`.note-title[data-id="${id}"]`);
      const contentEl = grid.querySelector(`.note-content[data-id="${id}"]`);
      if (!titleEl || !contentEl) return;
      const notes = loadNotes();
      const note  = notes.find(n => n.id === id);
      if (!note) return;
      note.title     = titleEl.value;
      note.content   = contentEl.value;
      note.updatedAt = new Date().toISOString();
      saveNotes(notes);
      const ts = grid.querySelector(`.note-card[data-id="${id}"] .note-timestamp`);
      if (ts) ts.textContent = fmtDate(note.updatedAt);
    }, 900);
  };

  root.innerHTML = `
    <div class="notes-header">
      <div>
        <div class="notes-title">Anotações</div>
        <div class="notes-subtitle">Salvas localmente neste navegador</div>
      </div>
      <button class="notes-btn-new" id="btn-nova-nota">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova nota
      </button>
    </div>
    <div class="notes-grid" id="notes-grid"></div>
  `;

  renderGrid();

  document.getElementById("btn-nova-nota").addEventListener("click", () => {
    const notes = loadNotes();
    notes.unshift(newNote());
    saveNotes(notes);
    renderGrid();
    setTimeout(() => {
      document.getElementById("notes-grid")?.querySelector(".note-title")?.focus();
    }, 60);
  });
}

// ══ MODAIS ════════════════════════════════════════════════════════════════════
function abrirModalNovaInst() {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${svgInst()}</div>
      <div><h2>Nova Instituição</h2><p>Cria a conta de acesso e o registro</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tv-modal-body">
      <label class="tv-label">Nome <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-nome" placeholder="Ex: Escola Estadual João Silva" autocomplete="off"/>
      <label class="tv-label">E-mail de acesso <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-email" type="email" placeholder="escola@email.com" autocomplete="off"/>
      <label class="tv-label">Senha inicial <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-senha" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
      <div class="tv-modal-err" id="modal-err"></div>
    </div>
    <div class="tv-modal-foot">
      <button class="tv-btn-ghost" id="modal-cancel">Cancelar</button>
      <button class="tv-btn-add" id="modal-ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Criar
      </button>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-x").addEventListener("click", fechar);
  overlay.querySelector("#modal-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });
  overlay.querySelector("#inst-nome").focus();

  overlay.querySelector("#modal-ok").addEventListener("click", async () => {
    const err   = overlay.querySelector("#modal-err");
    const btn   = overlay.querySelector("#modal-ok");
    const nome  = overlay.querySelector("#inst-nome").value.trim();
    const email = overlay.querySelector("#inst-email").value.trim();
    const senha = overlay.querySelector("#inst-senha").value;

    err.textContent = "";
    if (!nome)            { err.textContent = "Informe o nome.";   return; }
    if (!email)           { err.textContent = "Informe o e-mail."; return; }
    if (senha.length < 8) { err.textContent = "Senha mínimo 8 caracteres."; return; }

    btn.disabled = true; btn.textContent = "Criando…";

    const { data: instData, error: instErr } = await supabase
      .from("instituicoes").insert({ nome }).select("id").single();

    if (instErr) {
      err.textContent = instErr.code === "23505" ? "Nome já existe." : instErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email, password: senha, email_confirm: true,
      user_metadata: { role: "instituicao", nome },
    });

    if (userErr) {
      await supabaseAdmin.from("instituicoes").delete().eq("id", instData.id);
      err.textContent = userErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    await supabaseAdmin.from("profiles")
      .update({ instituicao_id: instData.id })
      .eq("id", userData.user.id);

    fechar();
    showToast(`"${nome}" criada!`, "success");
    await renderInstituicoes();
  });
}

function abrirModalResetSenha(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${svgInst()}</div>
      <div><h2>Redefinir Senha</h2><p>${esc(instNome)}</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tv-modal-body">
      <label class="tv-label">Nova senha <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="nova-senha" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
      <div class="tv-modal-err" id="modal-err"></div>
    </div>
    <div class="tv-modal-foot">
      <button class="tv-btn-ghost" id="modal-cancel">Cancelar</button>
      <button class="tv-btn-add" id="modal-ok">Salvar</button>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-x").addEventListener("click", fechar);
  overlay.querySelector("#modal-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  overlay.querySelector("#nova-senha").focus();

  overlay.querySelector("#modal-ok").addEventListener("click", async () => {
    const err   = overlay.querySelector("#modal-err");
    const btn   = overlay.querySelector("#modal-ok");
    const senha = overlay.querySelector("#nova-senha").value;
    if (senha.length < 8) { err.textContent = "Mínimo 8 caracteres."; return; }

    btn.disabled = true; btn.textContent = "Salvando…";

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("id")
      .eq("instituicao_id", instId).eq("role", "instituicao").single();

    if (!profile) { err.textContent = "Usuário não encontrado."; btn.disabled = false; btn.textContent = "Salvar"; return; }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: senha });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = "Salvar"; return; }

    fechar();
    showToast("Senha redefinida!", "success");
  });
}

function confirmarExcluir(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-body" style="padding:32px 24px;text-align:center">
      <div style="width:52px;height:52px;border-radius:14px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </div>
      <h3 style="font-size:1.05rem;font-weight:700;color:var(--text);margin-bottom:8px">Excluir instituição?</h3>
      <p style="font-size:.875rem;color:var(--text-2);line-height:1.6;max-width:280px;margin:0 auto 24px">
        Remove <strong>${esc(instNome)}</strong> e todos os dados vinculados. Irreversível.
      </p>
      <div style="display:flex;gap:10px">
        <button class="tv-btn-ghost" id="m-cancel" style="flex:1">Cancelar</button>
        <button id="m-ok" style="flex:1;padding:10px;border:none;border-radius:9px;background:var(--red);color:white;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit">Excluir</button>
      </div>
      <div class="tv-modal-err" id="modal-err" style="margin-top:10px"></div>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#m-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });

  overlay.querySelector("#m-ok").addEventListener("click", async () => {
    const btn = overlay.querySelector("#m-ok");
    const err = overlay.querySelector("#modal-err");
    btn.disabled = true; btn.textContent = "Excluindo…";

    try {
      // 1. Busca os ids das turmas para poder deletar chamadas/presencas
      const { data: turmas } = await supabaseAdmin
        .from("turmas").select("id").eq("instituicao_id", instId);
      const turmaIds = (turmas ?? []).map(t => t.id);

      // 2. Deleta presenças das chamadas dessas turmas
      if (turmaIds.length > 0) {
        const { data: chs } = await supabaseAdmin
          .from("chamadas").select("id").in("turma_id", turmaIds);
        const chamadaIds = (chs ?? []).map(c => c.id);
        if (chamadaIds.length > 0) {
          await supabaseAdmin.from("presencas").delete().in("chamada_id", chamadaIds);
        }
        // 3. Deleta chamadas
        await supabaseAdmin.from("chamadas").delete().in("turma_id", turmaIds);
      }

      // 4. Deleta alunos (FK RESTRICT em turma_id e instituicao_id)
      await supabaseAdmin.from("alunos").delete().eq("instituicao_id", instId);

      // 5. Deleta turmas (FK RESTRICT em instituicao_id)
      await supabaseAdmin.from("turmas").delete().eq("instituicao_id", instId);

      // 6. Deleta o usuário auth da instituição
      const { data: prof } = await supabaseAdmin
        .from("profiles").select("id").eq("instituicao_id", instId).eq("role", "instituicao").single();
      if (prof) await supabaseAdmin.auth.admin.deleteUser(prof.id);

      // 7. Deleta a instituição
      const { error } = await supabaseAdmin.from("instituicoes").delete().eq("id", instId);
      if (error) throw error;

      fechar();
      showToast(`"${instNome}" excluída.`, "success");
      setActive("nav-instituicoes");
      await renderInstituicoes();
    } catch (e) {
      err.textContent = "Erro: " + (e.message ?? e);
      btn.disabled = false; btn.textContent = "Excluir";
    }
  });
}

// ── Modal de detalhe de feedback (Suporte) ────────────────────────────────────
function abrirModalFeedback(p, tipoLabel, fmtData) {
  const statusLabel = { aberto: "Aberto", em_analise: "Em análise", resolvido: "Resolvido" };
  const overlay = document.createElement("div");
  overlay.className = "tv-modal-overlay";
  overlay.innerHTML = `
    <div class="tv-modal-card" style="max-width:520px">
      <div class="tv-modal-head">
        <div class="tv-modal-icon inst" style="background:#eff6ff;color:#2563eb">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <h2 style="font-size:1rem;font-weight:800;color:var(--text);line-height:1.2">${esc(p.titulo)}</h2>
          <div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">
            <span style="font-size:.7rem;font-weight:700;color:var(--text-2)">${esc(p.instituicoes?.nome || "—")}</span>
            <span class="kanban-tipo-pill ${p.tipo}" style="font-size:.6rem">${tipoLabel[p.tipo] ?? p.tipo}</span>
            <span class="kanban-expand-status ${p.status}" style="font-size:.6rem">${statusLabel[p.status] || p.status}</span>
          </div>
        </div>
        <button class="tv-modal-x" id="kfb-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="tv-modal-body" style="gap:14px">
        <div>
          <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">Descrição</div>
          <div style="font-size:.875rem;color:var(--text-2);line-height:1.7;white-space:pre-wrap;background:var(--surface-2);border-radius:9px;padding:14px 16px;min-height:60px">${esc(p.descricao) || "<em style='opacity:.5'>Sem descrição</em>"}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:.72rem;color:var(--text-3)">
          <span>Enviado em ${fmtData(p.criado_em)}</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("open"), 10);
  const fechar = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector("#kfb-x").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function criarOverlay(html) {
  const o = document.createElement("div");
  o.className = "tv-modal-overlay";
  o.innerHTML = `<div class="tv-modal-card">${html}</div>`;
  document.body.appendChild(o);
  setTimeout(() => o.classList.add("open"), 10);
  return o;
}

function svgInst()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`; }
function svgProf()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgQr()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgTurma() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }

init();
