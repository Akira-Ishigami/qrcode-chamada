import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

const root = document.getElementById("page-root");

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtData(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}
function fmtDataCurta(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "numeric", month: "short", year: "numeric"
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("id, role, nome, instituicao_id")
    .eq("id", session.user.id).single();

  if (!profile || profile.role === "admin") {
    window.location.href = "/dashboard.html";
    return;
  }

  await renderPage(profile);
}

// ── Carrega dados ─────────────────────────────────────────────────────────────
async function renderPage(profile) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando histórico…</div>`;

  // 1. Turmas do usuário
  let turmasQ = supabaseAdmin.from("turmas")
    .select("id, nome, materia, professor, instituicoes(nome)")
    .order("nome");

  if (profile.role === "professor") {
    // Tenta por professor_id (UUID), fallback por nome
    const { data: porId } = await supabaseAdmin.from("turmas")
      .select("id, nome, materia, professor, instituicoes(nome)")
      .eq("professor_id", profile.id).order("nome");
    if (porId?.length) {
      return renderHistorico(porId, profile, porId[0]?.instituicoes?.nome || "");
    }
    turmasQ = turmasQ.eq("professor", profile.nome);
  } else {
    turmasQ = turmasQ.eq("instituicao_id", profile.instituicao_id);
  }

  const { data: turmas } = await turmasQ;

  if (!turmas?.length) {
    root.innerHTML = `
      <div class="hist-header">
        <div class="hist-eyebrow">Histórico</div>
        <div class="hist-title">Histórico de Chamadas</div>
      </div>
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="48" height="48" style="opacity:.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Nenhuma turma encontrada.</p>
      </div>`;
    return;
  }

  const instNome = turmas[0]?.instituicoes?.nome || "";
  await renderHistorico(turmas, profile, instNome);
}

async function renderHistorico(turmas, profile, instNome) {
  const turmaIds = turmas.map(t => t.id);

  // 2. Todas as chamadas dessas turmas
  const { data: chamadas } = await supabaseAdmin
    .from("chamadas")
    .select("id, turma_id, data, aberta")
    .in("turma_id", turmaIds)
    .order("data", { ascending: false });

  const todasChamadas = chamadas ?? [];

  // 3. Presencas (count por chamada)
  let presentesPorChamada = {};
  if (todasChamadas.length > 0) {
    const chamadaIds = todasChamadas.map(c => c.id);
    const { data: pres } = await supabaseAdmin
      .from("presencas").select("chamada_id")
      .in("chamada_id", chamadaIds);
    (pres ?? []).forEach(p => {
      presentesPorChamada[p.chamada_id] = (presentesPorChamada[p.chamada_id] ?? 0) + 1;
    });
  }

  // 4. Total de alunos por turma
  const { data: alunosList } = await supabaseAdmin
    .from("alunos").select("turma_id").in("turma_id", turmaIds);
  const totalPorTurma = {};
  (alunosList ?? []).forEach(a => {
    totalPorTurma[a.turma_id] = (totalPorTurma[a.turma_id] ?? 0) + 1;
  });

  const turmaMap = {};
  turmas.forEach(t => { turmaMap[t.id] = t; });

  // Enriquece chamadas
  const rich = todasChamadas.map(c => ({
    ...c,
    turma:    turmaMap[c.turma_id],
    presentes: presentesPorChamada[c.id] ?? 0,
    total:    totalPorTurma[c.turma_id] ?? 0,
    freq:     totalPorTurma[c.turma_id] > 0
      ? Math.round((presentesPorChamada[c.id] ?? 0) / totalPorTurma[c.turma_id] * 100)
      : 0,
  }));

  renderUI(rich, turmas, profile, instNome);
}

// ── Render UI ─────────────────────────────────────────────────────────────────
function renderUI(chamadas, turmas, profile, instNome) {
  // Stats globais
  const totalCham  = chamadas.length;
  const totalPres  = chamadas.reduce((s, c) => s + c.presentes, 0);
  const totalAlun  = chamadas.reduce((s, c) => s + c.total, 0);
  const mediaFreq  = totalAlun > 0 ? Math.round(totalPres / totalAlun * 100) : 0;

  root.innerHTML = `
    <div class="hist-header">
      <div>
        <div class="hist-eyebrow">Histórico</div>
        <div class="hist-title">Chamadas</div>
        <div class="hist-sub">${esc(instNome || profile.nome || "")}</div>
      </div>
    </div>

    <!-- Stats globais -->
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
        <span class="hist-stat-num ${mediaFreq >= 75 ? "green" : mediaFreq >= 50 ? "orange" : "red"}">${mediaFreq}%</span>
        <span class="hist-stat-lbl">frequência média</span>
      </div>
    </div>

    <!-- Filtros -->
    <div class="hist-filters">
      <div class="hist-filter-group">
        <label class="hist-filter-label">Turma</label>
        <select class="hist-select" id="filt-turma">
          <option value="">Todas as turmas</option>
          ${turmas.map(t => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join("")}
        </select>
      </div>
      <div class="hist-filter-group">
        <label class="hist-filter-label">De</label>
        <input type="date" class="hist-input" id="filt-de" />
      </div>
      <div class="hist-filter-group">
        <label class="hist-filter-label">Até</label>
        <input type="date" class="hist-input" id="filt-ate" />
      </div>
      <button class="hist-btn-clear" id="btn-clear-filt">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Limpar
      </button>
    </div>

    <!-- Lista -->
    <div id="hist-list"></div>
  `;

  // Filtros
  const filtTurma = document.getElementById("filt-turma");
  const filtDe    = document.getElementById("filt-de");
  const filtAte   = document.getElementById("filt-ate");
  const btnClear  = document.getElementById("btn-clear-filt");

  const aplicar = () => renderLista(chamadas, filtTurma.value, filtDe.value, filtAte.value);
  filtTurma.addEventListener("change", aplicar);
  filtDe   .addEventListener("change", aplicar);
  filtAte  .addEventListener("change", aplicar);
  btnClear.addEventListener("click", () => {
    filtTurma.value = ""; filtDe.value = ""; filtAte.value = "";
    aplicar();
  });

  renderLista(chamadas, "", "", "");
}

// ── Renderiza lista filtrada ───────────────────────────────────────────────────
function renderLista(chamadas, filtTurmaId, filtDe, filtAte) {
  const histList = document.getElementById("hist-list");
  if (!histList) return;

  // Filtra
  let filtered = chamadas;
  if (filtTurmaId) filtered = filtered.filter(c => c.turma_id === filtTurmaId);
  if (filtDe)      filtered = filtered.filter(c => c.data >= filtDe);
  if (filtAte)     filtered = filtered.filter(c => c.data <= filtAte);

  if (filtered.length === 0) {
    histList.innerHTML = `
      <div class="hist-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" width="44" height="44" style="opacity:.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Nenhuma chamada encontrada.</p>
      </div>`;
    return;
  }

  // Agrupa por data
  const byDate = {};
  filtered.forEach(c => {
    (byDate[c.data] = byDate[c.data] || []).push(c);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  histList.innerHTML = "";

  dates.forEach((date, di) => {
    const group = document.createElement("div");
    group.className = "hist-group";
    group.style.animationDelay = `${di * .04}s`;

    const items = byDate[date];
    const dPres = items.reduce((s, c) => s + c.presentes, 0);
    const dAlun = items.reduce((s, c) => s + c.total, 0);
    const dFreq = dAlun > 0 ? Math.round(dPres / dAlun * 100) : 0;
    const hoje  = new Date().toISOString().split("T")[0];
    const isHoje = date === hoje;

    group.innerHTML = `
      <div class="hist-date-sep">
        <span class="hist-date-label">
          ${isHoje ? '<span class="hist-hoje-badge">Hoje</span>' : ""}
          ${fmtData(date)}
        </span>
        <span class="hist-date-meta">${items.length} chamada${items.length !== 1 ? "s" : ""} · ${dFreq}% frequência</span>
      </div>
      <div class="hist-day-rows"></div>
    `;

    const rowsWrap = group.querySelector(".hist-day-rows");

    items.forEach((c, ci) => {
      const turma   = c.turma;
      const pct     = c.freq;
      const pctCls  = pct >= 75 ? "green" : pct >= 50 ? "orange" : "red";
      const inicial = (turma?.nome || "?").charAt(0).toUpperCase();
      const ausentes = c.total - c.presentes;

      const row = document.createElement("div");
      row.className = "hist-row";
      row.style.animationDelay = `${(di * 3 + ci) * .035}s`;
      row.innerHTML = `
        <div class="hist-row-main" tabindex="0">
          <div class="hist-row-avatar">${esc(inicial)}</div>
          <div class="hist-row-info">
            <div class="hist-row-turma">${esc(turma?.nome || "—")}</div>
            ${turma?.materia ? `<div class="hist-row-materia">${esc(turma.materia)}</div>` : ""}
          </div>
          <div class="hist-row-chips">
            <span class="hist-chip green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg>
              ${c.presentes}
            </span>
            <span class="hist-chip red">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ${ausentes}
            </span>
          </div>
          <div class="hist-row-freq ${pctCls}">${pct}%</div>
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

      // Expand/collapse com lista de alunos
      const main   = row.querySelector(".hist-row-main");
      const detail = row.querySelector(".hist-row-detail");
      let loaded = false;

      const toggle = async () => {
        const isOpen = row.classList.contains("open");
        if (isOpen) { row.classList.remove("open"); return; }

        row.classList.add("open");
        if (!loaded) {
          loaded = true;
          detail.innerHTML = `<div class="hist-detail-loading">Carregando…</div>`;

          const [{ data: alunos }, { data: presencas }] = await Promise.all([
            supabaseAdmin.from("alunos").select("id, nome, matricula")
              .eq("turma_id", c.turma_id).order("nome"),
            supabaseAdmin.from("presencas").select("aluno_id")
              .eq("chamada_id", c.id),
          ]);

          const presIds = new Set((presencas ?? []).map(p => p.aluno_id));
          const lista   = alunos ?? [];

          if (!lista.length) {
            detail.innerHTML = `<div class="hist-detail-empty">Nenhum aluno cadastrado nesta turma.</div>`;
            return;
          }

          const presLista = lista.filter(a => presIds.has(a.id));
          const ausLista  = lista.filter(a => !presIds.has(a.id));

          detail.innerHTML = `
            <div class="hist-detail-inner">
              <div class="hist-detail-col">
                <div class="hist-detail-col-head green">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
                  Presentes (${presLista.length})
                </div>
                ${presLista.length === 0
                  ? `<div class="hist-detail-none">Nenhum presente</div>`
                  : presLista.map((a, i) => `
                      <div class="hist-detail-aluno" style="animation-delay:${i*.02}s">
                        <span class="hist-detail-num">${i+1}</span>
                        <span class="hist-detail-nome">${esc(a.nome)}</span>
                        ${a.matricula ? `<span class="hist-detail-mat">${esc(a.matricula)}</span>` : ""}
                      </div>`).join("")
                }
              </div>
              <div class="hist-detail-col">
                <div class="hist-detail-col-head red">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Ausentes (${ausLista.length})
                </div>
                ${ausLista.length === 0
                  ? `<div class="hist-detail-none">Nenhum ausente</div>`
                  : ausLista.map((a, i) => `
                      <div class="hist-detail-aluno" style="animation-delay:${i*.02}s">
                        <span class="hist-detail-num">${i+1}</span>
                        <span class="hist-detail-nome">${esc(a.nome)}</span>
                        ${a.matricula ? `<span class="hist-detail-mat">${esc(a.matricula)}</span>` : ""}
                      </div>`).join("")
                }
              </div>
            </div>
          `;
        }
      };

      main.addEventListener("click", toggle);
      main.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") toggle(); });
      rowsWrap.appendChild(row);
    });

    histList.appendChild(group);
  });
}

init();
