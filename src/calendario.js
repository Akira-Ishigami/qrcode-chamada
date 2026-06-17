import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

// ── State ─────────────────────────────────────────────────────────────────────
let _instId      = null;
let _userId      = null;
let _isProfessor = false;
let _eventos     = [];
let _mesAtual    = new Date().getMonth();
let _anoAtual    = new Date().getFullYear();

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
               "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MESES_FULL = ["janeiro","fevereiro","março","abril","maio","junho",
                    "julho","agosto","setembro","outubro","novembro","dezembro"];
const DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const MESES_SHORT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

const TIPOS = {
  feriado:  "Feriado",
  prova:    "Prova / Avaliação",
  trabalho: "Trabalho",
  reuniao:  "Reunião",
  recesso:  "Recesso",
  evento:   "Evento",
};

const TIPO_EMOJI = {
  feriado:  "🚩",
  prova:    "🎓",
  trabalho: "📝",
  reuniao:  "📋",
  recesso:  "🏖️",
  evento:   "📅",
};

let _turmas = []; // turmas da instituição (para escopar eventos)
async function carregarTurmas() {
  if (_turmas.length || _isProfessor || !_instId) return;
  const { data } = await supabaseAdmin
    .from("turmas").select("id, nome").eq("instituicao_id", _instId).order("nome");
  _turmas = data ?? [];
}

// Turmas e matérias do professor (para ele lançar provas/trabalhos)
let _profTurmas = [], _profMaterias = [];
async function carregarDadosProf() {
  if (!_isProfessor) return;
  const { data } = await supabaseAdmin
    .from("horarios")
    .select("turma_id, materia_id, turmas(nome), materias(nome)")
    .eq("professor_id", _userId);
  const tMap = {}, mMap = {};
  (data ?? []).forEach(h => {
    if (h.turma_id && h.turmas)   tMap[h.turma_id]   = h.turmas.nome;
    if (h.materia_id && h.materias) mMap[h.materia_id] = h.materias.nome;
  });
  _profTurmas   = Object.entries(tMap).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  _profMaterias = Object.entries(mMap).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
}

const root = document.getElementById("page-root");

// ── Feriados nacionais (BrasilAPI) ────────────────────────────────────────────
const _feriadosCache = {};   // { ano: [...] }

async function carregarFeriadosNacionais(ano) {
  if (_feriadosCache[ano]) return _feriadosCache[ano];
  try {
    const res  = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    _feriadosCache[ano] = (data ?? []).map(f => ({
      id:          `nacional-${f.date}`,
      titulo:      f.name ?? f.localName ?? f.nome ?? "Feriado Nacional",
      tipo:        "feriado",
      data_inicio: f.date,
      data_fim:    null,
      _nacional:   true,
    }));
  } catch (e) {
    console.warn("BrasilAPI feriados:", e);
    _feriadosCache[ano] = [];
  }
  return _feriadosCache[ano];
}

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Auth + init ───────────────────────────────────────────────────────────────
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "/login.html"; return; }
    await applyNavRole();

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

    if (!profile || profile.role === "admin") { window.location.href = "/dashboard.html"; return; }
    _instId  = profile.instituicao_id;
    _userId  = session.user.id;
    _isProfessor = profile.role === "professor";

    await Promise.all([carregarEventos(), carregarFeriadosNacionais(_anoAtual), carregarDadosProf()]);
    renderPage();
    iniciarRealtimeCalendario();
  } catch (e) {
    console.error("Calendário init error:", e);
    root.innerHTML = `<div style="padding:40px;color:var(--red)">Erro ao carregar: ${esc(e.message)}</div>`;
  }
}

// ── Realtime — atualiza calendário automaticamente ───────────────────────────
function iniciarRealtimeCalendario() {
  supabase
    .channel("cal-eventos-" + _instId)
    .on(
      "postgres_changes",
      {
        event:  "*",
        schema: "public",
        table:  "eventos_calendario",
        filter: `instituicao_id=eq.${_instId}`,
      },
      async () => {
        await carregarEventos();
        renderGrade();
        renderUpcoming();
      }
    )
    .subscribe();
}

// ── Todos os eventos visíveis = instituição + feriados nacionais ──────────────
function eventosVisiveis() {
  const nacionais = _feriadosCache[_anoAtual] ?? [];
  // Feriados nacionais não duplicam se a instituição já criou um feriado na mesma data
  const datasInst = new Set(_eventos.map(e => e.data_inicio));
  const extras = nacionais.filter(f => !datasInst.has(f.data_inicio));
  return [..._eventos, ...extras].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
}

// ── Carregar eventos ──────────────────────────────────────────────────────────
async function carregarEventos() {
  const inicio = `${_anoAtual}-${String(_mesAtual + 1).padStart(2,"0")}-01`;

  const { data, error } = await supabaseAdmin
    .from("eventos_calendario")
    .select("*")
    .eq("instituicao_id", _instId)
    .or(`data_inicio.gte.${inicio},data_fim.gte.${inicio}`)
    .order("data_inicio");

  if (error) { console.error("Erro ao carregar eventos:", error); _eventos = []; return; }
  _eventos = data ?? [];
}

// ── Render página principal ───────────────────────────────────────────────────
function renderPage() {
  const tituloSubtitle = _isProfessor
    ? "Calendário da sua instituição"
    : "Gerencie os eventos e datas importantes";

  root.innerHTML = `
    <div class="cal-header">
      <div>
        <div class="cal-title">Calendário Escolar</div>
        <div class="cal-subtitle">${tituloSubtitle}</div>
      </div>
      ${_isProfessor ? `
        <button class="cal-new-btn" id="btn-nova-prova">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span class="cal-btn-label">Prova / Trabalho</span>
        </button>
      ` : `
        <button class="cal-new-btn" id="btn-novo-evento">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span class="cal-btn-label">Novo Evento</span>
        </button>
      `}
    </div>

    <div class="cal-nav">
      <button class="cal-nav-btn" id="btn-mes-ant" title="Mês anterior">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="cal-month-label" id="cal-month-label">${MESES[_mesAtual]} ${_anoAtual}</div>
      <button class="cal-nav-btn" id="btn-mes-prox" title="Próximo mês">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <div class="cal-weekdays">
      ${DIAS_SEMANA.map(d => `<div class="cal-weekday">${d}</div>`).join("")}
    </div>
    <div class="cal-grid" id="cal-grid"></div>

    <div class="cal-section-title" id="cal-section-title">Eventos de ${MESES[_mesAtual]}</div>
    <div id="cal-upcoming" class="cal-upcoming-list"></div>
  `;

  renderGrade();
  renderUpcoming();

  document.getElementById("btn-mes-ant").addEventListener("click", () => navegarMes(-1));
  document.getElementById("btn-mes-prox").addEventListener("click", () => navegarMes(1));
  if (_isProfessor) {
    document.getElementById("btn-nova-prova")?.addEventListener("click", () => abrirModalProf(null));
  } else {
    document.getElementById("btn-novo-evento").addEventListener("click", () => abrirModal(null));
  }
}

// ── Render grade mensal ───────────────────────────────────────────────────────
function renderGrade() {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;

  const hoje = new Date();
  const primeiroDia = new Date(_anoAtual, _mesAtual, 1).getDay();
  const diasNoMes   = new Date(_anoAtual, _mesAtual + 1, 0).getDate();
  const diasMesAnt  = new Date(_anoAtual, _mesAtual, 0).getDate();

  const eventosPorDia = {};
  eventosVisiveis().forEach(ev => {
    const di = new Date(ev.data_inicio + "T00:00:00");
    const df = ev.data_fim ? new Date(ev.data_fim + "T00:00:00") : di;
    let cur = new Date(di);
    while (cur <= df) {
      if (cur.getFullYear() === _anoAtual && cur.getMonth() === _mesAtual) {
        const k = cur.getDate();
        if (!eventosPorDia[k]) eventosPorDia[k] = [];
        eventosPorDia[k].push(ev);
      }
      cur.setDate(cur.getDate() + 1);
    }
  });

  let html = "";

  for (let i = primeiroDia - 1; i >= 0; i--) {
    const col = primeiroDia - 1 - i;
    const isWe = col === 0 || col === 6;
    html += `<div class="cal-day other-month${isWe ? " weekend" : ""}"><div class="cal-day-num">${diasMesAnt - i}</div></div>`;
  }

  for (let d = 1; d <= diasNoMes; d++) {
    const isHoje = hoje.getFullYear() === _anoAtual && hoje.getMonth() === _mesAtual && hoje.getDate() === d;
    const diaSemana = (primeiroDia + d - 1) % 7;
    const isWeekend = diaSemana === 0 || diaSemana === 6;
    const evs = eventosPorDia[d] ?? [];
    const hasEvents = evs.length > 0;
    const maxShow = 2;

    const pillsHtml = evs.slice(0, maxShow).map(ev => {
      const emoji = TIPO_EMOJI[ev.tipo] ?? "📅";
      const extra = ev._nacional ? " nacional" : "";
      return `<div class="cal-event-pill tipo-${esc(ev.tipo)}${extra}">${emoji} ${esc(ev.titulo)}</div>`;
    }).join("");

    const moreHtml = evs.length > maxShow
      ? `<div class="cal-event-more">+${evs.length - maxShow}</div>`
      : "";

    // Bolinhas por evento — visão compacta no cell
    const dotsHtml = evs.slice(0, 4).map(ev =>
      `<span class="cal-dot tipo-${esc(ev.tipo)}${ev._nacional ? " nacional" : ""}"></span>`).join("");

    html += `
      <div class="cal-day${isHoje ? " today" : ""}${isWeekend ? " weekend" : ""}${hasEvents ? " has-ev" : ""} clickable"
           data-dia="${d}">
        <div class="cal-day-num">${d}</div>
        <div class="cal-day-events">${pillsHtml}${moreHtml}</div>
        <div class="cal-day-dots">${dotsHtml}</div>
      </div>
    `;
  }

  const totalCells = Math.ceil((primeiroDia + diasNoMes) / 7) * 7;
  for (let i = 1; i <= totalCells - primeiroDia - diasNoMes; i++) {
    const col = (primeiroDia + diasNoMes + i - 1) % 7;
    const isWe = col === 0 || col === 6;
    html += `<div class="cal-day other-month${isWe ? " weekend" : ""}"><div class="cal-day-num">${i}</div></div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".cal-day.clickable").forEach(el => {
    el.addEventListener("click", () => {
      const dia = parseInt(el.dataset.dia);
      const dateStr = `${_anoAtual}-${String(_mesAtual + 1).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
      if (!_isProfessor) {
        abrirModal(null, dateStr);
      } else {
        const evs = eventosPorDia[dia] ?? [];
        if (evs.length > 0) mostrarEventosDia(dia, evs);
        else abrirModalProf(null, dateStr);
      }
    });
  });
}

// ── Render próximos eventos ───────────────────────────────────────────────────
function renderUpcoming() {
  const container = document.getElementById("cal-upcoming");
  if (!container) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const proximos = eventosVisiveis()
    .filter(ev => {
      const d = new Date(ev.data_inicio + "T00:00:00");
      return d.getFullYear() === _anoAtual && d.getMonth() === _mesAtual;
    });

  if (proximos.length === 0) {
    container.innerHTML = `
      <div class="cal-empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>Nenhum evento em ${MESES[_mesAtual]}.</p>
      </div>`;
    return;
  }

  container.innerHTML = proximos.map((ev, idx) => {
    const di = new Date(ev.data_inicio + "T00:00:00");
    const dia = di.getDate();
    const mon = MESES_SHORT[di.getMonth()];
    const tipoLabel = TIPOS[ev.tipo] ?? ev.tipo;
    const emoji = TIPO_EMOJI[ev.tipo] ?? "📅";

    const horario = ev.hora_inicio
      ? ev.hora_fim ? `${ev.hora_inicio.slice(0,5)} – ${ev.hora_fim.slice(0,5)}` : ev.hora_inicio.slice(0,5)
      : null;

    const metaDesc = horario
      ? `${horario}${ev.descricao ? " · " + ev.descricao : ""}`
      : (ev.descricao ?? tipoLabel);

    const editBtns = (!_isProfessor && !ev._nacional) ? `
      <div style="display:flex;gap:5px;">
        <button class="cal-icon-btn" data-edit="${esc(ev.id)}" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="cal-icon-btn del" data-del="${esc(ev.id)}" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    ` : (ev._nacional ? `<span style="font-size:.6rem;color:var(--text-3);font-weight:600;letter-spacing:.04em;opacity:.7">Nacional</span>` : "");

    return `
      <div class="cal-upcoming-item tipo-${esc(ev.tipo)}${(_isProfessor || ev._nacional) ? " clickable-item" : ""}" data-idx="${idx}">
        <div class="cal-date-box">
          <div class="cal-date-day">${dia}</div>
          <div class="cal-date-mon">${mon}</div>
        </div>
        <div class="cal-upcoming-info">
          <div class="cal-upcoming-nome">${emoji} ${esc(ev.titulo)}</div>
          <div class="cal-upcoming-desc">${esc(metaDesc)}</div>
        </div>
        <div class="cal-upcoming-right">
          <span class="cal-tipo-badge tipo-${esc(ev.tipo)}">${esc(tipoLabel)}</span>
          ${editBtns}
        </div>
      </div>
    `;
  }).join("");

  // Professor: click item → modal de detalhes
  if (_isProfessor) {
    container.querySelectorAll(".cal-upcoming-item.clickable-item").forEach(el => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        mostrarDetalheEvento(proximos[idx]);
      });
    });
  }

  // Institution: edit/delete buttons
  container.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const ev = _eventos.find(x => x.id === btn.dataset.edit);
      if (ev) abrirModal(ev);
    });
  });
  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      confirmarExcluir(btn.dataset.del);
    });
  });
}

// ── Modal detalhes para professor ────────────────────────────────────────────
function mostrarDetalheEvento(ev) {
  const backdrop = document.createElement("div");
  backdrop.className = "cal-modal-backdrop";

  const tipoLabel = TIPOS[ev.tipo] ?? ev.tipo;
  const emoji = TIPO_EMOJI[ev.tipo] ?? "📅";
  const di = new Date(ev.data_inicio + "T00:00:00");
  const dataFormatada = di.toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

  const horario = ev.hora_inicio
    ? ev.hora_fim ? `${ev.hora_inicio.slice(0,5)} – ${ev.hora_fim.slice(0,5)}` : ev.hora_inicio.slice(0,5)
    : null;

  let dataFimHtml = "";
  if (ev.data_fim && ev.data_fim !== ev.data_inicio) {
    const df = new Date(ev.data_fim + "T00:00:00");
    dataFimHtml = `<span style="color:var(--text-3);font-size:.75rem;"> até ${df.toLocaleDateString("pt-BR",{day:"numeric",month:"short"})}</span>`;
  }

  backdrop.innerHTML = `
    <div class="cal-modal cal-detail-modal">
      <div class="cal-detail-tipo-bar tipo-${esc(ev.tipo)}"></div>
      <div class="cal-detail-title">${emoji} ${esc(ev.titulo)}</div>
      <div class="cal-detail-meta">
        <span class="cal-tipo-badge tipo-${esc(ev.tipo)}">${esc(tipoLabel)}</span>
        <div class="cal-detail-date-chip">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${esc(dataFormatada)}${dataFimHtml}
        </div>
        ${horario ? `
          <div class="cal-detail-time-chip">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${esc(horario)}
          </div>
        ` : ""}
      </div>
      ${ev.descricao ? `<div class="cal-detail-desc">${esc(ev.descricao)}</div>` : ""}
      <div class="cal-modal-actions">
        <button class="cal-modal-cancel" id="close-detail">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("#close-detail").addEventListener("click", () => backdrop.remove());
}

// ── Modal popup (dia no grid, professor) ─────────────────────────────────────
function mostrarEventosDia(dia, evs) {
  if (evs.length === 1) { mostrarDetalheEvento(evs[0]); return; }

  const backdrop = document.createElement("div");
  backdrop.className = "cal-modal-backdrop";
  const dateStr = `${dia} de ${MESES_FULL[_mesAtual]}`;

  backdrop.innerHTML = `
    <div class="cal-modal" style="max-width:420px;">
      <div class="cal-modal-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${dateStr}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${evs.map((ev, i) => {
          const tipoLabel = TIPOS[ev.tipo] ?? ev.tipo;
          const emoji = TIPO_EMOJI[ev.tipo] ?? "📅";
          const hor = ev.hora_inicio
            ? ev.hora_fim ? `${ev.hora_inicio.slice(0,5)} – ${ev.hora_fim.slice(0,5)}` : ev.hora_inicio.slice(0,5)
            : null;
          return `
            <div class="cal-upcoming-item tipo-${esc(ev.tipo)} clickable-item" data-day-idx="${i}" style="border:1px solid var(--border);">
              <div class="cal-upcoming-info">
                <div class="cal-upcoming-nome">${emoji} ${esc(ev.titulo)}</div>
                ${hor ? `<div class="cal-upcoming-desc">${esc(hor)}</div>` : ""}
              </div>
              <span class="cal-tipo-badge tipo-${esc(ev.tipo)}">${esc(tipoLabel)}</span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="cal-modal-actions">
        <button class="cal-modal-cancel" id="close-day-modal">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("#close-day-modal").addEventListener("click", () => backdrop.remove());

  backdrop.querySelectorAll("[data-day-idx]").forEach(el => {
    el.addEventListener("click", () => {
      backdrop.remove();
      mostrarDetalheEvento(evs[parseInt(el.dataset.dayIdx)]);
    });
  });
}

// ── Modal criar/editar evento ─────────────────────────────────────────────────
// ── Modal do professor: lançar prova / trabalho ──────────────────────────────
function abrirModalProf(_evento, dataPreenchida = null) {
  if (!_profMaterias.length || !_profTurmas.length) {
    showToast("Você precisa ter aulas cadastradas (matéria e turma) para lançar provas.", "error");
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "cal-modal-backdrop";

  const matOpts   = _profMaterias.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join("");
  const turmaOpts = _profTurmas.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join("");

  backdrop.innerHTML = `
    <div class="cal-modal">
      <div class="cal-modal-title">📝 Prova / Trabalho</div>

      <div class="cal-modal-row">
        <div class="cal-modal-field">
          <label class="cal-modal-label">Matéria *</label>
          <select class="cal-modal-select" id="pv-materia">${matOpts}</select>
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">Turma *</label>
          <select class="cal-modal-select" id="pv-turma">${turmaOpts}</select>
        </div>
      </div>

      <div class="cal-modal-row">
        <div class="cal-modal-field">
          <label class="cal-modal-label">Tipo</label>
          <select class="cal-modal-select" id="pv-tipo">
            <option value="prova">🎓 Prova / Avaliação</option>
            <option value="trabalho">📝 Trabalho</option>
          </select>
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">Sobre (título) *</label>
          <input class="cal-modal-input" id="pv-titulo" type="text" placeholder="Ex: Avaliação capítulos 1-3">
        </div>
      </div>

      <div class="cal-modal-row">
        <div class="cal-modal-field">
          <label class="cal-modal-label">Dia *</label>
          <input class="cal-modal-input" id="pv-data" type="date" value="${dataPreenchida ?? ""}">
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">Hora *</label>
          <input class="cal-modal-input" id="pv-hora" type="time">
        </div>
      </div>

      <div class="cal-modal-field">
        <label class="cal-modal-label">Descrição</label>
        <textarea class="cal-modal-textarea" id="pv-descricao" placeholder="Detalhes (opcional)…"></textarea>
      </div>

      <div class="cal-modal-actions">
        <button class="cal-modal-cancel" id="pv-cancel">Cancelar</button>
        <button class="cal-modal-save" id="pv-save">Lançar</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("#pv-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#pv-save").addEventListener("click", () => salvarProvaTrabalho(backdrop));
}

async function salvarProvaTrabalho(backdrop) {
  const materiaId = backdrop.querySelector("#pv-materia").value;
  const turmaId   = backdrop.querySelector("#pv-turma").value;
  const tipo      = backdrop.querySelector("#pv-tipo").value;
  const titulo    = backdrop.querySelector("#pv-titulo").value.trim();
  const data      = backdrop.querySelector("#pv-data").value;
  const hora      = backdrop.querySelector("#pv-hora").value;
  const descricao = backdrop.querySelector("#pv-descricao").value.trim() || null;

  if (!titulo) { showToast("Informe o título.", "error"); return; }
  if (!data)   { showToast("Informe o dia.", "error"); return; }
  if (!hora)   { showToast("Informe a hora.", "error"); return; }

  const btn = backdrop.querySelector("#pv-save");
  btn.disabled = true; btn.textContent = "Lançando…";

  try {
    const { data: novoEv, error } = await supabaseAdmin
      .from("eventos_calendario")
      .insert({
        titulo, tipo, descricao,
        data_inicio: data, data_fim: null,
        hora_inicio: hora, hora_fim: null,
        instituicao_id: _instId, criado_por: _userId,
        turma_id: turmaId, materia_id: materiaId,
      }).select().single();

    if (error) {
      if (error.code === "23505") {
        showToast("Já existe uma prova/trabalho nesse horário para essa turma.", "error");
      } else {
        showToast("Erro ao lançar: " + error.message, "error");
      }
      btn.disabled = false; btn.textContent = "Lançar";
      return;
    }

    backdrop.remove();
    showToast("Lançado no calendário!", "success");
    await carregarEventos();
    renderGrade();
    renderUpcoming();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
    btn.disabled = false; btn.textContent = "Lançar";
  }
}

// Dropdown custom para os selects do modal (espelha o <select> nativo escondido)
function enhanceCalSelect(sel) {
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
  rebuild();
}

async function abrirModal(evento, dataPreenchida = null) {
  const isEdit = !!evento;
  await carregarTurmas();
  const backdrop = document.createElement("div");
  backdrop.className = "cal-modal-backdrop";

  const tipoOpts = Object.entries(TIPOS).map(([v, l]) =>
    `<option value="${v}" ${evento?.tipo === v ? "selected" : ""}>${TIPO_EMOJI[v]} ${l}</option>`
  ).join("");

  const turmaOpts = `
    <option value="">🏫 Toda a escola</option>
    ${_turmas.map(t => `<option value="${t.id}" ${evento?.turma_id === t.id ? "selected" : ""}>👥 ${esc(t.nome)}</option>`).join("")}`;

  const temExtras = !!(evento?.hora_inicio || evento?.hora_fim || evento?.descricao);

  backdrop.innerHTML = `
    <div class="cal-modal">
      <div class="cal-modal-title">${isEdit ? "✏️ Editar Evento" : "✨ Novo Evento"}</div>

      <div class="cal-modal-field">
        <label class="cal-modal-label">Título *</label>
        <input class="cal-modal-input" id="ev-titulo" type="text" placeholder="Ex: Recesso de Carnaval" value="${esc(evento?.titulo ?? "")}">
      </div>

      <div class="cal-modal-row">
        <div class="cal-modal-field">
          <label class="cal-modal-label">Tipo</label>
          <select class="cal-modal-select" id="ev-tipo">${tipoOpts}</select>
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">Para</label>
          <select class="cal-modal-select" id="ev-turma">${turmaOpts}</select>
        </div>
      </div>

      <div class="cal-modal-row">
        <div class="cal-modal-field">
          <label class="cal-modal-label">Data Início *</label>
          <input class="cal-modal-input" id="ev-data-inicio" type="date" value="${evento?.data_inicio ?? dataPreenchida ?? ""}">
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">Data Fim</label>
          <input class="cal-modal-input" id="ev-data-fim" type="date" value="${evento?.data_fim ?? ""}">
        </div>
      </div>

      <button type="button" class="cal-more-toggle${temExtras ? " open" : ""}" id="ev-more-toggle">
        <svg class="cal-more-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg>
        Horário e descrição
      </button>
      <div class="cal-more${temExtras ? " open" : ""}" id="ev-more">
        <div class="cal-modal-row">
          <div class="cal-modal-field">
            <label class="cal-modal-label">Hora Início</label>
            <input class="cal-modal-input" id="ev-hora-inicio" type="time" value="${evento?.hora_inicio ?? ""}">
          </div>
          <div class="cal-modal-field">
            <label class="cal-modal-label">Hora Fim</label>
            <input class="cal-modal-input" id="ev-hora-fim" type="time" value="${evento?.hora_fim ?? ""}">
          </div>
        </div>
        <div class="cal-modal-field" style="margin-bottom:0">
          <label class="cal-modal-label">Descrição</label>
          <textarea class="cal-modal-textarea" id="ev-descricao" placeholder="Detalhes adicionais (opcional)…">${esc(evento?.descricao ?? "")}</textarea>
        </div>
      </div>

      <div class="cal-modal-actions">
        ${isEdit ? `<button class="cal-modal-del" id="btn-del-ev">Excluir</button>` : ""}
        <button class="cal-modal-cancel" id="btn-cancel-ev">Cancelar</button>
        <button class="cal-modal-save" id="btn-save-ev">${isEdit ? "Salvar" : "Criar Evento"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("#btn-cancel-ev").addEventListener("click", () => backdrop.remove());
  if (isEdit) {
    backdrop.querySelector("#btn-del-ev").addEventListener("click", () => {
      backdrop.remove();
      confirmarExcluir(evento.id);
    });
  }
  backdrop.querySelector("#btn-save-ev").addEventListener("click", () => salvarEvento(evento?.id, backdrop));

  // Toggle de opções extras (horário + descrição)
  const moreToggle = backdrop.querySelector("#ev-more-toggle");
  const moreBox    = backdrop.querySelector("#ev-more");
  moreToggle.addEventListener("click", () => {
    const aberto = moreBox.classList.toggle("open");
    moreToggle.classList.toggle("open", aberto);
  });

  // Dropdowns custom para Tipo e Para
  enhanceCalSelect(backdrop.querySelector("#ev-tipo"));
  enhanceCalSelect(backdrop.querySelector("#ev-turma"));
}

async function salvarEvento(eventoId, backdrop) {
  const titulo     = document.getElementById("ev-titulo").value.trim();
  const tipo       = document.getElementById("ev-tipo").value;
  const dataInicio = document.getElementById("ev-data-inicio").value;
  const dataFim    = document.getElementById("ev-data-fim").value || null;
  const horaInicio = document.getElementById("ev-hora-inicio").value || null;
  const horaFim    = document.getElementById("ev-hora-fim").value || null;
  const descricao  = document.getElementById("ev-descricao").value.trim() || null;
  const turmaId    = document.getElementById("ev-turma")?.value || null;

  if (!titulo) { showToast("Título obrigatório", "error"); return; }
  if (!dataInicio) { showToast("Data de início obrigatória", "error"); return; }

  const btn = backdrop.querySelector("#btn-save-ev");
  btn.disabled = true; btn.textContent = "Salvando…";

  try {
    const payload = {
      titulo, tipo, data_inicio: dataInicio, data_fim: dataFim,
      hora_inicio: horaInicio, hora_fim: horaFim,
      descricao, instituicao_id: _instId, criado_por: _userId,
      turma_id: turmaId,
    };

    if (eventoId) {
      const { error } = await supabaseAdmin.from("eventos_calendario").update(payload).eq("id", eventoId);
      if (error) throw error;
      showToast("Evento atualizado!", "success");
    } else {
      const { data: novoEv, error } = await supabaseAdmin
        .from("eventos_calendario").insert(payload).select().single();
      if (error) throw error;
      await criarNotificacoesProfessores(novoEv);
      showToast("Evento criado!", "success");
    }

    backdrop.remove();
    await carregarEventos();
    renderGrade();
    renderUpcoming();
  } catch (e) {
    showToast("Erro ao salvar: " + e.message, "error");
    btn.disabled = false; btn.textContent = eventoId ? "Salvar" : "Criar Evento";
  }
}

async function criarNotificacoesProfessores(evento) {
  try {
    const { data: profs } = await supabaseAdmin
      .from("profiles").select("id")
      .eq("instituicao_id", _instId).eq("role", "professor");
    if (!profs || profs.length === 0) return;
    const rows = profs.map(p => ({ usuario_id: p.id, evento_id: evento.id, lida: false }));
    await supabaseAdmin.from("notificacoes").insert(rows);
  } catch (e) {
    console.error("Erro ao criar notificações:", e);
  }
}

function confirmarExcluir(eventoId) {
  const backdrop = document.createElement("div");
  backdrop.className = "cal-modal-backdrop";
  backdrop.innerHTML = `
    <div class="cal-modal" style="max-width:360px;">
      <div class="cal-modal-title">Excluir evento?</div>
      <p style="font-size:.875rem;color:var(--text-3);line-height:1.65;margin-bottom:20px;">
        Esta ação não pode ser desfeita. Notificações relacionadas também serão removidas.
      </p>
      <div class="cal-modal-actions">
        <button class="cal-modal-cancel" id="btn-cancel-del">Cancelar</button>
        <button class="cal-modal-del" id="btn-confirm-del" style="margin-right:0;">Excluir</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#btn-cancel-del").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#btn-confirm-del").addEventListener("click", async () => {
    await excluirEvento(eventoId);
    backdrop.remove();
  });
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
}

async function excluirEvento(eventoId) {
  try {
    await supabaseAdmin.from("notificacoes").delete().eq("evento_id", eventoId);
    const { error } = await supabaseAdmin.from("eventos_calendario").delete().eq("id", eventoId);
    if (error) throw error;
    showToast("Evento excluído", "success");
    _eventos = _eventos.filter(e => e.id !== eventoId);
    renderGrade();
    renderUpcoming();
  } catch (e) {
    showToast("Erro ao excluir: " + e.message, "error");
  }
}

async function navegarMes(delta) {
  _mesAtual += delta;
  if (_mesAtual > 11) { _mesAtual = 0; _anoAtual++; }
  if (_mesAtual < 0)  { _mesAtual = 11; _anoAtual--; }
  document.getElementById("cal-month-label").textContent = `${MESES[_mesAtual]} ${_anoAtual}`;
  const t = document.getElementById("cal-section-title");
  if (t) t.textContent = `Eventos de ${MESES[_mesAtual]}`;
  await Promise.all([carregarEventos(), carregarFeriadosNacionais(_anoAtual)]);
  renderGrade();
  renderUpcoming();
}

init();
