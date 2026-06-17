import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import QRCode            from "qrcode";
import { gerarCracha, downloadCracha } from "./cracha.js";

const root = document.getElementById("page-root");
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

// Estado carregado uma vez
let _aluno = null;
let _faltas = [];
let _horarios = [];
let _professores = [];
let _crachaConfig = null;
let _instNome = "";
let _eventos = [];          // calendário: escola + turma + feriados
let _calFiltro = "tudo";    // tudo | escola | turma
let _calView = "lista";     // lista | grade
let _calMes = new Date().getMonth();
let _calAno = new Date().getFullYear();

function toast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

function iniciais(nome) {
  return (nome || "?").split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
}

const SVG_X    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_BOOK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" width="12" height="12"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
const SVG_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;

// ── Logout ──────────────────────────────────────────────────────────────────
document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  localStorage.removeItem("qr_role");
  window.location.href = "/login.html";
});

// ── Navegação entre seções ────────────────────────────────────────────────────
document.getElementById("al-nav").addEventListener("click", (e) => {
  const link = e.target.closest(".sidebar-link");
  if (!link) return;
  document.querySelectorAll("#al-nav .sidebar-link").forEach(l => l.classList.remove("active"));
  link.classList.add("active");
  renderSection(link.dataset.section);
});


// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles").select("role, nome").eq("id", session.user.id).single();

  if (profile && profile.role !== "aluno") {
    window.location.href = "/login.html";
    return;
  }

  const { data: aluno } = await supabaseAdmin
    .from("alunos")
    .select("id, nome, matricula, foto_url, turma_id, id_estadual, telefone, data_nascimento, endereco, turmas(id, nome, instituicao_id, instituicoes(nome))")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!aluno) {
    root.innerHTML = `<div class="al-empty" style="margin-top:50px">
      Sua conta ainda não está vinculada a um aluno.<br>Peça para a sua instituição configurar o acesso.
    </div>`;
    return;
  }

  _aluno = aluno;
  await carregarDados();
  preencherSidebar();
  renderSection("faltas");
}

async function carregarDados() {
  const turmaId = _aluno.turma_id;
  const instId  = _aluno.turmas?.instituicao_id;
  _instNome = _aluno.turmas?.instituicoes?.nome ?? "";

  // Config do crachá da instituição
  if (instId) {
    const { data: cfg } = await supabaseAdmin
      .from("cracha_config").select("*").eq("instituicao_id", instId).maybeSingle();
    _crachaConfig = cfg || null;
  }

  const [horRes, chamRes, presRes] = await Promise.all([
    turmaId ? supabaseAdmin.from("horarios")
      .select("id, dia_semana, hora_inicio, hora_fim, sala, materia_id, professor_id, materias(nome), profiles(nome, foto_url)")
      .eq("turma_id", turmaId).order("dia_semana").order("hora_inicio") : { data: [] },
    turmaId ? supabaseAdmin.from("chamadas")
      .select("id, data, horario_id, horarios(materia_id)")
      .eq("turma_id", turmaId).order("data") : { data: [] },
    supabaseAdmin.from("presencas").select("chamada_id").eq("aluno_id", _aluno.id),
  ]);

  _horarios       = horRes.data ?? [];
  const chamadas  = chamRes.data ?? [];
  const presIds   = new Set((presRes.data ?? []).map(p => p.chamada_id));

  // Config das matérias
  const matIds = [...new Set(_horarios.map(h => h.materia_id).filter(Boolean))];
  let matCfg = {};
  if (matIds.length) {
    const { data } = await supabaseAdmin
      .from("materias").select("id, nome, aulas_semestre, limite_faltas").in("id", matIds);
    (data ?? []).forEach(m => { matCfg[m.id] = m; });
  }

  // Faltas por matéria + histórico (data + presente)
  const totalPorMat = {}, faltasPorMat = {}, registrosPorMat = {};
  chamadas.forEach(c => {
    const matId = c.horarios?.materia_id;
    if (!matId) return;
    const presente = presIds.has(c.id);
    totalPorMat[matId] = (totalPorMat[matId] ?? 0) + 1;
    if (!presente) faltasPorMat[matId] = (faltasPorMat[matId] ?? 0) + 1;
    (registrosPorMat[matId] ??= []).push({ data: c.data, presente });
  });

  _faltas = matIds.map(id => {
    const m = matCfg[id] || {};
    return {
      id, nome: m.nome ?? "Matéria",
      faltas: faltasPorMat[id] ?? 0, total: totalPorMat[id] ?? 0,
      aulas: m.aulas_semestre ?? null, limite: m.limite_faltas ?? null,
      registros: registrosPorMat[id] ?? [],
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome));

  // Professores distintos (com lista de matérias que lecionam)
  const profMap = {};
  _horarios.forEach(h => {
    if (!h.professor_id) return;
    if (!profMap[h.professor_id]) {
      profMap[h.professor_id] = {
        id: h.professor_id,
        nome: h.profiles?.nome ?? "Professor",
        foto: h.profiles?.foto_url ?? null,
        materias: new Set(),
      };
    }
    if (h.materias?.nome) profMap[h.professor_id].materias.add(h.materias.nome);
  });
  _professores = Object.values(profMap)
    .map(p => ({ ...p, materias: [...p.materias] }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // Calendário: eventos da escola (turma_id null) + da turma do aluno + feriados nacionais
  await carregarEventos(instId, turmaId);
}

const _DIAS_MES_SHORT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

async function carregarEventos(instId, turmaId) {
  let eventos = [];
  if (instId) {
    let q = supabaseAdmin
      .from("eventos_calendario")
      .select("id, titulo, descricao, data_inicio, data_fim, hora_inicio, tipo, turma_id, materia_id, materias(nome), profiles(nome), turmas(nome)")
      .eq("instituicao_id", instId);
    q = turmaId
      ? q.or(`turma_id.is.null,turma_id.eq.${turmaId}`)
      : q.is("turma_id", null);
    const { data } = await q.order("data_inicio");
    eventos = (data ?? []).map(e => ({
      ...e,
      escopo:    e.turma_id ? "turma" : "escola",
      materia:   e.materias?.nome ?? null,
      professor: e.profiles?.nome ?? null,
      turmaNome: e.turmas?.nome ?? null,
    }));
  }

  // Feriados nacionais (BrasilAPI) — ano atual e próximo
  const ano = new Date().getFullYear();
  const feriados = (await Promise.all([feriadosNacionais(ano), feriadosNacionais(ano + 1)])).flat();

  _eventos = [...eventos, ...feriados];
}

const _feriadosCache = {};
async function feriadosNacionais(ano) {
  if (_feriadosCache[ano]) return _feriadosCache[ano];
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    _feriadosCache[ano] = (data ?? []).map(f => ({
      id: `nacional-${f.date}`, titulo: f.name ?? "Feriado Nacional",
      tipo: "feriado", data_inicio: f.date, data_fim: null, descricao: null,
      escopo: "escola", _nacional: true,
    }));
  } catch {
    _feriadosCache[ano] = [];
  }
  return _feriadosCache[ano];
}

function preencherSidebar() {
  const box = document.getElementById("side-profile");
  if (box) box.style.display = "";
  const av = document.getElementById("side-avatar");
  if (av) av.innerHTML = _aluno.foto_url
    ? `<img src="${esc(_aluno.foto_url)}" alt="" />`
    : `<span>${esc(iniciais(_aluno.nome))}</span>`;
  document.getElementById("side-nome").textContent  = _aluno.nome;
  document.getElementById("side-turma").textContent = _aluno.turmas?.nome ?? "—";
}

// ── Render de seções ───────────────────────────────────────────────────────────
const TITULOS = {
  faltas:      { t: "Minhas faltas",     s: "Acompanhe suas faltas por matéria" },
  horarios:    { t: "Meus horários",     s: "Grade de aulas da sua turma" },
  calendario:  { t: "Calendário",        s: "Feriados da escola, provas e trabalhos da turma" },
  professores: { t: "Meus professores",  s: "Quem leciona na sua turma" },
  cracha:      { t: "Meu crachá",        s: "Seu QR Code de presença" },
};

function renderSection(name) {
  const meta = TITULOS[name] || TITULOS.faltas;
  let corpo = "";
  if (name === "faltas")           corpo = renderFaltas(_faltas);
  else if (name === "horarios")    corpo = renderHorarios(_horarios);
  else if (name === "calendario")  corpo = renderCalendario();
  else if (name === "professores") corpo = renderProfessores(_professores);
  else if (name === "cracha")      corpo = renderCracha(_aluno);

  const wide = (name === "horarios" || name === "cracha");
  const cabecalho = `
    <div class="al-page-head">
      <div class="al-eyebrow">Portal do aluno</div>
      <div class="al-page-title">${meta.t}</div>
      <div class="al-page-sub">${meta.s}</div>
    </div>`;
  root.innerHTML = wide
    ? `${cabecalho}${corpo}`
    : `<div class="al-narrow">${cabecalho}${corpo}</div>`;

  if (name === "cracha") {
    montarCracha();
    document.getElementById("dl-cracha")?.addEventListener("click", baixarCracha);
    document.getElementById("dl-qr")?.addEventListener("click", baixarQR);
  }

  if (name === "faltas") {
    document.querySelectorAll(".falb-card[data-id]").forEach(c => {
      c.addEventListener("click", () => {
        const m = _faltas.find(x => String(x.id) === c.dataset.id);
        if (m) abrirFaltaModal(m);
      });
    });
  }

  if (name === "professores") {
    document.querySelectorAll(".prof-row").forEach(card => {
      card.addEventListener("click", () => abrirModalProf(_professores[+card.dataset.idx], +card.dataset.idx));
    });
  }

  if (name === "calendario") {
    document.querySelectorAll(".cal2-tab").forEach(tab => {
      tab.addEventListener("click", () => { _calFiltro = tab.dataset.filtro; renderSection("calendario"); });
    });
    document.querySelectorAll(".cal2-vbtn").forEach(b => {
      b.addEventListener("click", () => { _calView = b.dataset.view; renderSection("calendario"); });
    });
    document.querySelectorAll(".cal3-navbtn").forEach(b => {
      b.addEventListener("click", () => {
        if (b.dataset.nav === "hoje") { _calMes = new Date().getMonth(); _calAno = new Date().getFullYear(); }
        else {
          _calMes += parseInt(b.dataset.nav, 10);
          if (_calMes < 0)  { _calMes = 11; _calAno--; }
          if (_calMes > 11) { _calMes = 0;  _calAno++; }
        }
        renderSection("calendario");
      });
    });
    // Dia na grade → modal com os eventos do dia
    document.querySelectorAll(".cal3-day.has-ev").forEach(d => {
      d.addEventListener("click", () => abrirDiaModal(d.dataset.date));
    });
    // Item na lista → detalhe do evento
    document.querySelectorAll(".cal2-item[data-id]").forEach(it => {
      it.addEventListener("click", () => {
        const ev = _eventos.find(e => String(e.id) === it.dataset.id);
        if (ev) abrirEventoModal(ev);
      });
    });
  }
}

// ── Modais do calendário ──────────────────────────────────────────────────────
const _MES_ABBR = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const SVG_BACK   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="16" height="16"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
const SVG_CLOCK  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const SVG_BOOK2  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
const SVG_SCHOOL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
const SVG_USER   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const SVG_GROUP  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const SVG_CLK    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function _dateParts(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    dia: d.getDate(),
    weekday: d.toLocaleDateString("pt-BR", { weekday: "long" }),
    curto: d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" }),
    mesAno: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
  };
}

function _countdown(dateStr) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d - hoje) / 86400000);
  if (diff === 0)  return { txt: "É hoje", cls: "hoje" };
  if (diff === 1)  return { txt: "É amanhã", cls: "soon" };
  if (diff > 1)    return { txt: `Faltam ${diff} dias`, cls: diff <= 3 ? "soon" : "" };
  if (diff === -1) return { txt: "Foi ontem", cls: "past" };
  return { txt: `Há ${-diff} dias`, cls: "past" };
}

function _calmOverlay(inner, extra = "") {
  const bg = document.createElement("div");
  bg.className = "calm-bg";
  bg.innerHTML = `<div class="calm ${extra}">${inner}</div>`;
  document.body.appendChild(bg);
  const close = () => { bg.classList.add("out"); setTimeout(() => bg.remove(), 270); document.removeEventListener("keydown", onKey); };
  function onKey(e) { if (e.key === "Escape") close(); }
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.addEventListener("keydown", onKey);
  return { bg, close };
}

function abrirDiaModal(dateStr) {
  const p = _dateParts(dateStr);
  const evs = eventosFiltrados()
    .filter(e => dateStr >= e.data_inicio && dateStr <= (e.data_fim || e.data_inicio))
    .sort((a, b) => (a.hora_inicio || "99").localeCompare(b.hora_inicio || "99"));

  const rows = evs.length ? evs.map(e => {
    const cor = TIPO_COR[e.tipo] ?? "#94a3b8", bg = TIPO_BG[e.tipo] ?? "#f1f5f9";
    return `
      <button class="calm-evrow" data-id="${esc(e.id)}" style="--evc:${cor};--evbg:${bg}">
        <span class="calm-evrow-ic">${TIPO_EMOJI[e.tipo] ?? "📅"}</span>
        <span class="calm-evrow-mid">
          <span class="calm-evrow-t">${esc(e.titulo)}</span>
          <span class="calm-evrow-s">${e.hora_inicio ? `<span class="calm-evrow-time">${e.hora_inicio.slice(0,5)}</span>` : ""}${esc(TIPO_LABEL[e.tipo] ?? e.tipo)}${e.materia ? ` · ${esc(e.materia)}` : ""}</span>
        </span>
        <span class="calm-chev">›</span>
      </button>`;
  }).join("") : `<div class="calm-vazio"><div class="calm-vazio-ic">📭</div><div>Nenhum evento neste dia</div></div>`;

  const { bg, close } = _calmOverlay(`
    <div class="calm-appbar">
      <span class="calm-appbar-t">Agenda do dia</span>
      <button class="calm-iconbtn dark" id="calm-x">✕</button>
    </div>
    <div class="calm-dayhero">
      <div class="calm-dayhero-num">${p.dia}</div>
      <div>
        <div class="calm-dayhero-wd">${esc(p.weekday)}</div>
        <div class="calm-dayhero-mo">${esc(p.mesAno)}</div>
        <div class="calm-dayhero-count">${evs.length} evento${evs.length !== 1 ? "s" : ""}</div>
      </div>
    </div>
    <div class="calm-content">${rows}</div>
  `, "calm-day");
  bg.querySelector("#calm-x").addEventListener("click", close);
  bg.querySelectorAll(".calm-evrow").forEach(r => r.addEventListener("click", () => {
    const ev = _eventos.find(e => String(e.id) === r.dataset.id);
    close();
    if (ev) setTimeout(() => abrirEventoModal(ev, dateStr), 120);
  }));
}

function abrirEventoModal(e, voltarData = null) {
  const cor = TIPO_COR[e.tipo] ?? "#2563eb";
  const p = _dateParts(e.data_inicio);
  const cd = _countdown(e.data_inicio);
  const row = (icon, label, val) => val ? `
    <div class="calm-row">
      <span class="calm-row-ic">${icon}</span>
      <div style="min-width:0">
        <div class="calm-row-l">${label}</div>
        <div class="calm-row-v">${esc(val)}</div>
      </div>
    </div>` : "";

  const { bg, close } = _calmOverlay(`
    <div class="calm-hero" style="--evc:${cor}">
      <div class="calm-appbar light">
        <button class="calm-backbtn" id="calm-back">${SVG_BACK}<span>Voltar</span></button>
        <button class="calm-iconbtn" id="calm-close">✕</button>
      </div>
      <div class="calm-hero-body">
        <div class="calm-hero-eyebrow">${TIPO_EMOJI[e.tipo] ?? "📅"} ${esc(TIPO_LABEL[e.tipo] ?? e.tipo)}</div>
        <h1 class="calm-hero-title">${esc(e.titulo)}</h1>
        <div class="calm-hero-chips">
          <span class="calm-hchip">📅 ${esc(p.weekday)}, ${esc(p.curto)}</span>
          ${e.hora_inicio ? `<span class="calm-hchip">${SVG_CLOCK} ${e.hora_inicio.slice(0,5)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="calm-content">
      <div class="calm-cd ${cd.cls}">${cd.txt}</div>
      ${row(SVG_BOOK2, "Matéria", e.materia)}
      ${row(SVG_USER, "Professor", e.professor)}
      ${row(SVG_GROUP, "Turma", e.turma_id ? (e.turmaNome || "Sua turma") : "Toda a escola")}
      ${row(SVG_CLK, "Horário", e.hora_inicio ? e.hora_inicio.slice(0,5) : null)}
      ${e.descricao ? `<div class="calm-desc"><div class="calm-desc-l">Descrição</div>${esc(e.descricao)}</div>` : ""}
    </div>
  `, "calm-detail");
  bg.querySelector("#calm-close").addEventListener("click", close);
  bg.querySelector("#calm-back").addEventListener("click", () => { close(); setTimeout(() => abrirDiaModal(voltarData || e.data_inicio), 120); });
}

// ── Calendário ─────────────────────────────────────────────────────────────────
const TIPO_LABEL = { feriado: "Feriado", prova: "Prova", trabalho: "Trabalho", reuniao: "Reunião", recesso: "Recesso", evento: "Evento" };
const TIPO_EMOJI = { feriado: "🚩", prova: "🎓", trabalho: "📝", reuniao: "📋", recesso: "🏖️", evento: "📅" };
const TIPO_COR   = { feriado: "#ef4444", prova: "#7c3aed", trabalho: "#2563eb", reuniao: "#0891b2", recesso: "#16a34a", evento: "#ea580c" };
const TIPO_BG    = { feriado: "#fee2e2", prova: "#f3e8ff", trabalho: "#dbeafe", reuniao: "#cffafe", recesso: "#dcfce7", evento: "#ffedd5" };

function eventosFiltrados() {
  return _eventos.filter(e => _calFiltro === "tudo" ? true : e.escopo === _calFiltro);
}

function renderCalendario() {
  const tabs = [
    { k: "tudo",   l: "Tudo" },
    { k: "turma",  l: "Provas & trabalhos" },
    { k: "escola", l: "Escola" },
  ];
  const tabsHtml = tabs.map(t =>
    `<button class="cal2-tab${_calFiltro === t.k ? " active" : ""}" data-filtro="${t.k}">${t.l}</button>`
  ).join("");

  const viewHtml = `
    <div class="cal2-view">
      <button class="cal2-vbtn${_calView === "lista" ? " active" : ""}" data-view="lista" title="Lista">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button class="cal2-vbtn${_calView === "grade" ? " active" : ""}" data-view="grade" title="Mês">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
    </div>`;

  const controls = `<div class="cal2-controls"><div class="cal2-tabs">${tabsHtml}</div>${viewHtml}</div>`;

  return controls + (_calView === "grade" ? renderGradeMes() : renderLista());
}

function renderGradeMes() {
  const nomeMes = new Date(_calAno, _calMes, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const primeiroDiaSemana = new Date(_calAno, _calMes, 1).getDay(); // 0=Dom
  const diasNoMes = new Date(_calAno, _calMes + 1, 0).getDate();
  const hoje = new Date();
  const ev = eventosFiltrados();

  const eventosDoDia = (dia) => {
    const ds = `${_calAno}-${String(_calMes + 1).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
    return ev.filter(e => ds >= e.data_inicio && ds <= (e.data_fim || e.data_inicio));
  };

  const head = `
    <div class="cal3-head">
      <div class="cal3-mes">${esc(nomeMes)}</div>
      <div class="cal3-nav">
        <button class="cal3-navbtn" data-nav="-1">‹</button>
        <button class="cal3-navbtn" data-nav="hoje">Hoje</button>
        <button class="cal3-navbtn" data-nav="1">›</button>
      </div>
    </div>`;

  const weekdays = `<div class="cal3-weekdays">${DIAS.map(d => `<span>${d}</span>`).join("")}</div>`;

  let celulas = "";
  for (let i = 0; i < primeiroDiaSemana; i++) celulas += `<div class="cal3-day empty"></div>`;
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const isHoje = hoje.getDate() === dia && hoje.getMonth() === _calMes && hoje.getFullYear() === _calAno;
    const evs = eventosDoDia(dia);
    const pills = evs.slice(0, 3).map(e => {
      const hr = e.hora_inicio ? `<b>${e.hora_inicio.slice(0,5)}</b> ` : "";
      return `<span class="cal3-pill tipo-${esc(e.tipo)}" title="${esc(e.titulo)}">${hr}${esc(e.titulo)}</span>`;
    }).join("");
    const mais = evs.length > 3 ? `<span class="cal3-mais">+${evs.length - 3}</span>` : "";
    const dstr = `${_calAno}-${String(_calMes + 1).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
    celulas += `
      <div class="cal3-day${isHoje ? " hoje" : ""}${evs.length ? " has-ev" : ""}"${evs.length ? ` data-date="${dstr}"` : ""}>
        <span class="cal3-num">${dia}</span>
        ${pills}${mais}
      </div>`;
  }

  return `${head}${weekdays}<div class="cal3-grid">${celulas}</div>`;
}

function renderLista() {
  // Da data de hoje em diante, ordenado por data
  const hojeStr = new Date().toISOString().split("T")[0];
  let lista = eventosFiltrados()
    .filter(e => (e.data_fim || e.data_inicio) >= hojeStr)
    .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));

  if (!lista.length) {
    return `<div class="al-card"><div class="al-empty">Nenhum evento próximo${_calFiltro === "turma" ? " para a sua turma" : ""}.</div></div>`;
  }

  // Agrupa por mês/ano
  let html = "", mesAtual = "";
  lista.forEach(e => {
    const d = new Date(e.data_inicio + "T00:00:00");
    const chaveMes = `${d.getFullYear()}-${d.getMonth()}`;
    if (chaveMes !== mesAtual) {
      mesAtual = chaveMes;
      const nomeMes = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      html += `<div class="cal2-month">${esc(nomeMes)}</div>`;
    }
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = _DIAS_MES_SHORT[d.getMonth()];
    const tag = e.escopo === "turma" ? `<span class="cal2-badge turma">Turma</span>` : `<span class="cal2-badge escola">Escola</span>`;
    const periodo = e.data_fim && e.data_fim !== e.data_inicio
      ? `<span class="cal2-badge">até ${new Date(e.data_fim + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>` : "";
    const hora = e.hora_inicio ? `<span class="cal2-badge hora">${e.hora_inicio.slice(0,5)}</span>` : "";
    html += `
      <div class="cal2-item tipo-${esc(e.tipo)}" data-id="${esc(e.id)}">
        <div class="cal2-date">
          <span class="cal2-date-dia">${dia}</span>
          <span class="cal2-date-mes">${mes}</span>
        </div>
        <div class="cal2-body">
          <div class="cal2-titulo">${TIPO_EMOJI[e.tipo] ?? "📅"} ${esc(e.titulo)}</div>
          ${e.descricao ? `<div class="cal2-desc">${esc(e.descricao)}</div>` : ""}
          <div class="cal2-meta">
            <span class="cal2-badge">${TIPO_LABEL[e.tipo] ?? e.tipo}</span>
            ${e.materia ? `<span class="cal2-badge turma">${esc(e.materia)}</span>` : ""}
            ${tag}${hora}${periodo}
          </div>
        </div>
      </div>`;
  });
  return html;
}

const freqCor = (f) => f >= 75 ? "#16a34a" : f >= 60 ? "#ea580c" : "#dc2626";

// Avalia o risco de uma matéria pelas faltas vs limite
function riscoDe(m) {
  if (m.limite != null) {
    if (m.faltas >= m.limite)            return { cor: "#dc2626", rotulo: "Limite atingido", risco: "alto" };
    if (m.faltas >= m.limite * 0.7)      return { cor: "#ea580c", rotulo: "Atenção", risco: "medio" };
  }
  return { cor: "#16a34a", rotulo: "Em dia", risco: "ok" };
}
function metricasDe(m) {
  const base = m.total || 0;
  const freq = base > 0 ? Math.round((base - m.faltas) / base * 100) : 100;
  const restantes = m.limite != null ? Math.max(0, m.limite - m.faltas) : null;
  const fillPct = m.limite != null
    ? Math.min(100, Math.round(m.faltas / Math.max(1, m.limite) * 100))
    : (m.aulas ? Math.min(100, Math.round(m.faltas / m.aulas * 100)) : 0);
  return { base, freq, restantes, fillPct };
}

function renderFaltas(materias) {
  if (!materias.length) return `<div class="al-card"><div class="al-empty">Nenhuma matéria com aulas registradas ainda.</div></div>`;

  // Resumo geral
  let totalFaltas = 0, somaPres = 0, somaTotal = 0, emRisco = 0;
  materias.forEach(m => {
    totalFaltas += m.faltas;
    const base = m.total || 0;
    somaPres += Math.max(0, base - m.faltas);
    somaTotal += base;
    if (m.limite != null && m.faltas >= m.limite * 0.7) emRisco++;
  });
  const freqGeral = somaTotal > 0 ? Math.round(somaPres / somaTotal * 100) : 100;

  const resumo = `
    <div class="falb-summary">
      <div><div class="falb-sum-num" style="color:${freqCor(freqGeral)}">${freqGeral}%</div><div class="falb-sum-lbl">frequência geral</div></div>
      <div><div class="falb-sum-num">${totalFaltas}</div><div class="falb-sum-lbl">faltas no total</div></div>
      <div><div class="falb-sum-num" style="color:${emRisco ? "#ea580c" : "#16a34a"}">${emRisco}</div><div class="falb-sum-lbl">em risco</div></div>
    </div>`;

  const cards = materias.map((m, i) => {
    const { cor, rotulo, risco } = riscoDe(m);
    const { base, freq, restantes, fillPct } = metricasDe(m);

    const legenda = m.limite != null
      ? `<span class="falb-leg" style="color:${cor}">● ${m.faltas} usada${m.faltas !== 1 ? "s" : ""}</span>
         <span class="falb-leg ok">● +${restantes} disponíve${restantes !== 1 ? "is" : "l"}</span>`
      : `<span class="falb-leg" style="color:${cor}">● ${m.faltas} falta${m.faltas !== 1 ? "s" : ""}</span>`;

    return `
      <div class="falb-card risco-${risco}" data-id="${esc(m.id)}" style="animation-delay:${80 + i * 55}ms">
        <div class="falb-head">
          <span class="falb-mat">${esc(m.nome)}</span>
          <span class="falb-badge ${risco}">${rotulo}</span>
        </div>
        <div class="falb-bar">
          <div class="falb-bar-fill" style="width:${fillPct}%;background:${cor}"></div>
        </div>
        <div class="falb-legs">${legenda}</div>
        <div class="falb-foot">
          <span><b style="color:${freqCor(freq)}">${freq}%</b> de presença · ${base} aula${base !== 1 ? "s" : ""}</span>
          <span class="falb-ver">detalhes ›</span>
        </div>
      </div>`;
  }).join("");

  return resumo + cards;
}

function fmtDataLonga(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}

function abrirFaltaModal(m) {
  const { cor, rotulo } = riscoDe(m);
  const { base, freq, restantes, fillPct } = metricasDe(m);

  const regs = (m.registros ?? []).slice().sort((a, b) => b.data.localeCompare(a.data));
  const regsHtml = regs.length
    ? regs.map(r => `
        <div class="fd-reg ${r.presente ? "pres" : "falt"}">
          <span class="fd-reg-ic">${r.presente ? "✓" : "✕"}</span>
          <span class="fd-reg-data">${fmtDataLonga(r.data)}</span>
          <span class="fd-reg-tag">${r.presente ? "Presente" : "Falta"}</span>
        </div>`).join("")
    : `<div class="al-empty">Nenhuma aula registrada ainda.</div>`;

  const { bg, close } = _calmOverlay(`
    <div class="calm-hero" style="--evc:${cor}">
      <div class="calm-appbar light">
        <span class="fd-hero-tag">Minhas faltas</span>
        <button class="calm-iconbtn" id="fd-close">✕</button>
      </div>
      <div class="calm-hero-body">
        <div class="calm-hero-eyebrow">${esc(rotulo)}</div>
        <h1 class="calm-hero-title">${esc(m.nome)}</h1>
        <div class="fd-hero-big">${m.faltas}${m.limite != null ? `<small> de ${m.limite} faltas</small>` : `<small> falta${m.faltas !== 1 ? "s" : ""}</small>`}</div>
      </div>
    </div>
    <div class="calm-content">
      <div class="fd-bar"><div class="fd-bar-fill" style="width:${fillPct}%;background:${cor}"></div></div>
      <div class="fd-legs">
        <span class="fd-leg" style="color:${cor}">● ${m.faltas} usada${m.faltas !== 1 ? "s" : ""}</span>
        ${restantes != null ? `<span class="fd-leg" style="color:#16a34a">● +${restantes} disponíve${restantes !== 1 ? "is" : "l"}</span>` : ""}
      </div>

      <div class="fd-stats">
        <div class="fd-stat"><b style="color:${freqCor(freq)}">${freq}%</b><span>presença</span></div>
        ${restantes != null ? `<div class="fd-stat"><b>${restantes}</b><span>pode faltar</span></div>` : ""}
        <div class="fd-stat"><b>${base}${m.aulas ? `/${m.aulas}` : ""}</b><span>aulas dadas</span></div>
      </div>

      ${restantes != null ? `<div class="fd-msg ${restantes === 0 ? "alto" : restantes <= 2 ? "medio" : "ok"}">
        ${restantes === 0 ? "Você atingiu o limite de faltas desta matéria." :
          restantes <= 2 ? `Atenção! Você pode faltar só mais ${restantes} vez${restantes !== 1 ? "es" : ""}.` :
          `Você ainda pode faltar ${restantes} vezes nesta matéria.`}
      </div>` : ""}

      <div class="fd-sec">Histórico de presença</div>
      <div class="fd-regs">${regsHtml}</div>
    </div>
  `, "calm-detail");
  bg.querySelector("#fd-close").addEventListener("click", close);
}

const GRID_COLORS = [
  { bg:"#dbeafe", border:"#3b82f6", text:"#1e40af" },
  { bg:"#dcfce7", border:"#22c55e", text:"#15803d" },
  { bg:"#fce7f3", border:"#ec4899", text:"#9d174d" },
  { bg:"#fff7ed", border:"#f97316", text:"#c2410c" },
  { bg:"#ede9fe", border:"#8b5cf6", text:"#5b21b6" },
  { bg:"#fef9c3", border:"#eab308", text:"#a16207" },
  { bg:"#ccfbf1", border:"#14b8a6", text:"#115e59" },
  { bg:"#fee2e2", border:"#f87171", text:"#991b1b" },
];
const CELL_H = 56;
const toFloat = (t) => { const [h, m] = String(t).split(":"); return (+h) + (+m) / 60; };

const CAL_START = 5, CAL_END = 24;
const SHOW_DIAS = [1, 2, 3, 4, 5, 6]; // Seg–Sáb
const pad2 = (n) => String(n).padStart(2, "0");

function renderHorarios(horarios) {
  if (!horarios.length) return `<div class="al-card"><div class="al-empty">Nenhum horário cadastrado para a sua turma.</div></div>`;

  // Cor por aula (ordem dia → hora)
  const ordenadas = [...horarios].sort((a, b) => (a.dia_semana - b.dia_semana) || toFloat(a.hora_inicio) - toFloat(b.hora_inicio));
  const corDe = {};
  ordenadas.forEach((h, i) => { corDe[h.id] = GRID_COLORS[i % GRID_COLORS.length]; });

  const now      = new Date();
  const hoje     = now.getDay();
  const nowF     = now.getHours() + now.getMinutes() / 60;
  const showNow  = nowF >= CAL_START && nowF < CAL_END;
  const nowTop   = (nowF - CAL_START) * CELL_H;
  const nowLabel = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const hours    = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);

  const timeCol = `
    <div class="cal-time-col">
      <div class="cal-time-spacer"></div>
      ${hours.map(h => `<div class="cal-hour-label">${h === 24 ? "00:00" : pad2(h) + ":00"}</div>`).join("")}
    </div>`;

  const cols = SHOW_DIAS.map(d => {
    const isHoje = d === hoje;
    const hors   = horarios.filter(h => h.dia_semana === d);
    const blocks = hors.map(h => {
      const top    = (toFloat(h.hora_inicio) - CAL_START) * CELL_H;
      const height = Math.max((toFloat(h.hora_fim) - toFloat(h.hora_inicio)) * CELL_H - 2, 22);
      const c   = corDe[h.id];
      const sub = h.profiles?.nome ?? "";
      return `
        <div class="cal-block" style="top:${top}px;height:${height}px;background:${c.bg};border-left-color:${c.border};color:${c.text}">
          <div class="cal-block-nome">${esc(h.materias?.nome ?? "Aula")}</div>
          ${height > 40 && sub ? `<div class="cal-block-sub">${esc(sub)}</div>` : ""}
          ${height > 56 ? `<div class="cal-block-time">${h.hora_inicio.slice(0,5)}–${h.hora_fim.slice(0,5)}${h.sala ? ` · ${esc(h.sala)}` : ""}</div>` : ""}
        </div>`;
    }).join("");
    const nowLine = (isHoje && showNow)
      ? `<div class="cal-now-line" style="top:${nowTop}px"><span class="cal-now-dot" data-time="${nowLabel}"></span></div>` : "";
    return `
      <div class="cal-day-col${isHoje ? " today-col" : ""}">
        <div class="cal-day-head${isHoje ? " today" : ""}">${DIAS[d]}</div>
        <div class="cal-day-body">
          ${hours.map(() => `<div class="cal-cell"></div>`).join("")}
          ${blocks}
          ${nowLine}
        </div>
      </div>`;
  }).join("");

  return `<div class="cal-scroll"><div class="cal-grid">${timeCol}${cols}</div></div>`;
}

function renderProfessores(professores) {
  if (!professores.length) return `<div class="al-card"><div class="al-empty">Nenhum professor vinculado à sua turma ainda.</div></div>`;

  return `<div class="prof-list">${professores.map((p, i) => {
    const c = GRID_COLORS[i % GRID_COLORS.length];
    return `
    <div class="prof-row" data-idx="${i}" style="--accent:${c.border};--accent-bg:${c.bg};--accent-text:${c.text}">
      <div class="prof-row-photo">
        ${p.foto
          ? `<img src="${p.foto}" alt="" />`
          : `<span>${esc(iniciais(p.nome))}</span>`}
      </div>
      <div class="prof-row-info">
        <div class="prof-row-nome">${esc(p.nome)}</div>
        <div class="prof-row-sub">
          ${SVG_BOOK} ${p.materias.length} matéria${p.materias.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div class="prof-row-arrow">${SVG_ARROW}</div>
    </div>`;
  }).join("")}</div>`;
}

// ── Modal de detalhes do professor ────────────────────────────────────────────
function abrirModalProf(p, idx = 0) {
  if (!p) return;
  const c = GRID_COLORS[idx % GRID_COLORS.length];

  const bg = document.createElement("div");
  bg.className = "al-modal-bg";
  bg.innerHTML = `
    <div class="al-modal-box" style="--accent:${c.border};--accent-bg:${c.bg};--accent-text:${c.text}">
      <button class="al-modal-close" id="al-modal-close">${SVG_X}</button>
      <div class="al-modal-photo">${p.foto ? `<img src="${p.foto}" alt="" />` : `<span>${esc(iniciais(p.nome))}</span>`}</div>
      <div class="al-modal-eyebrow">Professor${p.materias.length !== 1 ? "(a)" : ""}</div>
      <div class="al-modal-nome">${esc(p.nome)}</div>
      <div class="al-modal-label">Matérias que leciona</div>
      <div class="al-modal-mats">
        ${p.materias.length
          ? p.materias.map(m => `<span class="al-modal-mat-badge">${SVG_BOOK} ${esc(m)}</span>`).join("")
          : `<span class="al-modal-mat-badge vazio">Nenhuma matéria vinculada</span>`}
      </div>
    </div>`;
  document.body.appendChild(bg);

  const close = () => { bg.classList.add("closing"); setTimeout(() => bg.remove(), 140); document.removeEventListener("keydown", onKey); };
  function onKey(e) { if (e.key === "Escape") close(); }

  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg.querySelector("#al-modal-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
}

function renderCracha() {
  return `
    <div class="cracha-wrap">
      <div class="cracha-card-box" id="cracha-box">
        <div class="al-loading" style="padding:40px">Gerando seu crachá…</div>
      </div>
      <div class="online-card" id="online-card">
        <div class="online-card-band">
          <div class="online-card-chip">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8.5 8.5a5 5 0 0 1 7 0"/><path d="M5.5 5.5a9 9 0 0 1 13 0"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
            Acesso Digital
          </div>
          ${_instNome ? `<div class="online-card-inst">${esc(_instNome)}</div>` : ""}
        </div>
        <div class="online-card-qr-frame">
          <span class="qr-corner tl"></span><span class="qr-corner tr"></span>
          <span class="qr-corner bl"></span><span class="qr-corner br"></span>
          <div class="online-card-qr" id="online-qr">
            <div class="al-loading" style="padding:20px">Gerando QR…</div>
          </div>
        </div>
        <div class="online-card-perf"></div>
        <div class="online-card-info">
          <div class="online-card-name">${esc(_aluno.nome)}</div>
          <div class="online-card-turma">${esc(_aluno.turmas?.nome ?? "—")}</div>
          <div class="online-card-status">Carteirinha ativa</div>
        </div>
      </div>
      <div class="cracha-actions">
        <button class="al-dl-btn primary" id="dl-cracha">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Baixar crachá
        </button>
        <button class="al-dl-btn" id="dl-qr">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Baixar QR
        </button>
      </div>
      <div class="online-card-hint">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        Mostre este cartão na entrada caso esqueça o crachá físico.
      </div>
    </div>`;
}

// Dados do aluno no formato esperado pelo desenho do crachá
function alunoBadge() {
  return { ..._aluno, turma_nome: _aluno.turmas?.nome ?? "—" };
}

// Gera o crachá completo (desktop) e o cartão online com QR (mobile) — ambos
// ficam no DOM e o CSS decide qual mostrar conforme o tamanho da tela.
async function montarCracha() {
  const box   = document.getElementById("cracha-box");
  const qrBox = document.getElementById("online-qr");

  await Promise.all([
    (async () => {
      if (!box) return;
      try {
        const url = await gerarCracha(alunoBadge(), _crachaConfig, _instNome, "ambos");
        box.innerHTML = `<img id="cracha-img" src="${url}" alt="Crachá de ${esc(_aluno.nome)}" />`;
      } catch {
        box.innerHTML = `<div class="al-empty">Não foi possível gerar o crachá.</div>`;
      }
    })(),
    (async () => {
      if (!qrBox) return;
      try {
        const url = await QRCode.toDataURL(_aluno.matricula || _aluno.id, {
          width: 360, margin: 1, color: { dark: "#0f172a", light: "#ffffff" },
        });
        qrBox.innerHTML = `<img src="${url}" alt="QR Code de presença" />`;
      } catch {
        qrBox.innerHTML = `<div class="al-empty">Não foi possível gerar o QR.</div>`;
      }
    })(),
  ]);
}

// Cartão de acesso online (mobile) — QR + nome + turma, para quando o aluno esquecer o crachá
async function montarCartaoOnline() {
  const qrBox = document.getElementById("online-qr");
  if (!qrBox) return;
  try {
    const url = await QRCode.toDataURL(_aluno.matricula || _aluno.id, {
      width: 360, margin: 1, color: { dark: "#0f172a", light: "#ffffff" },
    });
    qrBox.innerHTML = `<img src="${url}" alt="QR Code de presença" />`;
  } catch {
    qrBox.innerHTML = `<div class="al-empty">Não foi possível gerar o QR.</div>`;
  }
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function baixarDataUrl(url, nome) {
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
}

async function baixarQR() {
  try {
    const url = await QRCode.toDataURL(_aluno.matricula || _aluno.id, {
      width: 720, margin: 2, color: { dark: "#0f172a", light: "#ffffff" },
    });
    baixarDataUrl(url, `qr-${_aluno.matricula}.png`);
  } catch { toast("Não foi possível gerar o QR.", "error"); }
}

async function baixarCracha(e) {
  const btn = e?.currentTarget;
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.innerHTML; btn.textContent = "Gerando…"; }
  try {
    const url = await gerarCracha(alunoBadge(), _crachaConfig, _instNome, "ambos");
    downloadCracha(url, _aluno.nome);
  } catch {
    toast("Não foi possível gerar o crachá.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.txt; }
  }
}

init();
