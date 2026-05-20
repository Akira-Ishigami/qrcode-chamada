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
let _tab      = "chamadas"; // "chamadas" | "alunos" | "resumo"

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

  if (!_turmas.length) {
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
}

// ── Carrega todos os dados ────────────────────────────────────────────────────
async function loadAll() {
  const turmaIds = _turmas.map(t => t.id);

  const { data: chamadas } = await supabaseAdmin
    .from("chamadas").select("id, turma_id, data, aberta, duracao_seg, professor_id, profiles(nome)")
    .in("turma_id", turmaIds).order("data", { ascending: false });

  const allChamadas = chamadas ?? [];
  const chamadaIds  = allChamadas.map(c => c.id);

  const [presRes, aluRes] = await Promise.all([
    chamadaIds.length
      ? supabaseAdmin.from("presencas").select("chamada_id, aluno_id, atrasado").in("chamada_id", chamadaIds)
      : { data: [] },
    supabaseAdmin.from("alunos").select("id, nome, matricula, turma_id").in("turma_id", turmaIds).order("nome"),
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
      turma:     _turmaMap[c.turma_id],
      professor: c.profiles?.nome ?? "",
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
      <div>
        <div class="hist-eyebrow">Relatório</div>
        <div class="hist-title">Histórico de Chamadas</div>
        <div class="hist-sub">${esc(_instNome)}</div>
      </div>
    </div>

    <div class="hist-stats-bar">
      <div class="hist-stat-pill">
        <span class="hist-stat-num">${totalCham}</span>
        <span class="hist-stat-lbl">chamadas</span>
      </div>
      <div class="hist-stat-sep"></div>
      <div class="hist-stat-pill">
        <span class="hist-stat-num green">${totalPres}</span>
        <span class="hist-stat-lbl">presenças totais</span>
      </div>
      <div class="hist-stat-sep"></div>
      <div class="hist-stat-pill">
        <span class="hist-stat-num ${clrPct(mediaFreq)}">${mediaFreq}%</span>
        <span class="hist-stat-lbl">frequência média</span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="rel-tabs">
      <button class="rel-tab active" data-tab="chamadas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Por Chamada
      </button>
      <button class="rel-tab" data-tab="alunos">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Por Aluno
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
        <div class="rel-filter-group" id="fg-aluno" style="display:none">
          <label class="rel-filter-label">Buscar aluno</label>
          <input type="search" class="rel-input" id="filt-aluno" placeholder="Nome ou matrícula…" style="min-width:180px" />
        </div>
        <button class="rel-btn-clear" id="btn-clear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Limpar
        </button>
      </div>
      <button class="rel-btn-download" id="btn-download">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Baixar .xlsx
      </button>
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
      renderContent();
    });
  });

  // Eventos filtros
  ["filt-turma","filt-de","filt-ate","filt-aluno"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", renderContent);
    document.getElementById(id)?.addEventListener("change", renderContent);
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    ["filt-turma","filt-de","filt-ate","filt-aluno"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
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
  if (_tab === "chamadas") renderPorChamada(f);
  else if (_tab === "alunos") renderPorAluno(f);
  else renderResumo(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: POR CHAMADA
// ─────────────────────────────────────────────────────────────────────────────
function renderPorChamada(f) {
  const content = document.getElementById("rel-content");
  const filtered = chamadasFiltradas(f);

  if (!filtered.length) {
    content.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Nenhuma chamada encontrada.</p>
      </div>`;
    return;
  }

  // Agrupa por data
  const byDate = {};
  filtered.forEach(c => { (byDate[c.data] ??= []).push(c); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const hoje  = new Date().toISOString().split("T")[0];

  content.innerHTML = "";
  dates.forEach((date, di) => {
    const items = byDate[date];
    const dPres = items.reduce((s, c) => s + c.presentes, 0);
    const dAlun = items.reduce((s, c) => s + c.total, 0);
    const dFreq = pct(dPres, dAlun);

    const group = document.createElement("div");
    group.className = "hist-group";
    group.style.animationDelay = `${di * .04}s`;

    group.innerHTML = `
      <div class="hist-date-sep">
        <span class="hist-date-label">
          ${date === hoje ? '<span class="hist-hoje-badge">Hoje</span>' : ""}
          ${fmtData(date)}
        </span>
        <span class="hist-date-meta">${items.length} chamada${items.length !== 1 ? "s" : ""} · ${dFreq}% frequência</span>
      </div>
      <div class="hist-day-rows"></div>
    `;

    const rowsWrap = group.querySelector(".hist-day-rows");
    items.forEach((c, ci) => {
      const p   = c.freq;
      const ini = (c.turma?.nome || "?")[0].toUpperCase();
      const row = document.createElement("div");
      row.className = "hist-row";
      row.style.animationDelay = `${(di * 5 + ci) * .03}s`;
      row.innerHTML = `
        <div class="hist-row-main" tabindex="0">
          <div class="hist-row-avatar">${esc(ini)}</div>
          <div class="hist-row-info">
            <div class="hist-row-turma">${esc(c.turma?.nome || "—")}</div>
            ${c.professor ? `<div class="hist-row-materia">${esc(c.professor)}</div>` : ""}
          </div>
          <div class="hist-row-chips">
            <span class="hist-chip green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg>
              ${c.presentes}
            </span>
            ${c.atrasados > 0 ? `<span class="hist-chip orange">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${c.atrasados}
            </span>` : ""}
            <span class="hist-chip red">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ${c.ausentes < 0 ? 0 : c.ausentes}
            </span>
          </div>
          <div class="hist-row-freq ${clrPct(p)}">${p}%</div>
          <div class="hist-row-status">
            ${c.aberta
              ? `<span class="hist-badge aberta">Aberta</span>`
              : `<span class="hist-badge encerrada">Encerrada</span>`}
          </div>
          <div class="hist-row-chevron">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="hist-row-detail"></div>
      `;

      const main   = row.querySelector(".hist-row-main");
      const detail = row.querySelector(".hist-row-detail");
      let loaded = false;

      const toggle = async () => {
        if (row.classList.toggle("open") && !loaded) {
          loaded = true;
          detail.innerHTML = `<div class="hist-detail-loading">Carregando…</div>`;

          const chamadaPresIds = new Set(
            _presencas.filter(p => p.chamada_id === c.id).map(p => p.aluno_id)
          );
          const chamadaAtrasIds = new Set(
            _presencas.filter(p => p.chamada_id === c.id && p.atrasado).map(p => p.aluno_id)
          );
          const turmaAlunos = _alunos.filter(a => a.turma_id === c.turma_id);
          const presLista   = turmaAlunos.filter(a => chamadaPresIds.has(a.id) && !chamadaAtrasIds.has(a.id));
          const atrasLista  = turmaAlunos.filter(a => chamadaAtrasIds.has(a.id));
          const ausLista    = turmaAlunos.filter(a => !chamadaPresIds.has(a.id));

          const alunoRow = (a, i, tipo) => `
            <div class="hist-detail-aluno" style="animation-delay:${i*.02}s">
              <span class="hist-detail-num">${i+1}</span>
              <span class="hist-detail-nome">${esc(a.nome)}</span>
              ${a.matricula ? `<span class="hist-detail-mat">${esc(a.matricula)}</span>` : ""}
              ${tipo === "atrasado" ? `<span style="font-size:.58rem;font-weight:700;background:#fff7ed;color:#c2410c;border-radius:20px;padding:2px 7px;border:1px solid #fed7aa">Atrasado</span>` : ""}
            </div>`;

          detail.innerHTML = `
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
      };

      main.addEventListener("click", toggle);
      main.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") toggle(); });
      rowsWrap.appendChild(row);
    });

    content.appendChild(group);
  });
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
        <div class="rel-aluno-avatar">${esc(ini)}</div>
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
      <div class="rel-aluno-detail">
        ${totalCh === 0
          ? `<div class="hist-detail-empty">Nenhuma chamada no período.</div>`
          : `<div class="rel-aluno-freq-bar-wrap">
              <div class="rel-aluno-freq-bar" style="width:${freqN}%;background:${freqN >= 75 ? "#16a34a" : freqN >= 50 ? "#ea580c" : "#dc2626"}"></div>
            </div>
            <table class="rel-aluno-table">
              <thead><tr><th>Data</th><th>Turma</th><th>Status</th></tr></thead>
              <tbody>
                ${chamadasDaTurma.map(c => {
                  const isP = presMap[aluno.id]?.has(c.id);
                  const isA = atrasMap[aluno.id]?.has(c.id);
                  const st  = isA ? "atrasado" : isP ? "presente" : "ausente";
                  const cls = isA ? "rel-st-atraso" : isP ? "rel-st-pres" : "rel-st-aus";
                  const lbl = isA ? "Atrasado" : isP ? "Presente" : "Ausente";
                  return `<tr>
                    <td>${fmtDataCurta(c.data)}</td>
                    <td>${esc(c.turma?.nome || "—")}</td>
                    <td><span class="${cls}">${lbl}</span></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>`}
      </div>
    `;

    const head   = card.querySelector(".rel-aluno-card-head");
    const detail = card.querySelector(".rel-aluno-detail");
    head.addEventListener("click",    () => card.classList.toggle("open"));
    head.addEventListener("keydown",  e => { if (e.key === "Enter" || e.key === " ") card.classList.toggle("open"); });
    grid.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: RESUMO
// ─────────────────────────────────────────────────────────────────────────────
function renderResumo(f) {
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
// XLSX DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────
function baixar() {
  if (_tab === "chamadas") baixarPorChamada();
  else if (_tab === "alunos") baixarPorAluno();
  else baixarResumo();
}

function baixarPorChamada() {
  const f        = getFiltros();
  const filtered = chamadasFiltradas(f);
  if (!filtered.length) { showToast("Nenhum dado para exportar.", "error"); return; }

  const linhas = [
    ["Data","Turma","Professor","Matéria","Presentes","Atrasados","Ausentes","Total","Freq %","Status"],
  ];

  filtered.forEach(c => {
    linhas.push([
      fmtDataCurta(c.data),
      c.turma?.nome ?? "—",
      c.turma?.professor ?? "",
      c.turma?.materia ?? "",
      c.presentes,
      c.atrasados,
      Math.max(0, c.ausentes),
      c.total,
      c.freq + "%",
      c.aberta ? "Aberta" : "Encerrada",
    ]);
  });

  exportXlsx([{ nome: "Chamadas", linhas }], `Relatorio_Chamadas_${hoje()}.xlsx`);
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

function baixarResumo() {
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
