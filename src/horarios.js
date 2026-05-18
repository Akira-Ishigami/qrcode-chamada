import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

// ── Config ────────────────────────────────────────────────────────────────────
const CAL_START = 5;   // 05:00
const CAL_END   = 24;  // 00:00 (meia-noite)
const CELL_H    = 64;  // px por hora
const DIAS_SHORT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const DIAS_FULL  = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
const SHOW_DIAS  = [1,2,3,4,5,6]; // Seg–Sáb (0=Dom)

const MAT_COLORS = [
  { bg:"#dbeafe", border:"#3b82f6", text:"#1e40af" },
  { bg:"#dcfce7", border:"#22c55e", text:"#15803d" },
  { bg:"#fce7f3", border:"#ec4899", text:"#9d174d" },
  { bg:"#fff7ed", border:"#f97316", text:"#c2410c" },
  { bg:"#ede9fe", border:"#8b5cf6", text:"#5b21b6" },
  { bg:"#fef9c3", border:"#eab308", text:"#a16207" },
  { bg:"#ccfbf1", border:"#14b8a6", text:"#115e59" },
  { bg:"#fee2e2", border:"#f87171", text:"#991b1b" },
];

// ── State ─────────────────────────────────────────────────────────────────────
let _instId       = null;
let _turmas       = [];
let _turmaId      = null;
let _materias     = [];
let _pms          = [];
let _horarios     = [];
let _popover      = null;
let _isProfessor  = false;
let _profUserId   = null;

const root = document.getElementById("page-root");
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "/login.html"; return; }
    await applyNavRole();

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

    if (!profile || profile.role === "admin") { window.location.href = "/dashboard.html"; return; }
    _instId = profile.instituicao_id;

    if (profile.role === "professor") {
      _isProfessor = true;
      _profUserId  = session.user.id;
    }

    await carregarDados(profile);
    renderShell();
  } catch (e) {
    console.error("Horários init error:", e);
    root.innerHTML = `<div style="padding:40px;color:var(--red)">Erro ao carregar: ${e.message}</div>`;
  }
}

// ── Carrega turmas + matérias + professor_materias ────────────────────────────
async function carregarDados(profile) {
  const [materiasRes, pmsRes] = await Promise.all([
    supabaseAdmin.from("materias").select("id, nome").eq("instituicao_id", _instId).order("nome"),
    supabaseAdmin.from("professor_materias").select("professor_id, materia_id, profiles(id, nome, email)"),
  ]);

  _materias = (materiasRes.data ?? []).map((m, i) => ({ ...m, colorIdx: i % MAT_COLORS.length }));
  _pms      = pmsRes.data ?? [];

  if (_isProfessor) {
    // Carrega todos os horários do professor e extrai turmas únicas
    const { data: hors } = await supabaseAdmin
      .from("horarios")
      .select("id, dia_semana, hora_inicio, hora_fim, sala, materia_id, professor_id, turma_id, materias(nome), turmas(id, nome), profiles(nome,email)")
      .eq("professor_id", _profUserId)
      .order("dia_semana").order("hora_inicio");

    const lista = hors ?? [];
    // Monta _horarios com colorIdx e turma info
    _horarios = lista.map(h => {
      const mat = _materias.find(m => m.id === h.materia_id);
      return { ...h, colorIdx: mat?.colorIdx ?? 0, matNome: h.materias?.nome ?? "—", turmaNome: h.turmas?.nome ?? "—" };
    });
    // Turmas únicas que o professor aparece
    const turmaMap = {};
    lista.forEach(h => { if (h.turma_id && h.turmas) turmaMap[h.turma_id] = { id: h.turma_id, nome: h.turmas.nome }; });
    _turmas = Object.values(turmaMap).sort((a,b) => a.nome.localeCompare(b.nome));
  } else {
    const { data: turmas } = await supabaseAdmin.from("turmas").select("id, nome").eq("instituicao_id", _instId).order("nome");
    _turmas = turmas ?? [];
  }
}

// ── Shell principal ───────────────────────────────────────────────────────────
function renderShell() {
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });
  const semana = `Semana de ${new Date().toLocaleDateString("pt-BR", { day:"numeric", month:"short" })}`;

  const turmaOpts = _turmas.length === 0
    ? `<option value="">Nenhuma turma cadastrada</option>`
    : `<option value="">Selecione a turma…</option>` +
      _turmas.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join("");

  const subtitulo = _isProfessor
    ? `Suas aulas — ${_horarios.length} aula${_horarios.length !== 1 ? "s" : ""} cadastrada${_horarios.length !== 1 ? "s" : ""}`
    : "Grade semanal — clique nas células para adicionar aulas";

  const turmaBarHtml = _isProfessor
    ? `<div class="hor-turma-bar">
        <span class="hor-turma-label">Turmas</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${_turmas.length === 0
            ? `<span style="font-size:.82rem;color:var(--text-3)">Nenhuma turma com horário cadastrado</span>`
            : _turmas.map(t => `<span class="hor-turma-chip">${esc(t.nome)}</span>`).join("")}
        </div>
      </div>`
    : `<div class="hor-turma-bar">
        <span class="hor-turma-label">Turma</span>
        <div class="hor-select-wrap">
          <select id="sel-turma" class="hor-turma-select">${turmaOpts}</select>
          <svg class="hor-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>`;

  const overlayHtml = (!_isProfessor)
    ? `<div class="cal-no-turma" id="cal-overlay">
        <div class="cal-no-turma-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <strong>Selecione uma turma</strong>
        <span>Use o seletor acima para visualizar e editar os horários</span>
      </div>`
    : "";

  root.innerHTML = `
    <div class="hor-header">
      <div class="hor-header-left">
        <div class="hor-title">Horários de Aula</div>
        <div class="hor-subtitle">${subtitulo}</div>
      </div>
      <div class="hor-week-badge"><span class="hor-week-dot"></span>${semana}</div>
    </div>

    ${turmaBarHtml}

    <div class="cal-outer">
      ${overlayHtml}
      <div class="cal-legend" id="cal-legend">
        ${_isProfessor ? "" : `<span class="cal-legend-empty">Selecione uma turma</span>`}
      </div>
      <div class="cal-scroll">
        <div class="cal-grid" id="cal-grid"></div>
      </div>
    </div>
  `;

  if (!_isProfessor) {
    document.getElementById("sel-turma").addEventListener("change", e => {
      const id = e.target.value;
      if (id) selecionarTurma(id);
      else { _turmaId = null; _horarios = []; renderGrid(); renderLegend(); }
    });
  }

  renderGrid();
  renderLegend();
  document.addEventListener("click", fecharPopover);
}

// ── Seleciona turma ───────────────────────────────────────────────────────────
async function selecionarTurma(id) {
  _turmaId = id;

  // Remove overlay ao selecionar turma
  document.getElementById("cal-overlay")?.remove();

  // Remove overlay
  document.getElementById("cal-overlay")?.remove();

  // Carrega horários da turma
  const { data } = await supabaseAdmin
    .from("horarios")
    .select("id, dia_semana, hora_inicio, hora_fim, sala, materia_id, professor_id, materias(nome), profiles(nome,email)")
    .eq("turma_id", id)
    .order("dia_semana").order("hora_inicio");

  _horarios = (data ?? []).map(h => {
    const mat = _materias.find(m => m.id === h.materia_id);
    return { ...h, colorIdx: mat?.colorIdx ?? 0, matNome: h.materias?.nome ?? h.materia_id ?? "—" };
  });


  renderGrid();
  renderLegend();
}

// ── Legenda de matérias ───────────────────────────────────────────────────────
function renderLegend() {
  const leg = document.getElementById("cal-legend");
  if (!leg) return;

  const usadas = [...new Map(_horarios.map(h => [h.materia_id, h])).values()];

  if (!usadas.length) {
    leg.innerHTML = `<span class="cal-legend-empty">Nenhuma aula cadastrada ainda — clique nas células para adicionar</span>`;
    return;
  }

  leg.innerHTML = usadas.map(h => {
    const c = MAT_COLORS[h.colorIdx];
    return `<span class="cal-legend-item" style="background:${c.bg};border-color:${c.border};color:${c.text}">${esc(h.matNome)}</span>`;
  }).join("");
}

// ── Render da grade semanal ───────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;

  const hours = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);
  const hoje  = new Date().getDay(); // 0=Dom

  // Coluna de horas
  let html = `
    <div class="cal-time-col">
      <div class="cal-time-spacer"></div>
      ${hours.map(h => `
        <div class="cal-hour-label">${h === 24 ? "00:00" : String(h).padStart(2,"0") + ":00"}</div>
      `).join("")}
    </div>`;

  // Colunas dos dias
  SHOW_DIAS.forEach(dia => {
    const isHoje = dia === hoje;
    const hors   = _horarios.filter(h => h.dia_semana === dia);

    html += `
      <div class="cal-day-col${isHoje ? " today-col" : ""}">
        <div class="cal-day-head${isHoje ? " today" : ""}">
          ${DIAS_SHORT[dia]}
        </div>
        <div class="cal-day-body" id="body-${dia}">
          ${hours.map(h => `
            <div class="cal-cell" data-dia="${dia}" data-hora="${h}"></div>
          `).join("")}
          ${hors.map(h => renderBlock(h)).join("")}
        </div>
      </div>`;
  });

  grid.innerHTML = html;
  if (_isProfessor) grid.classList.add("prof-readonly");

  // Bind células (só instituição pode editar)
  if (_turmaId && !_isProfessor) {
    grid.querySelectorAll(".cal-cell").forEach(cell => {
      cell.addEventListener("click", () => {
        abrirModal(parseInt(cell.dataset.dia), parseInt(cell.dataset.hora));
      });
    });
  }

  // Bind blocks — professor: só leitura; instituição: abre popover
  if (_turmaId || _isProfessor) {
    grid.querySelectorAll(".cal-block").forEach(block => {
      if (_isProfessor) return; // sem ação no bloco para professor
      block.addEventListener("click", e => {
        e.stopPropagation();
        mostrarPopover(block, block.dataset.id);
      });
    });
  }
}

// ── Bloco de horário no calendário ────────────────────────────────────────────
function renderBlock(h) {
  const [startH, startM] = h.hora_inicio.split(":").map(Number);
  const [endH,   endM]   = h.hora_fim.split(":").map(Number);
  const startF = startH + startM / 60;
  const endF   = endH   + endM   / 60;

  const top    = (startF - CAL_START) * CELL_H;
  const height = Math.max((endF - startF) * CELL_H - 2, 20);

  const c      = MAT_COLORS[h.colorIdx];
  const subInst = h.profiles?.nome || h.profiles?.email || `${h.hora_inicio.slice(0,5)}–${h.hora_fim.slice(0,5)}${h.sala ? " · "+h.sala : ""}`;

  return `
    <div class="cal-block${_isProfessor ? " prof-view" : ""}" data-id="${h.id}"
      style="top:${top}px;height:${height}px;background:${c.bg};border-left-color:${c.border};color:${c.text}">
      <div class="cal-block-nome">${esc(h.matNome)}</div>
      ${height > 40 ? `<div class="cal-block-sub">${_isProfessor ? esc(h.turmaNome ?? "—") : esc(subInst)}</div>` : ""}
      ${_isProfessor && height > 56 ? `<div class="cal-block-time">${h.hora_inicio.slice(0,5)}–${h.hora_fim.slice(0,5)}</div>` : ""}
    </div>`;
}

// ── Popover do bloco ──────────────────────────────────────────────────────────
function mostrarPopover(blockEl, horarioId) {
  fecharPopover();

  const h   = _horarios.find(x => x.id === horarioId);
  if (!h) return;

  const rect = blockEl.getBoundingClientRect();
  const pop  = document.createElement("div");
  pop.className = "cal-popover";
  pop.id = "cal-popover";

  const prof = h.profiles?.nome || h.profiles?.email || "—";
  const sala = h.sala ? ` · ${h.sala}` : "";

  pop.innerHTML = `
    <div class="cal-pop-header">${esc(DIAS_FULL[h.dia_semana])}</div>
    <div class="cal-pop-info">${esc(h.matNome)}</div>
    <div class="cal-pop-time">${h.hora_inicio.slice(0,5)} – ${h.hora_fim.slice(0,5)}${sala}</div>
    <div class="cal-pop-time" style="margin-bottom:6px">${esc(prof)}</div>
    <button class="cal-pop-del" id="pop-del">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Excluir horário
    </button>
  `;

  // Posiciona
  const left = Math.min(rect.right + 8, window.innerWidth - 175);
  const top  = Math.min(rect.top, window.innerHeight - 160);
  pop.style.cssText = `left:${left}px;top:${top}px`;

  document.body.appendChild(pop);
  _popover = pop;

  document.getElementById("pop-del").addEventListener("click", async e => {
    e.stopPropagation();
    fecharPopover();
    await excluirHorario(horarioId);
  });
}

function fecharPopover() {
  if (_popover) { _popover.remove(); _popover = null; }
}

// ── Excluir horário ───────────────────────────────────────────────────────────
async function excluirHorario(id) {
  const { error } = await supabaseAdmin.from("horarios").delete().eq("id", id);
  if (error) { showToast("Erro ao excluir: " + error.message, "error"); return; }
  showToast("Horário removido.", "success");
  _horarios = _horarios.filter(h => h.id !== id);
  renderGrid();
  renderLegend();
}

// ── Modal adicionar horário ───────────────────────────────────────────────────
function abrirModal(dia, horaInicio) {
  if (_isProfessor) return; // professor não pode adicionar
  const modal = document.createElement("div");
  modal.className = "hor-modal-bg";
  modal.id = "hor-modal";

  // Matérias da instituição
  const matOpts = _materias.length
    ? _materias.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join("")
    : `<option value="">Nenhuma matéria — cadastre em Matérias</option>`;

  // Hora fim padrão = +1h
  const fimH = String(Math.min(horaInicio + 1, CAL_END)).padStart(2,"0");

  modal.innerHTML = `
    <div class="hor-modal">
      <div class="hor-modal-head">
        <div>
          <h3>Nova aula — ${esc(DIAS_FULL[dia])}</h3>
          <span>${String(horaInicio).padStart(2,"0")}:00 em diante</span>
        </div>
        <button class="hor-modal-close" id="m-fechar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="hor-modal-body">
        <div class="hor-field">
          <label>Matéria</label>
          <select id="m-materia">
            <option value="">Selecione…</option>
            ${matOpts}
          </select>
        </div>
        <div class="hor-field" id="m-prof-field" style="display:none">
          <label>Professor</label>
          <div id="m-prof-container"></div>
        </div>
        <div class="hor-field-row">
          <div class="hor-field">
            <label>Início</label>
            <input type="time" id="m-inicio" value="${String(horaInicio).padStart(2,"0")}:00" />
          </div>
          <div class="hor-field">
            <label>Fim</label>
            <input type="time" id="m-fim" value="${fimH}:00" />
          </div>
        </div>
        <div class="hor-field">
          <label>Sala (opcional)</label>
          <input type="text" id="m-sala" placeholder="Ex: Sala 5, Lab 2…" />
        </div>
        <div class="hor-feedback" id="m-feedback"></div>
      </div>
      <div class="hor-modal-foot">
        <button class="hor-btn-cancel" id="m-cancelar">Cancelar</button>
        <button class="hor-btn-save" id="m-salvar">Adicionar aula</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const fechar = () => modal.remove();
  document.getElementById("m-fechar").addEventListener("click", fechar);
  document.getElementById("m-cancelar").addEventListener("click", fechar);
  modal.addEventListener("click", e => { if (e.target === modal) fechar(); });

  // Ao selecionar matéria, mostra professor vinculado automaticamente
  document.getElementById("m-materia").addEventListener("change", () => {
    const matId    = document.getElementById("m-materia").value;
    const field    = document.getElementById("m-prof-field");
    const container = document.getElementById("m-prof-container");
    const profs    = _pms.filter(pm => pm.materia_id === matId);

    if (!matId) { field.style.display = "none"; return; }

    field.style.display = "";

    if (!profs.length) {
      container.innerHTML = `<div class="hor-prof-aviso">Nenhum professor vinculado a esta matéria. <a href="materias.html">Vincular →</a></div>`;
      return;
    }

    if (profs.length === 1) {
      const p   = profs[0].profiles;
      const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
      container.innerHTML = `
        <div class="hor-prof-display">
          <div class="hor-prof-avatar">${esc(ini)}</div>
          <span class="hor-prof-name">${esc(p?.nome || p?.email || "—")}</span>
          <input type="hidden" id="m-professor-val" value="${profs[0].professor_id}" />
        </div>`;
    } else {
      container.innerHTML = `
        <select id="m-professor-val" class="hor-field-input">
          <option value="">Selecione…</option>
          ${profs.map(pm => {
            const p = pm.profiles;
            return `<option value="${pm.professor_id}">${esc(p?.nome || p?.email || "—")}</option>`;
          }).join("")}
        </select>`;
    }
  });

  // Salvar
  document.getElementById("m-salvar").addEventListener("click", async () => {
    const matId  = document.getElementById("m-materia").value;
    const profId = document.getElementById("m-professor-val")?.value || null;
    const inicio = document.getElementById("m-inicio").value;
    const fim    = document.getElementById("m-fim").value;
    const sala   = document.getElementById("m-sala").value.trim();
    const fb     = document.getElementById("m-feedback");

    fb.textContent = "";
    if (!matId)  { fb.textContent = "Selecione a matéria."; return; }
    if (!inicio || !fim) { fb.textContent = "Preencha os horários."; return; }
    if (inicio >= fim)   { fb.textContent = "Início deve ser antes do fim."; return; }

    const btn = document.getElementById("m-salvar");
    btn.disabled = true; btn.textContent = "Salvando…";

    // Busca nome da matéria para coluna texto (compatibilidade)
    const mat = _materias.find(m => m.id === matId);

    const { data: novo, error } = await supabaseAdmin.from("horarios").insert({
      turma_id:     _turmaId,
      materia_id:   matId,
      professor_id: profId,
      dia_semana:   dia,
      hora_inicio:  inicio,
      hora_fim:     fim,
      sala:         sala || null,
    }).select("id, dia_semana, hora_inicio, hora_fim, sala, materia_id, professor_id, materias(nome), profiles(nome,email)")
      .single();

    if (error) {
      fb.textContent = "Erro: " + error.message;
      btn.disabled = false; btn.textContent = "Adicionar aula";
      return;
    }

    const matFull = _materias.find(m => m.id === novo.materia_id);
    _horarios.push({
      ...novo,
      colorIdx: matFull?.colorIdx ?? 0,
      matNome:  novo.materias?.nome ?? mat?.nome ?? "—",
    });

    fechar();
    renderGrid();
    renderLegend();
    showToast("Aula adicionada!", "success");
  });
}

init();
