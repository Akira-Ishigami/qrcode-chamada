import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";
import * as XLSX         from "xlsx";

// ── State ─────────────────────────────────────────────────────────────────────
let _turmas   = [];
let _turmaMap = {};
let _chamadas = []; // enriquecidas: {id, turma_id, data, aberta, turma, presentes, atrasados, total, freq}
let _presencas = []; // {chamada_id, aluno_id, atrasado}
let _alunos   = []; // {id, nome, matricula, turma_id}
let _profile  = null;
let _instNome = "";
let _tab      = "professores"; // "professores" | "alunos" | "turmas" | "resumo"
let _relChannel = null;

const root = document.getElementById("page-root");

// ── Helpers ───────────────────────────────────────────────────────────────────
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const pct  = (n, t) => t > 0 ? Math.round(n / t * 100) : 0;
const clrPct = v => v >= 75 ? "green" : v >= 50 ? "orange" : "red";

function fmtData(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday:"long", day:"numeric", month:"long", year:"numeric"
  });
}
function fmtDataCurta(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    day:"2-digit", month:"2-digit", year:"numeric"
  });
}
function fmtDuracao(seg) {
  if (!seg) return "—";
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ""}`;
  return `${m}min`;
}
// Dropdown custom para o <select> nativo (mesmo padrão usado em horários/calendário)
function enhanceSelect(sel) {
  if (!sel || sel.dataset.cdd === "1") return;
  sel.dataset.cdd = "1";
  sel.style.display = "none";
  const wrap = document.createElement("div");
  wrap.className = "cdd";
  sel.insertAdjacentElement("afterend", wrap);
  wrap.innerHTML = `
    <button type="button" class="cdd-trigger">
      <span class="cdd-val"></span>
      <svg class="cdd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="cdd-panel" role="listbox"></div>`;
  const trigger = wrap.querySelector(".cdd-trigger");
  const panel   = wrap.querySelector(".cdd-panel");
  const valEl   = wrap.querySelector(".cdd-val");
  const close = () => wrap.classList.remove("open");
  const rebuild = () => {
    valEl.textContent = sel.options[sel.selectedIndex]?.textContent || "";
    panel.innerHTML = [...sel.options].map(o => `
      <button type="button" class="cdd-opt${o.value === sel.value ? " on" : ""}" data-v="${esc(o.value)}">
        <span class="cdd-opt-txt">${esc(o.textContent)}</span>
        <svg class="cdd-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
      </button>`).join("");
    panel.querySelectorAll(".cdd-opt").forEach(b => b.addEventListener("click", () => {
      sel.value = b.dataset.v; rebuild(); close();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }));
  };
  trigger.addEventListener("click", () => wrap.classList.toggle("open"));
  document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });
  sel.cddRebuild = rebuild;
  rebuild();
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Auth & Init ───────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }
  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("id, role, nome, instituicao_id")
    .eq("id", session.user.id).single();

  if (!profile || profile.role === "admin") { window.location.href = "/dashboard.html"; return; }
  _profile = profile;

  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando dados…</div>`;

  // Carrega turmas
  let turmasQ = supabaseAdmin.from("turmas")
    .select("id, nome, materia, professor, instituicao_id, instituicoes(nome)").order("nome");

  if (profile.role === "professor") {
    const { data: porId } = await supabaseAdmin.from("turmas")
      .select("id, nome, materia, professor, instituicao_id, instituicoes(nome)")
      .eq("professor_id", profile.id).order("nome");
    if (porId?.length) {
      _turmas = porId;
    } else {
      const { data: porNome } = await turmasQ.eq("professor", profile.nome);
      _turmas = porNome ?? [];
    }
  } else {
    const { data } = await turmasQ.eq("instituicao_id", profile.instituicao_id);
    _turmas = data ?? [];
  }

  // Professor pode não estar vinculado a nenhuma turma (turmas sem professor_id),
  // mas ainda ter chamadas próprias — loadAll descobre as turmas pelas chamadas.
  if (!_turmas.length && profile.role !== "professor") {
    root.innerHTML = `
      <div class="hist-header"><div class="hist-eyebrow">Relatório</div><div class="hist-title">Histórico de Chamadas</div></div>
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="48" height="48" style="opacity:.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Nenhuma turma encontrada.</p>
      </div>`;
    return;
  }

  _turmaMap = {};
  _turmas.forEach(t => { _turmaMap[t.id] = t; });
  _instNome = _turmas[0]?.instituicoes?.nome || profile.nome || "";

  await loadAll();
  renderShell();
  iniciarRealtime();
}

// ── Realtime: atualiza o relatório a cada alteração de chamada/presença ────────
function iniciarRealtime() {
  if (_relChannel) supabase.removeChannel(_relChannel);

  let timer;
  const agendarRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(refreshDados, 400); // debounce p/ agrupar mudanças em rajada
  };

  _relChannel = supabase
    .channel("relatorio-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "chamadas"  }, agendarRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "presencas" }, agendarRefresh)
    .subscribe();
}

// Recarrega dados e re-renderiza preservando filtros e aba ativa
async function refreshDados() {
  await loadAll();

  const totalCham = _chamadas.length;
  const totalPres = _chamadas.reduce((s, c) => s + c.presentes, 0);
  const totalAlun = _chamadas.reduce((s, c) => s + c.total, 0);
  const mediaFreq = pct(totalPres, totalAlun);

  const elC = document.getElementById("stat-cham");
  const elP = document.getElementById("stat-pres");
  const elF = document.getElementById("stat-freq");
  if (elC) elC.textContent = totalCham;
  if (elP) elP.textContent = totalPres;
  if (elF) {
    elF.textContent = `${mediaFreq}%`;
    elF.className = `hist-stat-num ${clrPct(mediaFreq)}`;
    const elFIcon = elF.closest(".hist-stat-pill")?.querySelector(".hist-stat-icon");
    if (elFIcon) elFIcon.className = `hist-stat-icon ${clrPct(mediaFreq)}`;
  }

  if (document.getElementById("rel-content")) renderContent();
}

// ── Carrega todos os dados ────────────────────────────────────────────────────
async function loadAll() {
  let allChamadas;
  let turmaIds;

  if (_profile?.role === "professor") {
    // Professor: parte das chamadas que ELE abriu (independe do vínculo da turma)
    const { data } = await supabaseAdmin
      .from("chamadas").select("id, turma_id, data, aberta, duracao_seg, professor_id, profiles(nome, foto_url)")
      .eq("professor_id", _profile.id).order("data", { ascending: false });
    allChamadas = data ?? [];
    turmaIds = [...new Set(allChamadas.map(c => c.turma_id))];

    // Garante que as turmas dessas chamadas estejam no mapa (nome + dropdown)
    const faltando = turmaIds.filter(id => id && !_turmaMap[id]);
    if (faltando.length) {
      const { data: extra } = await supabaseAdmin.from("turmas")
        .select("id, nome, materia, professor, instituicao_id, instituicoes(nome)")
        .in("id", faltando);
      (extra ?? []).forEach(t => {
        if (!_turmaMap[t.id]) { _turmas.push(t); _turmaMap[t.id] = t; }
      });
    }
  } else {
    // Instituição: todas as chamadas das turmas da instituição
    turmaIds = _turmas.map(t => t.id);
    const { data } = await supabaseAdmin
      .from("chamadas").select("id, turma_id, data, aberta, duracao_seg, professor_id, profiles(nome, foto_url)")
      .in("turma_id", turmaIds).order("data", { ascending: false });
    allChamadas = data ?? [];
  }

  const chamadaIds = allChamadas.map(c => c.id);

  const [presRes, aluRes] = await Promise.all([
    chamadaIds.length
      ? supabaseAdmin.from("presencas").select("chamada_id, aluno_id, atrasado, registrado_em").in("chamada_id", chamadaIds)
      : { data: [] },
    supabaseAdmin.from("alunos").select("id, nome, matricula, turma_id, foto_url").in("turma_id", turmaIds).order("nome"),
  ]);

  _presencas = presRes.data ?? [];
  _alunos    = aluRes.data  ?? [];

  // Mapas para cálculo eficiente
  const presMap   = {}; // chamada_id → Set<aluno_id>
  const atrasMap  = {}; // chamada_id → Set<aluno_id>
  _presencas.forEach(p => {
    (presMap[p.chamada_id]  ??= new Set()).add(p.aluno_id);
    if (p.atrasado) (atrasMap[p.chamada_id] ??= new Set()).add(p.aluno_id);
  });

  const totalPorTurma = {};
  _alunos.forEach(a => { totalPorTurma[a.turma_id] = (totalPorTurma[a.turma_id] ?? 0) + 1; });

  _chamadas = allChamadas.map(c => {
    const totalP   = presMap[c.id]?.size  ?? 0;
    const totalAt  = atrasMap[c.id]?.size ?? 0;
    const totalAlunos = totalPorTurma[c.turma_id] ?? 0;
    return {
      ...c,
      turma:        _turmaMap[c.turma_id],
      professor:    c.profiles?.nome ?? "",
      professorFoto: c.profiles?.foto_url ?? null,
      presentes: totalP,
      atrasados: totalAt,
      ausentes:  totalAlunos - totalP,
      total:     totalAlunos,
      freq:      pct(totalP, totalAlunos),
    };
  });
}

// ── Shell UI ──────────────────────────────────────────────────────────────────
function renderShell() {
  const totalCham = _chamadas.length;
  const totalPres = _chamadas.reduce((s, c) => s + c.presentes, 0);
  const totalAlun = _chamadas.reduce((s, c) => s + c.total, 0);
  const mediaFreq = pct(totalPres, totalAlun);

  root.innerHTML = `
    <div class="hist-header">
      <div class="hist-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 3v18h18"/><path d="M18.7 8 13 13.7l-3-3L7 13.7"/></svg>
      </div>
      <div>
        <div class="hist-eyebrow">Relatório</div>
        <div class="hist-title">Histórico de Chamadas</div>
        <div class="hist-sub">${esc(_instNome)}</div>
      </div>
    </div>

    <div class="hist-stats-bar">
      <div class="hist-stat-pill">
        <div class="hist-stat-icon blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="hist-stat-text">
          <span class="hist-stat-num" id="stat-cham">${totalCham}</span>
          <span class="hist-stat-lbl">chamadas</span>
        </div>
      </div>
      <div class="hist-stat-sep"></div>
      <div class="hist-stat-pill">
        <div class="hist-stat-icon green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="hist-stat-text">
          <span class="hist-stat-num green" id="stat-pres">${totalPres}</span>
          <span class="hist-stat-lbl">presenças totais</span>
        </div>
      </div>
      <div class="hist-stat-sep"></div>
      <div class="hist-stat-pill">
        <div class="hist-stat-icon ${clrPct(mediaFreq)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div class="hist-stat-text">
          <span class="hist-stat-num ${clrPct(mediaFreq)}" id="stat-freq">${mediaFreq}%</span>
          <span class="hist-stat-lbl">frequência média</span>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="rel-tabs">
      <button class="rel-tab active" data-tab="professores">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Por Professor
      </button>
      <button class="rel-tab" data-tab="alunos">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Por Aluno
      </button>
      <button class="rel-tab" data-tab="turmas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Por Turma
      </button>
      <button class="rel-tab" data-tab="resumo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
        Resumo
      </button>
    </div>

    <!-- Filtros -->
    <div class="rel-filter-bar">
      <div class="rel-filter-left">
        <div class="rel-filter-group" id="fg-turma">
          <label class="rel-filter-label">Turma</label>
          <select class="rel-select" id="filt-turma">
            <option value="">Todas as turmas</option>
            ${_turmas.map(t => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join("")}
          </select>
        </div>
        <div class="rel-filter-group">
          <label class="rel-filter-label">De</label>
          <input type="date" class="rel-input" id="filt-de" />
        </div>
        <div class="rel-filter-group">
          <label class="rel-filter-label">Até</label>
          <input type="date" class="rel-input" id="filt-ate" />
        </div>
        <div class="rel-filter-group" id="fg-prof" style="${_tab === "professores" ? "" : "display:none"}">
          <label class="rel-filter-label">Buscar professor</label>
          <input type="search" class="rel-input" id="filt-prof" placeholder="Nome do professor…" style="min-width:180px" />
        </div>
        <div class="rel-filter-group" id="fg-aluno" style="display:none">
          <label class="rel-filter-label">Buscar aluno</label>
          <input type="search" class="rel-input" id="filt-aluno" placeholder="Nome ou matrícula…" style="min-width:180px" />
        </div>
      </div>
      <div class="rel-filter-actions">
        <button class="rel-btn-clear" id="btn-clear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Limpar
        </button>
        <button class="rel-btn-download" id="btn-download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Baixar .xlsx
        </button>
      </div>
    </div>

    <div id="rel-content"></div>
  `;

  // Eventos tabs
  root.querySelectorAll(".rel-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".rel-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _tab = btn.dataset.tab;
      document.getElementById("fg-aluno").style.display = _tab === "alunos" ? "" : "none";
      document.getElementById("fg-prof").style.display  = _tab === "professores" ? "" : "none";
      renderContent();
    });
  });

  // Dropdown custom pra turma
  enhanceSelect(document.getElementById("filt-turma"));

  // Eventos filtros
  ["filt-turma","filt-de","filt-ate","filt-aluno","filt-prof"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", renderContent);
    document.getElementById(id)?.addEventListener("change", renderContent);
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    ["filt-turma","filt-de","filt-ate","filt-aluno","filt-prof"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("filt-turma")?.cddRebuild?.();
    renderContent();
  });

  document.getElementById("btn-download").addEventListener("click", baixar);

  renderContent();
}

// ── Filtros ativos ────────────────────────────────────────────────────────────
function getFiltros() {
  return {
    turmaId: document.getElementById("filt-turma")?.value || "",
    de:      document.getElementById("filt-de")?.value || "",
    ate:     document.getElementById("filt-ate")?.value || "",
    aluno:   document.getElementById("filt-aluno")?.value.toLowerCase().trim() || "",
    prof:    document.getElementById("filt-prof")?.value.toLowerCase().trim() || "",
  };
}

function chamadasFiltradas(f) {
  return _chamadas.filter(c => {
    if (f.turmaId && c.turma_id !== f.turmaId) return false;
    if (f.de  && c.data < f.de)  return false;
    if (f.ate && c.data > f.ate) return false;
    return true;
  });
}

// ── Render dispatcher ─────────────────────────────────────────────────────────
function renderContent() {
  const f = getFiltros();
  if (_tab === "professores") renderPorProfessor(f);
  else if (_tab === "alunos") renderPorAluno(f);
  else if (_tab === "turmas") renderPorTurma(f);
  else renderResumoGeral(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: POR PROFESSOR
// ─────────────────────────────────────────────────────────────────────────────
function renderPorProfessor(f) {
  const content  = document.getElementById("rel-content");
  const filtered = chamadasFiltradas(f);

  if (!filtered.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <p>Nenhuma chamada encontrada.</p>
      </div>`;
    return;
  }

  const porProf = {};
  filtered.forEach(c => {
    const key = c.professor_id || c.professor || "—";
    if (!porProf[key]) porProf[key] = { nome: c.professor || "Sem professor", foto: c.professorFoto, chamadas: [] };
    porProf[key].chamadas.push(c);
  });
  let profsSorted = Object.values(porProf).sort((a, b) => a.nome.localeCompare(b.nome));
  if (f.prof) profsSorted = profsSorted.filter(p => p.nome.toLowerCase().includes(f.prof));

  if (!profsSorted.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <p>Nenhum professor encontrado.</p>
      </div>`;
    return;
  }

  content.innerHTML = `<div class="rel-aluno-grid" id="prof-grid"></div>`;
  const grid = document.getElementById("prof-grid");

  profsSorted.forEach((p, idx) => {
    const totalCh   = p.chamadas.length;
    const presN     = p.chamadas.reduce((s, c) => s + c.presentes, 0);
    const atrasN    = p.chamadas.reduce((s, c) => s + c.atrasados, 0);
    const alunosN   = p.chamadas.reduce((s, c) => s + c.total, 0);
    const ausN      = Math.max(0, alunosN - presN);
    const freqN     = pct(presN, alunosN);
    const turmasSet = new Set(p.chamadas.map(c => c.turma?.nome || "—"));
    const ini       = p.nome.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();

    const card = document.createElement("div");
    card.className = "rel-aluno-card";
    card.style.animationDelay = `${idx * .025}s`;
    card.innerHTML = `
      <div class="rel-aluno-card-head" tabindex="0">
        <div class="rel-aluno-avatar">${p.foto ? `<img src="${esc(p.foto)}" alt="" />` : esc(ini || "?")}</div>
        <div class="rel-aluno-info">
          <div class="rel-aluno-nome">${esc(p.nome)}</div>
          <div class="rel-aluno-meta">${turmasSet.size} turma${turmasSet.size !== 1 ? "s" : ""} · ${totalCh} chamada${totalCh !== 1 ? "s" : ""}</div>
        </div>
        <div class="rel-aluno-stats">
          <div class="rel-aluno-freq ${clrPct(freqN)}">${freqN}%</div>
          <div class="rel-aluno-chips">
            <span class="hist-chip green" title="Presentes">${presN}</span>
            ${atrasN > 0 ? `<span class="hist-chip orange" title="Atrasados">${atrasN}</span>` : ""}
            <span class="hist-chip red" title="Ausentes">${ausN}</span>
          </div>
        </div>
        <div class="hist-row-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>`;

    const head = card.querySelector(".rel-aluno-card-head");
    head.addEventListener("click",   () => abrirModalProfessor(p));
    head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") abrirModalProfessor(p); });
    grid.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: detalhe de uma chamada (presentes × ausentes, com horário de scan)
// ─────────────────────────────────────────────────────────────────────────────
function montarDetalheChamadaHtml(c) {
  const chamadaPresIds = new Set(
    _presencas.filter(p => p.chamada_id === c.id).map(p => p.aluno_id)
  );
  const chamadaAtrasIds = new Set(
    _presencas.filter(p => p.chamada_id === c.id && p.atrasado).map(p => p.aluno_id)
  );
  const horaScan = {};
  _presencas.filter(p => p.chamada_id === c.id).forEach(p => { horaScan[p.aluno_id] = p.registrado_em; });
  const fmtHora = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

  const turmaAlunos = _alunos.filter(a => a.turma_id === c.turma_id);
  const presLista   = turmaAlunos.filter(a => chamadaPresIds.has(a.id) && !chamadaAtrasIds.has(a.id));
  const atrasLista  = turmaAlunos.filter(a => chamadaAtrasIds.has(a.id));
  const ausLista    = turmaAlunos.filter(a => !chamadaPresIds.has(a.id));

  const alunoRow = (a, i, tipo) => {
    const hora = fmtHora(horaScan[a.id]);
    return `
    <div class="hist-detail-aluno" style="animation-delay:${i * .02}s">
      <span class="hist-detail-num">${i + 1}</span>
      <span class="hist-detail-nome">${esc(a.nome)}</span>
      ${a.matricula ? `<span class="hist-detail-mat">${esc(a.matricula)}</span>` : ""}
      ${hora ? `<span style="font-size:.58rem;font-weight:600;color:#64748b;margin-left:auto">🕐 ${hora}</span>` : ""}
      ${tipo === "atrasado" ? `<span style="font-size:.58rem;font-weight:700;background:#fff7ed;color:#c2410c;border-radius:20px;padding:2px 7px;border:1px solid #fed7aa">Atrasado</span>` : ""}
    </div>`;
  };

  return `
    <div class="hist-detail-inner">
      <div class="hist-detail-col">
        <div class="hist-detail-col-head green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
          Presentes (${presLista.length + atrasLista.length})
        </div>
        ${!presLista.length && !atrasLista.length
          ? `<div class="hist-detail-none">Nenhum presente</div>`
          : [...presLista.map((a, i) => alunoRow(a, i, "presente")),
             ...atrasLista.map((a, i) => alunoRow(a, presLista.length + i, "atrasado"))].join("")}
      </div>
      <div class="hist-detail-col">
        <div class="hist-detail-col-head red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Ausentes (${ausLista.length})
        </div>
        ${!ausLista.length
          ? `<div class="hist-detail-none">Nenhum ausente</div>`
          : ausLista.map((a, i) => alunoRow(a, i, "ausente")).join("")}
      </div>
    </div>`;
}

function abrirModalChamadaDetalhe(c) {
  abrirModalGenerico(`${esc(c.turma?.nome || "—")} — ${fmtData(c.data)}`, montarDetalheChamadaHtml(c));
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal genérico (reaproveitado por chamada/professor/aluno)
// ─────────────────────────────────────────────────────────────────────────────
function abrirModalGenerico(titulo, bodyHtml, maxWidth = 560) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay open";
  overlay.innerHTML = `
    <div class="modal" style="width:92vw;max-width:${maxWidth}px;max-height:84vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>${titulo}</h2>
        <button class="close-btn" id="rel-modal-close">✕</button>
      </div>
      <div style="overflow:auto;flex:1">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(overlay);

  const fechar = () => overlay.remove();
  overlay.querySelector("#rel-modal-close").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });
  return overlay;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: detalhe de um professor (chamadas dadas no período)
// ─────────────────────────────────────────────────────────────────────────────
function abrirModalProfessor(p) {
  const totalCh = p.chamadas.length;
  const presN   = p.chamadas.reduce((s, c) => s + c.presentes, 0);
  const atrasN  = p.chamadas.reduce((s, c) => s + c.atrasados, 0);
  const alunosN = p.chamadas.reduce((s, c) => s + c.total, 0);
  const ausN    = Math.max(0, alunosN - presN);
  const freqN   = pct(presN, alunosN);
  const turmasSet = new Set(p.chamadas.map(c => c.turma?.nome || "—"));

  const body = `
    <div style="padding:16px">
      <div class="rel-resumo-header" style="margin-bottom:14px">
        <div class="rel-resumo-stat"><div class="rel-resumo-num">${turmasSet.size}</div><div class="rel-resumo-lbl">turmas</div></div>
        <div class="rel-resumo-stat"><div class="rel-resumo-num">${totalCh}</div><div class="rel-resumo-lbl">chamadas</div></div>
        <div class="rel-resumo-stat"><div class="rel-resumo-num ${clrPct(freqN)}">${freqN}%</div><div class="rel-resumo-lbl">frequência</div></div>
      </div>
      <div style="overflow-x:auto">
        <table class="rel-aluno-table compact">
          <thead><tr><th>Data</th><th>Turma</th><th>Dur.</th><th>Pres.</th><th>Aus.</th><th>Freq</th></tr></thead>
          <tbody>
            ${p.chamadas.slice().sort((a, b) => b.data.localeCompare(a.data)).map(c => `
              <tr data-cid="${c.id}" style="cursor:pointer" title="Ver detalhe da chamada">
                <td>${fmtDataCurta(c.data)}</td>
                <td>${esc(c.turma?.nome || "—")}</td>
                <td>${fmtDuracao(c.duracao_seg)}</td>
                <td>${c.presentes}</td>
                <td>${Math.max(0, c.ausentes)}</td>
                <td><span class="${c.freq >= 75 ? "rel-st-pres" : c.freq >= 50 ? "rel-st-atraso" : "rel-st-aus"}">${c.freq}%</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  const overlay = abrirModalGenerico(esc(p.nome), body, 1200);
  overlay.querySelectorAll("tr[data-cid]").forEach(tr => {
    tr.addEventListener("click", () => {
      const c = p.chamadas.find(x => x.id === tr.dataset.cid);
      if (c) abrirModalChamadaDetalhe(c);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: detalhe de um aluno (chamadas da turma no período)
// ─────────────────────────────────────────────────────────────────────────────
function abrirModalAluno(aluno, turma, chamadasDaTurma, presMap, atrasMap) {
  const totalCh = chamadasDaTurma.length;
  const presN   = presMap[aluno.id]?.size ?? 0;
  const atrasN  = atrasMap[aluno.id]?.size ?? 0;
  const ausN    = Math.max(0, totalCh - presN);
  const freqN   = pct(presN, totalCh);

  const body = `
    <div style="padding:16px">
      <div class="rel-resumo-header" style="margin-bottom:14px">
        <div class="rel-resumo-stat"><div class="rel-resumo-num">${totalCh}</div><div class="rel-resumo-lbl">chamadas</div></div>
        <div class="rel-resumo-stat"><div class="rel-resumo-num" style="color:#16a34a">${presN}</div><div class="rel-resumo-lbl">presentes</div></div>
        <div class="rel-resumo-stat"><div class="rel-resumo-num" style="color:#dc2626">${ausN}</div><div class="rel-resumo-lbl">ausentes</div></div>
        <div class="rel-resumo-stat"><div class="rel-resumo-num ${clrPct(freqN)}">${freqN}%</div><div class="rel-resumo-lbl">frequência</div></div>
      </div>
      ${totalCh === 0
        ? `<div class="hist-detail-empty">Nenhuma chamada no período.</div>`
        : `<table class="rel-aluno-table">
            <thead><tr><th>Data</th><th>Turma</th><th>Hora</th><th>Status</th></tr></thead>
            <tbody>
              ${chamadasDaTurma.map(c => {
                const isP = presMap[aluno.id]?.has(c.id);
                const isA = atrasMap[aluno.id]?.has(c.id);
                const cls = isA ? "rel-st-atraso" : isP ? "rel-st-pres" : "rel-st-aus";
                const lbl = isA ? "Atrasado" : isP ? "Presente" : "Ausente";
                const scan = _presencas.find(x => x.chamada_id === c.id && x.aluno_id === aluno.id)?.registrado_em;
                const hora = scan ? new Date(scan).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
                return `<tr>
                  <td>${fmtDataCurta(c.data)}</td>
                  <td>${esc(c.turma?.nome || "—")}</td>
                  <td>${hora}</td>
                  <td><span class="${cls}">${lbl}</span></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>`}
    </div>`;

  abrirModalGenerico(`${esc(aluno.nome)}${turma?.nome ? ` — ${esc(turma.nome)}` : ""}`, body);
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: POR ALUNO
// ─────────────────────────────────────────────────────────────────────────────
function renderPorAluno(f) {
  const content  = document.getElementById("rel-content");
  const filtered = chamadasFiltradas(f);

  // Alunos filtrados por turma
  const alunosFilt = f.turmaId
    ? _alunos.filter(a => a.turma_id === f.turmaId)
    : _alunos;

  // Busca por nome/matrícula
  const alunosBusca = f.aluno
    ? alunosFilt.filter(a =>
        a.nome.toLowerCase().includes(f.aluno) ||
        (a.matricula || "").toLowerCase().includes(f.aluno))
    : alunosFilt;

  if (!alunosBusca.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        <p>Nenhum aluno encontrado.</p>
      </div>`;
    return;
  }

  // Para cada aluno: calcula presença no período filtrado
  const chamadaSet = new Set(filtered.map(c => c.id));
  const presMap    = {};
  const atrasMap   = {};
  _presencas.forEach(p => {
    if (!chamadaSet.has(p.chamada_id)) return;
    (presMap[p.aluno_id] ??= new Set()).add(p.chamada_id);
    if (p.atrasado) (atrasMap[p.aluno_id] ??= new Set()).add(p.chamada_id);
  });

  // Map: turma_id → chamadas filtradas
  const chamsPorTurma = {};
  filtered.forEach(c => { (chamsPorTurma[c.turma_id] ??= []).push(c); });

  content.innerHTML = `
    <div class="rel-aluno-grid" id="aluno-grid"></div>`;

  const grid = document.getElementById("aluno-grid");

  alunosBusca.forEach((aluno, idx) => {
    const turma = _turmaMap[aluno.turma_id];
    const chamadasDaTurma = chamsPorTurma[aluno.turma_id] ?? [];
    const totalCh = chamadasDaTurma.length;
    const presN   = presMap[aluno.id]?.size ?? 0;
    const atrasN  = atrasMap[aluno.id]?.size ?? 0;
    const ausN    = totalCh - presN;
    const freqN   = pct(presN, totalCh);
    const ini     = aluno.nome.split(" ").slice(0,2).map(n => n[0]).join("");

    const card = document.createElement("div");
    card.className = "rel-aluno-card";
    card.style.animationDelay = `${idx * .025}s`;
    card.innerHTML = `
      <div class="rel-aluno-card-head" tabindex="0">
        <div class="rel-aluno-avatar">${aluno.foto_url ? `<img src="${esc(aluno.foto_url)}" alt="" />` : esc(ini)}</div>
        <div class="rel-aluno-info">
          <div class="rel-aluno-nome">${esc(aluno.nome)}</div>
          <div class="rel-aluno-meta">${esc(turma?.nome || "")}${aluno.matricula ? ` · ${esc(aluno.matricula)}` : ""}</div>
        </div>
        <div class="rel-aluno-stats">
          <div class="rel-aluno-freq ${clrPct(freqN)}">${freqN}%</div>
          <div class="rel-aluno-chips">
            <span class="hist-chip green" title="Presentes">${presN}</span>
            ${atrasN > 0 ? `<span class="hist-chip orange" title="Atrasados">${atrasN}</span>` : ""}
            <span class="hist-chip red" title="Ausentes">${ausN < 0 ? 0 : ausN}</span>
          </div>
        </div>
        <div class="hist-row-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    `;

    const head = card.querySelector(".rel-aluno-card-head");
    head.addEventListener("click",   () => abrirModalAluno(aluno, turma, chamadasDaTurma, presMap, atrasMap));
    head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") abrirModalAluno(aluno, turma, chamadasDaTurma, presMap, atrasMap); });
    grid.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: POR TURMA
// ─────────────────────────────────────────────────────────────────────────────
function renderPorTurma(f) {
  const content  = document.getElementById("rel-content");
  const filtered = chamadasFiltradas(f);

  if (!filtered.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
        <p>Nenhuma chamada no período selecionado.</p>
      </div>`;
    return;
  }

  // Agrupa por turma
  const porTurma = {};
  filtered.forEach(c => {
    const tid = c.turma_id;
    if (!porTurma[tid]) {
      porTurma[tid] = { turma: c.turma, chamadas: 0, presTotal: 0, atrasTotal: 0, alunosTotal: c.total };
    }
    porTurma[tid].chamadas++;
    porTurma[tid].presTotal += c.presentes;
    porTurma[tid].atrasTotal += c.atrasados;
  });

  const turmasSorted = Object.values(porTurma).sort((a, b) =>
    pct(b.presTotal, b.chamadas * b.alunosTotal) - pct(a.presTotal, a.chamadas * a.alunosTotal)
  );

  const totalGeral    = filtered.length;
  const presGeral     = filtered.reduce((s, c) => s + c.presentes, 0);
  const alunosGeral   = filtered.reduce((s, c) => s + c.total, 0);
  const freqGeral     = pct(presGeral, alunosGeral);

  content.innerHTML = `
    <div class="rel-resumo-header">
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num">${turmasSorted.length}</div>
        <div class="rel-resumo-lbl">turmas</div>
      </div>
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num">${totalGeral}</div>
        <div class="rel-resumo-lbl">chamadas</div>
      </div>
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num ${clrPct(freqGeral)}">${freqGeral}%</div>
        <div class="rel-resumo-lbl">freq. geral</div>
      </div>
    </div>
    <div class="rel-resumo-grid">
      ${turmasSorted.map((r, i) => {
        const f = pct(r.presTotal, r.chamadas * r.alunosTotal);
        const ini = (r.turma?.nome || "?")[0].toUpperCase();
        return `
          <div class="rel-resumo-card" style="animation-delay:${i*.04}s">
            <div class="rel-resumo-card-top">
              <div class="hist-row-avatar" style="width:42px;height:42px;font-size:1.1rem">${esc(ini)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:.9rem;color:var(--text)">${esc(r.turma?.nome || "—")}</div>
                ${r.turma?.professor ? `<div style="font-size:.7rem;color:var(--text-3)">Prof. ${esc(r.turma.professor)}</div>` : ""}
              </div>
              <div class="hist-row-freq ${clrPct(f)}" style="font-size:1.4rem">${f}%</div>
            </div>
            <div class="rel-resumo-bar-wrap">
              <div class="rel-resumo-bar" style="width:${f}%;background:${f>=75?"#16a34a":f>=50?"#ea580c":"#dc2626"}"></div>
            </div>
            <div class="rel-resumo-card-meta">
              <span>${r.chamadas} chamada${r.chamadas!==1?"s":""}</span>
              <span style="color:#16a34a;font-weight:600">${r.presTotal} presente${r.presTotal!==1?"s":""}</span>
              ${r.atrasTotal > 0 ? `<span style="color:#ea580c;font-weight:600">${r.atrasTotal} atrasado${r.atrasTotal!==1?"s":""}</span>` : ""}
              <span style="color:var(--text-3)">${r.alunosTotal} aluno${r.alunosTotal!==1?"s":""}</span>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: RESUMO (visão geral, sem expandir — só números e ranking)
// ─────────────────────────────────────────────────────────────────────────────
function renderResumoGeral(f) {
  const content  = document.getElementById("rel-content");
  const filtered = chamadasFiltradas(f);

  if (!filtered.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
        <p>Nenhuma chamada no período selecionado.</p>
      </div>`;
    return;
  }

  const porTurma = {};
  filtered.forEach(c => {
    const tid = c.turma_id;
    if (!porTurma[tid]) porTurma[tid] = { turma: c.turma, chamadas: 0, presTotal: 0, atrasTotal: 0, alunosTotal: c.total };
    porTurma[tid].chamadas++;
    porTurma[tid].presTotal += c.presentes;
    porTurma[tid].atrasTotal += c.atrasados;
  });
  const turmasSorted = Object.values(porTurma).sort((a, b) =>
    pct(b.presTotal, b.chamadas * b.alunosTotal) - pct(a.presTotal, a.chamadas * a.alunosTotal)
  );

  const totalGeral  = filtered.length;
  const presGeral   = filtered.reduce((s, c) => s + c.presentes, 0);
  const alunosGeral = filtered.reduce((s, c) => s + c.total, 0);
  const freqGeral   = pct(presGeral, alunosGeral);

  content.innerHTML = `
    <div class="rel-resumo-header">
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num">${turmasSorted.length}</div>
        <div class="rel-resumo-lbl">turmas</div>
      </div>
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num">${totalGeral}</div>
        <div class="rel-resumo-lbl">chamadas</div>
      </div>
      <div class="rel-resumo-stat">
        <div class="rel-resumo-num ${clrPct(freqGeral)}">${freqGeral}%</div>
        <div class="rel-resumo-lbl">freq. geral</div>
      </div>
    </div>
    <div class="rel-aluno-card">
      <div style="overflow-x:auto">
      <table class="rel-aluno-table compact">
        <thead><tr><th>Turma</th><th>Professor</th><th>Cham.</th><th>Pres.</th><th>Atr.</th><th>Freq</th></tr></thead>
        <tbody>
          ${turmasSorted.map(r => {
            const fr = pct(r.presTotal, r.chamadas * r.alunosTotal);
            return `<tr>
              <td>${esc(r.turma?.nome || "—")}</td>
              <td>${esc(r.turma?.professor || "—")}</td>
              <td>${r.chamadas}</td>
              <td>${r.presTotal}</td>
              <td>${r.atrasTotal}</td>
              <td><span class="${fr >= 75 ? "rel-st-pres" : fr >= 50 ? "rel-st-atraso" : "rel-st-aus"}">${fr}%</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────
function baixar() {
  if (_tab === "professores") baixarPorProfessor();
  else if (_tab === "alunos") baixarPorAluno();
  else baixarPorTurma(); // "turmas" e "resumo" exportam a mesma planilha por turma
}

function baixarPorProfessor() {
  const f        = getFiltros();
  const filtered = chamadasFiltradas(f);
  if (!filtered.length) { showToast("Nenhum dado para exportar.", "error"); return; }

  const porProf = {};
  filtered.forEach(c => {
    const key = c.professor_id || c.professor || "—";
    if (!porProf[key]) porProf[key] = { nome: c.professor || "Sem professor", chamadas: [] };
    porProf[key].chamadas.push(c);
  });

  const resumo  = [["Professor","Turmas","Chamadas","Presentes","Atrasados","Ausentes","Frequência %"]];
  const detalhe = [["Professor","Data","Turma","Presentes","Ausentes","Freq %"]];

  Object.values(porProf).forEach(p => {
    const totalCh = p.chamadas.length;
    const presN   = p.chamadas.reduce((s, c) => s + c.presentes, 0);
    const atrasN  = p.chamadas.reduce((s, c) => s + c.atrasados, 0);
    const alunosN = p.chamadas.reduce((s, c) => s + c.total, 0);
    const ausN    = Math.max(0, alunosN - presN);
    const freqN   = pct(presN, alunosN);
    const turmasSet = new Set(p.chamadas.map(c => c.turma?.nome || "—"));
    resumo.push([p.nome, turmasSet.size, totalCh, presN, atrasN, ausN, freqN + "%"]);
    p.chamadas.forEach(c => {
      detalhe.push([p.nome, fmtDataCurta(c.data), c.turma?.nome ?? "—", c.presentes, Math.max(0, c.ausentes), c.freq + "%"]);
    });
  });

  exportXlsx([
    { nome: "Resumo por Professor", linhas: resumo },
    { nome: "Detalhe por Chamada", linhas: detalhe },
  ], `Relatorio_Professores_${hoje()}.xlsx`);
  showToast("Relatório exportado!", "success");
}

function baixarPorAluno() {
  const f = getFiltros();
  const filtered = chamadasFiltradas(f);
  const alunosFilt = f.turmaId ? _alunos.filter(a => a.turma_id === f.turmaId) : _alunos;
  if (!alunosFilt.length) { showToast("Nenhum dado para exportar.", "error"); return; }

  const chamadaSet = new Set(filtered.map(c => c.id));
  const presMap    = {};
  const atrasMap   = {};
  _presencas.forEach(p => {
    if (!chamadaSet.has(p.chamada_id)) return;
    (presMap[p.aluno_id]  ??= new Set()).add(p.chamada_id);
    if (p.atrasado) (atrasMap[p.aluno_id] ??= new Set()).add(p.chamada_id);
  });

  const chamsPorTurma = {};
  filtered.forEach(c => { (chamsPorTurma[c.turma_id] ??= []).push(c); });

  // Sheet 1: Resumo por aluno
  const resumo = [["Aluno","Matrícula","Turma","Total Chamadas","Presentes","Atrasados","Ausentes","Frequência %"]];
  // Sheet 2: Detalhe aluno × chamada
  const detalhe = [["Aluno","Matrícula","Turma","Data","Status"]];

  alunosFilt.forEach(a => {
    const turma   = _turmaMap[a.turma_id];
    const chams   = chamsPorTurma[a.turma_id] ?? [];
    const presN   = presMap[a.id]?.size  ?? 0;
    const atrasN  = atrasMap[a.id]?.size ?? 0;
    const ausN    = Math.max(0, chams.length - presN);
    const freqN   = pct(presN, chams.length);
    resumo.push([a.nome, a.matricula ?? "", turma?.nome ?? "", chams.length, presN, atrasN, ausN, freqN + "%"]);

    chams.forEach(c => {
      const isP = presMap[a.id]?.has(c.id);
      const isA = atrasMap[a.id]?.has(c.id);
      const st  = isA ? "Atrasado" : isP ? "Presente" : "Ausente";
      detalhe.push([a.nome, a.matricula ?? "", turma?.nome ?? "", fmtDataCurta(c.data), st]);
    });
  });

  exportXlsx([
    { nome: "Resumo por Aluno", linhas: resumo },
    { nome: "Detalhe por Chamada", linhas: detalhe },
  ], `Relatorio_Alunos_${hoje()}.xlsx`);
  showToast("Relatório exportado!", "success");
}

function baixarPorTurma() {
  const f        = getFiltros();
  const filtered = chamadasFiltradas(f);
  if (!filtered.length) { showToast("Nenhum dado para exportar.", "error"); return; }

  const porTurma = {};
  filtered.forEach(c => {
    const tid = c.turma_id;
    if (!porTurma[tid]) porTurma[tid] = { turma: c.turma, chamadas: 0, presTotal: 0, atrasTotal: 0, alunosTotal: c.total };
    porTurma[tid].chamadas++;
    porTurma[tid].presTotal  += c.presentes;
    porTurma[tid].atrasTotal += c.atrasados;
  });

  const linhas = [["Turma","Professor","Matéria","Chamadas","Presentes","Atrasados","Freq %"]];
  Object.values(porTurma).forEach(r => {
    const f = pct(r.presTotal, r.chamadas * r.alunosTotal);
    linhas.push([r.turma?.nome ?? "—", r.turma?.professor ?? "", r.turma?.materia ?? "", r.chamadas, r.presTotal, r.atrasTotal, f + "%"]);
  });

  exportXlsx([{ nome: "Resumo por Turma", linhas }], `Resumo_Escola_${hoje()}.xlsx`);
  showToast("Resumo exportado!", "success");
}

function exportXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ nome, linhas }) => {
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    ws["!cols"] = linhas[0].map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, nome.substring(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

function hoje() {
  return new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
}

init();
