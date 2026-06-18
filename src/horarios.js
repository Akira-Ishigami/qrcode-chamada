import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";
import { gerarGrade }    from "./grade-gen.js";

// Estado da grade automática
let _gradeConfig = null;
let _previewHorarios = null; // quando != null, estamos vendo a prévia gerada

// ── Config ────────────────────────────────────────────────────────────────────
const CAL_START = 5;   // 05:00
const CAL_END   = 24;  // 00:00 (meia-noite)
const CELL_H    = 64;  // px por hora
const timeToFloat = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };

// Faixa de horário exibida na grade — segue o horário de funcionamento da turma selecionada
let _gridStart = CAL_START;
let _gridEnd   = CAL_END;
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

// Dropdown custom para o <select> nativo (mesmo padrão usado no calendário)
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
      return { ...h, colorIdx: 0, matNome: h.materias?.nome ?? "—", turmaNome: h.turmas?.nome ?? "—" };
    });
    recolorHorarios();
    // Turmas únicas que o professor aparece
    const turmaMap = {};
    lista.forEach(h => { if (h.turma_id && h.turmas) turmaMap[h.turma_id] = { id: h.turma_id, nome: h.turmas.nome }; });
    _turmas = Object.values(turmaMap).sort((a,b) => a.nome.localeCompare(b.nome));
  } else {
    const { data: turmas } = await supabaseAdmin.from("turmas").select("id, nome, hora_inicio, hora_fim").eq("instituicao_id", _instId).order("nome");
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
      </div>
      <div class="hor-turma-bar-mobile" style="display:none">
        <select id="sel-turma-mobile" class="hor-mobile-select">
          ${turmaOpts}
        </select>
      </div>`;

  const overlayHtml = (!_isProfessor)
    ? `<div class="cal-no-turma" id="cal-overlay">
        <div class="cal-no-turma-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <strong>Selecione uma turma para ver os horários</strong>
        <span>Clique no seletor <strong>Turma</strong> acima para escolher qual turma configurar.</span>
        <div style="margin-top:14px;background:#f8fafc;border:1px solid #e4eaf4;border-radius:10px;padding:12px 16px;text-align:left;max-width:340px;font-size:.78rem;color:#475569;line-height:1.7">
          <div style="font-weight:700;color:#1e293b;margin-bottom:5px">Como montar a grade:</div>
          <div>1. Selecione a turma no topo</div>
          <div>2. Clique em qualquer célula para adicionar aula</div>
          <div>3. Escolha a matéria — o professor é preenchido automaticamente</div>
          <div>4. Defina início e fim da aula</div>
        </div>
      </div>`
    : "";

  const btn = (id, ico, label, primary) =>
    `<button id="${id}" class="hor-act-btn${primary ? " primary" : ""}">${ico}<span>${label}</span></button>`;
  const acoesHtml = _isProfessor
    ? btn("btn-disponibilidade", "🗓️", "Disponibilidade")
    : `${btn("btn-config", "⚙️", "Configurar")}${btn("btn-curricular", "📚", "Grade curricular")}${btn("btn-gerar", "⚡", "Gerar grade", true)}`;

  root.innerHTML = `
    <div class="hor-header">
      <div class="hor-header-left">
        <div class="hor-title">Horários de Aula</div>
        <div class="hor-subtitle">${subtitulo}</div>
      </div>
      <div class="hor-actions">${acoesHtml}</div>
      <div class="hor-week-badge"><span class="hor-week-dot"></span>${semana}</div>
    </div>

    ${turmaBarHtml}

    <div class="cal-outer">
      ${overlayHtml}
      <div class="cal-scroll">
        <div class="cal-grid" id="cal-grid"></div>
      </div>
    </div>
  `;

  const isMobile = () => window.innerWidth <= 640;

  if (!_isProfessor) {
    enhanceSelect(document.getElementById("sel-turma-mobile"));

    // Desktop select
    document.getElementById("sel-turma")?.addEventListener("change", e => {
      const id = e.target.value;
      const mob = document.getElementById("sel-turma-mobile");
      if (mob) { mob.value = id; mob.cddRebuild?.(); }
      if (id) selecionarTurma(id);
      else { _turmaId = null; _horarios = []; renderGrid(); }
    });
    // Mobile select
    document.getElementById("sel-turma-mobile")?.addEventListener("change", e => {
      const id = e.target.value;
      const desk = document.getElementById("sel-turma");
      if (desk) desk.value = id;
      if (id) selecionarTurma(id);
      else { _turmaId = null; _horarios = []; renderGrid(); }
    });
  }

  // Mostra o seletor correto baseado no tamanho da tela
  const sincronizarLayout = () => {
    const mobile = isMobile();
    const barDesktop = document.querySelector(".hor-turma-bar:not(.hor-turma-bar-mobile)");
    const barMobile  = document.querySelector(".hor-turma-bar-mobile");
    if (barDesktop) barDesktop.style.display = mobile ? "none" : "";
    if (barMobile)  barMobile.style.display  = mobile ? "block" : "none";
  };
  sincronizarLayout();
  window.addEventListener("resize", sincronizarLayout);

  // Botões da grade automática
  document.getElementById("btn-config")?.addEventListener("click", abrirModalConfig);
  document.getElementById("btn-curricular")?.addEventListener("click", abrirModalCurricular);
  document.getElementById("btn-gerar")?.addEventListener("click", iniciarGeracao);
  document.getElementById("btn-disponibilidade")?.addEventListener("click", abrirModalDisponibilidade);

  renderGrid();
  document.addEventListener("click", fecharPopover);
}

// ── Seleciona turma ───────────────────────────────────────────────────────────
async function selecionarTurma(id) {
  _turmaId = id;
  document.getElementById("cal-overlay")?.remove();

  // Durante a prévia da grade gerada, mostra direto do preview (sem ir ao banco)
  if (_previewHorarios) {
    previewParaTurma(id);
    renderGrid();
    return;
  }

  const { data } = await supabaseAdmin
    .from("horarios")
    .select("id, dia_semana, hora_inicio, hora_fim, sala, materia_id, professor_id, materias(nome), profiles(nome,email)")
    .eq("turma_id", id)
    .order("dia_semana").order("hora_inicio");

  _horarios = (data ?? []).map(h => {
    return { ...h, colorIdx: 0, matNome: h.materias?.nome ?? h.materia_id ?? "—" };
  });
  recolorHorarios();

  renderGrid();
}

// Cada aula recebe uma cor própria, distribuída pela ordem (dia → hora).
function recolorHorarios() {
  _horarios
    .slice()
    .sort((a, b) => (a.dia_semana - b.dia_semana) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)))
    .forEach((h, i) => { h.colorIdx = i % MAT_COLORS.length; });
}

// ── Render da grade semanal ───────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;

  // Turma selecionada define a faixa de horário da grade (horário de funcionamento)
  const turmaAtual = !_isProfessor ? _turmas.find(t => t.id === _turmaId) : null;
  _gridStart = CAL_START;
  _gridEnd   = CAL_END;
  if (turmaAtual?.hora_inicio && turmaAtual?.hora_fim) {
    const ini = Math.floor(timeToFloat(turmaAtual.hora_inicio));
    const fim = Math.ceil(timeToFloat(turmaAtual.hora_fim));
    if (fim > ini) { _gridStart = ini; _gridEnd = fim; }
  }

  const hours = Array.from({ length: _gridEnd - _gridStart }, (_, i) => _gridStart + i);
  const agora = new Date();
  const hoje  = agora.getDay(); // 0=Dom

  // Posição da linha de "agora"
  const nowFloat = agora.getHours() + agora.getMinutes() / 60;
  const showNow  = nowFloat >= _gridStart && nowFloat < _gridEnd;
  const nowTop   = (nowFloat - _gridStart) * CELL_H;
  const nowLabel = `${String(agora.getHours()).padStart(2,"0")}:${String(agora.getMinutes()).padStart(2,"0")}`;

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
          ${isHoje && showNow ? `<div class="cal-now-line" style="top:${nowTop}px"><span class="cal-now-dot" data-time="${nowLabel}"></span></div>` : ""}
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

  const top    = (startF - _gridStart) * CELL_H;
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
  // Desliga as chamadas ligadas a este horário antes de apagá-lo (preserva as chamadas)
  await supabaseAdmin.from("chamadas").update({ horario_id: null }).eq("horario_id", id);
  const { error } = await supabaseAdmin.from("horarios").delete().eq("id", id);
  if (error) { showToast("Erro ao excluir: " + error.message, "error"); return; }
  showToast("Horário removido.", "success");
  _horarios = _horarios.filter(h => h.id !== id);
  renderGrid();
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
    let   profId = document.getElementById("m-professor-val")?.value || null;
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

    // Garante o professor: se não veio do modal (ex.: _pms desatualizado),
    // resolve pelo vínculo da matéria com dados frescos.
    if (!profId) {
      const { data: vinc } = await supabaseAdmin
        .from("professor_materias").select("professor_id").eq("materia_id", matId);
      if (vinc?.length === 1) {
        profId = vinc[0].professor_id;
      } else if (vinc?.length > 1) {
        fb.textContent = "Esta matéria tem vários professores — selecione um.";
        btn.disabled = false; btn.textContent = "Adicionar aula";
        return;
      }
    }

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

    _horarios.push({
      ...novo,
      colorIdx: 0,
      matNome:  novo.materias?.nome ?? mat?.nome ?? "—",
    });
    recolorHorarios();

    fechar();
    renderGrid();
    showToast("Aula adicionada!", "success");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GRADE AUTOMÁTICA
// ═══════════════════════════════════════════════════════════════════════════
const DIAS_OPC = [[1,"Seg"],[2,"Ter"],[3,"Qua"],[4,"Qui"],[5,"Sex"],[6,"Sáb"],[0,"Dom"]];

function modalHor(titulo, sub, bodyHtml, footHtml) {
  const ov = document.createElement("div");
  ov.className = "hor-modal-bg";
  ov.innerHTML = `
    <div class="hor-modal" style="max-width:460px">
      <div class="hor-modal-head">
        <div><h3>${esc(titulo)}</h3><span>${esc(sub)}</span></div>
        <button class="hor-modal-close" data-close>✕</button>
      </div>
      <div class="hor-modal-body">${bodyHtml}</div>
      <div class="hor-modal-foot">${footHtml}</div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
  ov.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  return { ov, close };
}

function confirmarHor(titulo, msg, labelOk, onOk) {
  const ov = document.createElement("div");
  ov.className = "hor-modal-bg";
  ov.innerHTML = `
    <div class="hor-modal" style="max-width:400px">
      <div class="hor-modal-head"><div><h3>${esc(titulo)}</h3></div></div>
      <div class="hor-modal-body"><p style="font-size:.86rem;color:var(--text-2,#475569);line-height:1.6;margin:0">${esc(msg)}</p></div>
      <div class="hor-modal-foot">
        <button class="hor-btn-cancel" data-cancel>Cancelar</button>
        <button class="hor-btn-save" data-ok>${esc(labelOk)}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
  ov.querySelector("[data-cancel]").addEventListener("click", close);
  ov.querySelector("[data-ok]").addEventListener("click", () => { close(); onOk(); });
}

async function carregarConfig() {
  const { data } = await supabaseAdmin.from("grade_config").select("*").eq("instituicao_id", _instId).maybeSingle();
  _gradeConfig = data || {
    instituicao_id: _instId, aula_min: 50, intervalo_min: 0,
    hora_inicio: "07:00", hora_fim: "12:00",
    recreio_inicio: null, recreio_fim: null, dias_semana: [1,2,3,4,5], max_materia_dia: 2,
  };
  return _gradeConfig;
}

// ── Configuração ──────────────────────────────────────────────────────────────
async function abrirModalConfig() {
  const c = await carregarConfig();
  const dias = new Set(c.dias_semana ?? [1,2,3,4,5]);
  const diasHtml = DIAS_OPC.map(([v,l]) =>
    `<button type="button" class="hor-dia-chip${dias.has(v) ? " on" : ""}" data-dia="${v}">${l}</button>`
  ).join("");

  const { ov, close } = modalHor("Configuração da grade", "Parâmetros usados na geração automática", `
    <div class="hor-field-row">
      <div class="hor-field"><label>Início do dia</label><input id="cf-ini" type="time" value="${(c.hora_inicio || '07:00').slice(0,5)}"></div>
      <div class="hor-field"><label>Fim do dia</label><input id="cf-fim" type="time" value="${(c.hora_fim || '12:00').slice(0,5)}"></div>
    </div>
    <div class="hor-field-row">
      <div class="hor-field"><label>Duração da aula (min)</label><input id="cf-aula" type="number" min="10" max="180" value="${c.aula_min}"></div>
      <div class="hor-field"><label>Intervalo entre aulas (min)</label><input id="cf-int" type="number" min="0" max="60" value="${c.intervalo_min}"></div>
    </div>
    <div class="hor-field"><label>Dias letivos</label><div class="hor-dias">${diasHtml}</div></div>
    <div class="hor-field-row">
      <div class="hor-field"><label>Recreio — início</label><input id="cf-rec-ini" type="time" value="${c.recreio_inicio ? c.recreio_inicio.slice(0,5) : ""}"></div>
      <div class="hor-field"><label>Recreio — fim</label><input id="cf-rec-fim" type="time" value="${c.recreio_fim ? c.recreio_fim.slice(0,5) : ""}"></div>
    </div>
    <div class="hor-field"><label>Máx. da mesma matéria por dia</label><input id="cf-max" type="number" min="1" max="6" value="${c.max_materia_dia}"></div>
    <div class="hor-feedback" id="cf-fb"></div>
  `, `<button class="hor-btn-cancel" data-close>Cancelar</button><button class="hor-btn-save" id="cf-salvar">Salvar</button>`);

  ov.querySelectorAll(".hor-dia-chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("on"));
  });

  ov.querySelector("#cf-salvar").addEventListener("click", async () => {
    const diasSel = [...ov.querySelectorAll(".hor-dia-chip.on")].map(c => +c.dataset.dia);
    if (!diasSel.length) { ov.querySelector("#cf-fb").textContent = "Selecione ao menos um dia."; return; }
    const horaIni = ov.querySelector("#cf-ini").value || "07:00";
    const horaFim = ov.querySelector("#cf-fim").value || "12:00";
    if (horaFim <= horaIni) { ov.querySelector("#cf-fb").textContent = "O fim do dia deve ser depois do início."; return; }
    const payload = {
      instituicao_id: _instId,
      hora_inicio: horaIni,
      hora_fim: horaFim,
      aula_min: parseInt(ov.querySelector("#cf-aula").value, 10) || 50,
      intervalo_min: parseInt(ov.querySelector("#cf-int").value, 10) || 0,
      recreio_inicio: ov.querySelector("#cf-rec-ini").value || null,
      recreio_fim: ov.querySelector("#cf-rec-fim").value || null,
      dias_semana: diasSel.sort((a,b)=>a-b),
      max_materia_dia: parseInt(ov.querySelector("#cf-max").value, 10) || 2,
    };
    const { error } = await supabaseAdmin.from("grade_config").upsert(payload, { onConflict: "instituicao_id" });
    if (error) { ov.querySelector("#cf-fb").textContent = "Erro: " + error.message; return; }
    _gradeConfig = payload;
    close();
    showToast("Configuração salva!", "success");
  });
}

// ── Grade curricular (por turma) ──────────────────────────────────────────────
async function abrirModalCurricular() {
  if (!_turmaId) { showToast("Selecione uma turma no topo primeiro.", "error"); return; }
  const turma = _turmas.find(t => t.id === _turmaId);

  const { data: existentes } = await supabaseAdmin
    .from("grade_curricular").select("materia_id, professor_id, aulas_semana").eq("turma_id", _turmaId);
  const exMap = {};
  (existentes ?? []).forEach(e => { exMap[e.materia_id] = e; });

  if (!_materias.length) { showToast("Cadastre matérias primeiro.", "error"); return; }

  const linhas = _materias.map(m => {
    const ex = exMap[m.id] || {};
    const profs = _pms.filter(pm => pm.materia_id === m.id);
    const profOpts = `<option value="">— professor —</option>` + profs.map(pm =>
      `<option value="${pm.professor_id}" ${ex.professor_id === pm.professor_id ? "selected" : ""}>${esc(pm.profiles?.nome ?? pm.profiles?.email ?? "—")}</option>`).join("");
    return `
      <div class="hor-curr-row" data-mat="${m.id}">
        <div class="hor-curr-nome">${esc(m.nome)}</div>
        <select class="hor-curr-prof">${profOpts}</select>
        <input class="hor-curr-aulas" type="number" min="0" max="20" value="${ex.aulas_semana ?? 0}" title="Aulas por semana">
      </div>`;
  }).join("");

  const { ov, close } = modalHor(`Grade curricular — ${turma?.nome ?? ""}`, "Defina matérias, professor e nº de aulas por semana", `
    <div class="hor-curr-head"><span>Matéria</span><span>Professor</span><span>Aulas/sem</span></div>
    <div class="hor-curr-list">${linhas}</div>
    <div class="hor-feedback" id="cu-fb"></div>
  `, `<button class="hor-btn-cancel" data-close>Cancelar</button><button class="hor-btn-save" id="cu-salvar">Salvar</button>`);
  ov.querySelector("[data-close]").addEventListener("click", close);

  ov.querySelector("#cu-salvar").addEventListener("click", async () => {
    const btn = ov.querySelector("#cu-salvar"); btn.disabled = true; btn.textContent = "Salvando…";
    const upserts = [], deletes = [];
    ov.querySelectorAll(".hor-curr-row").forEach(row => {
      const materia_id = row.dataset.mat;
      const aulas = parseInt(row.querySelector(".hor-curr-aulas").value, 10) || 0;
      const professor_id = row.querySelector(".hor-curr-prof").value || null;
      if (aulas > 0) upserts.push({ instituicao_id: _instId, turma_id: _turmaId, materia_id, professor_id, aulas_semana: aulas });
      else deletes.push(materia_id);
    });
    try {
      if (upserts.length) {
        const { error } = await supabaseAdmin.from("grade_curricular").upsert(upserts, { onConflict: "turma_id,materia_id" });
        if (error) throw error;
      }
      if (deletes.length) {
        await supabaseAdmin.from("grade_curricular").delete().eq("turma_id", _turmaId).in("materia_id", deletes);
      }
      close();
      showToast("Grade curricular salva!", "success");
    } catch (e) {
      ov.querySelector("#cu-fb").textContent = "Erro: " + e.message;
      btn.disabled = false; btn.textContent = "Salvar";
    }
  });
}

// ── Geração + prévia ──────────────────────────────────────────────────────────
function previewParaTurma(turmaId) {
  const rows = (_previewHorarios ?? []).filter(h => h.turma_id === turmaId).map((h, i) => {
    const mat = _materias.find(m => m.id === h.materia_id);
    const pm  = _pms.find(p => p.professor_id === h.professor_id);
    return { ...h, id: `prev-${i}`, colorIdx: 0, matNome: mat?.nome ?? "—",
             materias: { nome: mat?.nome ?? "—" }, profiles: { nome: pm?.profiles?.nome ?? "" } };
  });
  _horarios = rows;
  recolorHorarios();
}

async function iniciarGeracao() {
  if (_previewHorarios) { /* refazer */ }
  showToast("Gerando grade…");
  await carregarConfig();

  const [{ data: turmas }, { data: demanda }] = await Promise.all([
    supabaseAdmin.from("turmas").select("id, nome, hora_inicio, hora_fim").eq("instituicao_id", _instId),
    supabaseAdmin.from("grade_curricular").select("turma_id, materia_id, professor_id, aulas_semana").eq("instituicao_id", _instId),
  ]);

  if (!demanda?.length) { showToast("Cadastre a grade curricular (📚) antes de gerar.", "error"); return; }
  if (!_gradeConfig.hora_inicio || !_gradeConfig.hora_fim) {
    showToast("Configure o início/fim do dia em ⚙️ Configurar.", "error"); return;
  }

  const profIds = [...new Set(demanda.map(d => d.professor_id).filter(Boolean))];
  let indisp = [];
  if (profIds.length) {
    const { data } = await supabaseAdmin.from("professor_indisponibilidade")
      .select("professor_id, dia_semana, hora_inicio, hora_fim").in("professor_id", profIds);
    indisp = data ?? [];
  }

  const res = gerarGrade({ turmas: turmas ?? [], config: _gradeConfig, demanda, indisponibilidade: indisp, travados: [] });
  _previewHorarios = res.horarios;
  mostrarPreview(res);
}

function mostrarPreview(res) {
  // Garante uma turma selecionada para visualizar
  if (!_turmaId && _turmas[0]) {
    _turmaId = _turmas[0].id;
    const sel = document.getElementById("sel-turma"); if (sel) sel.value = _turmaId;
    const selM = document.getElementById("sel-turma-mobile"); if (selM) { selM.value = _turmaId; selM.cddRebuild?.(); }
    document.getElementById("cal-overlay")?.remove();
  }
  previewParaTurma(_turmaId);
  renderGrid();

  const naoAloc = res.naoAlocadas.reduce((s, x) => s + x.faltam, 0);
  document.getElementById("preview-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "preview-banner";
  banner.className = "hor-preview-banner";
  banner.innerHTML = `
    <div class="pv-info">
      <strong>⚡ Prévia da grade gerada</strong>
      <span>${res.horarios.length} aulas alocadas${naoAloc ? ` · <b style="color:#fca5a5">${naoAloc} não couberam</b>` : ""}. Troque a turma no seletor para ver cada uma.</span>
    </div>
    <div class="pv-acts">
      <button id="pv-refazer">↻ Refazer</button>
      <button id="pv-cancelar">Cancelar</button>
      <button id="pv-aplicar" class="primary">Aplicar grade</button>
    </div>`;
  const outer = document.querySelector(".cal-outer");
  outer?.parentNode?.insertBefore(banner, outer);
  document.getElementById("pv-refazer").addEventListener("click", iniciarGeracao);
  document.getElementById("pv-cancelar").addEventListener("click", cancelarPreview);
  document.getElementById("pv-aplicar").addEventListener("click", () => aplicarPreview());
}

function cancelarPreview() {
  _previewHorarios = null;
  document.getElementById("preview-banner")?.remove();
  if (_turmaId) selecionarTurma(_turmaId);
  else { _horarios = []; renderGrid(); }
}

function aplicarPreview() {
  if (!_previewHorarios) return;
  confirmarHor(
    "Aplicar grade gerada",
    "Isto substitui toda a grade de horários das turmas pela grade gerada. As aulas que estavam cadastradas serão apagadas. Deseja continuar?",
    "Aplicar grade",
    aplicarPreviewConfirmado
  );
}

async function aplicarPreviewConfirmado() {
  const btn = document.getElementById("pv-aplicar");
  if (btn) { btn.disabled = true; btn.textContent = "Aplicando…"; }
  try {
    const turmaIds = _turmas.map(t => t.id);
    // Desliga as chamadas dos horários atuais antes de substituir a grade
    const { data: hAntigos } = await supabaseAdmin.from("horarios").select("id").in("turma_id", turmaIds);
    const hAntigosIds = (hAntigos ?? []).map(h => h.id);
    if (hAntigosIds.length) {
      await supabaseAdmin.from("chamadas").update({ horario_id: null }).in("horario_id", hAntigosIds);
    }
    await supabaseAdmin.from("horarios").delete().in("turma_id", turmaIds);
    const rows = _previewHorarios.map(h => ({
      turma_id: h.turma_id, materia_id: h.materia_id, professor_id: h.professor_id,
      dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim,
    }));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("horarios").insert(rows);
      if (error) throw error;
    }
    _previewHorarios = null;
    document.getElementById("preview-banner")?.remove();
    showToast("Grade aplicada!", "success");
    if (_turmaId) selecionarTurma(_turmaId);
  } catch (e) {
    showToast("Erro ao aplicar: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Aplicar grade"; }
  }
}

// ── Indisponibilidade do professor ────────────────────────────────────────────
async function abrirModalDisponibilidade() {
  const { data } = await supabaseAdmin.from("professor_indisponibilidade")
    .select("id, dia_semana, hora_inicio, hora_fim").eq("professor_id", _profUserId).order("dia_semana");
  const blocos = data ?? [];

  const lista = blocos.length
    ? blocos.map(b => `
        <div class="hor-indisp-row" data-id="${b.id}">
          <span>${["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][b.dia_semana]} · ${b.hora_inicio.slice(0,5)}–${b.hora_fim.slice(0,5)}</span>
          <button class="hor-indisp-del" data-del="${b.id}">✕</button>
        </div>`).join("")
    : `<div style="font-size:.82rem;color:var(--text-3);padding:6px 0">Nenhum bloqueio — você está disponível em todos os horários.</div>`;

  const diaOpts = DIAS_OPC.map(([v,l]) => `<option value="${v}">${l}</option>`).join("");

  const { ov, close } = modalHor("Minha disponibilidade", "Marque os horários em que você NÃO pode dar aula", `
    <div class="hor-indisp-list" id="indisp-list">${lista}</div>
    <div class="hor-field" style="margin-top:6px"><label>Adicionar bloqueio</label></div>
    <div class="hor-field-row">
      <div class="hor-field"><select id="in-dia">${diaOpts}</select></div>
      <div class="hor-field"><input id="in-ini" type="time"></div>
      <div class="hor-field"><input id="in-fim" type="time"></div>
    </div>
    <button class="hor-btn-cancel" id="in-add" style="width:100%;justify-content:center">+ Adicionar</button>
    <div class="hor-feedback" id="in-fb"></div>
  `, `<button class="hor-btn-save" data-close>Concluído</button>`);
  ov.querySelector("[data-close]").addEventListener("click", close);

  const recarregar = () => { close(); abrirModalDisponibilidade(); };

  ov.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    await supabaseAdmin.from("professor_indisponibilidade").delete().eq("id", b.dataset.del);
    recarregar();
  }));

  ov.querySelector("#in-add").addEventListener("click", async () => {
    const dia = +ov.querySelector("#in-dia").value;
    const ini = ov.querySelector("#in-ini").value, fim = ov.querySelector("#in-fim").value;
    const fb = ov.querySelector("#in-fb");
    if (!ini || !fim) { fb.textContent = "Informe início e fim."; return; }
    if (fim <= ini) { fb.textContent = "Fim deve ser depois do início."; return; }
    const { error } = await supabaseAdmin.from("professor_indisponibilidade")
      .insert({ professor_id: _profUserId, dia_semana: dia, hora_inicio: ini, hora_fim: fim });
    if (error) { fb.textContent = "Erro: " + error.message; return; }
    recarregar();
  });
}

init();
