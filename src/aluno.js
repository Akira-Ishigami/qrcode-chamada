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
      .select("id, horario_id, horarios(materia_id)")
      .eq("turma_id", turmaId) : { data: [] },
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

  // Faltas por matéria
  const totalPorMat = {}, faltasPorMat = {};
  chamadas.forEach(c => {
    const matId = c.horarios?.materia_id;
    if (!matId) return;
    totalPorMat[matId] = (totalPorMat[matId] ?? 0) + 1;
    if (!presIds.has(c.id)) faltasPorMat[matId] = (faltasPorMat[matId] ?? 0) + 1;
  });

  _faltas = matIds.map(id => {
    const m = matCfg[id] || {};
    return {
      id, nome: m.nome ?? "Matéria",
      faltas: faltasPorMat[id] ?? 0, total: totalPorMat[id] ?? 0,
      aulas: m.aulas_semestre ?? null, limite: m.limite_faltas ?? null,
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
  professores: { t: "Meus professores",  s: "Quem leciona na sua turma" },
  cracha:      { t: "Meu crachá",        s: "Seu QR Code de presença" },
};

function renderSection(name) {
  const meta = TITULOS[name] || TITULOS.faltas;
  let corpo = "";
  if (name === "faltas")           corpo = renderFaltas(_faltas);
  else if (name === "horarios")    corpo = renderHorarios(_horarios);
  else if (name === "professores") corpo = renderProfessores(_professores);
  else if (name === "cracha")      corpo = renderCracha(_aluno);

  const wide = (name === "horarios" || name === "cracha");
  root.innerHTML = `
    <div class="al-page-head">
      <div class="al-eyebrow">Portal do aluno</div>
      <div class="al-page-title">${meta.t}</div>
      <div class="al-page-sub">${meta.s}</div>
    </div>
    ${wide ? corpo : `<div class="al-narrow">${corpo}</div>`}
  `;

  if (name === "cracha") {
    montarCracha();
    document.getElementById("dl-cracha")?.addEventListener("click", baixarCracha);
    document.getElementById("dl-qr")?.addEventListener("click", baixarQR);
  }

  if (name === "professores") {
    document.querySelectorAll(".prof-row").forEach(card => {
      card.addEventListener("click", () => abrirModalProf(_professores[+card.dataset.idx], +card.dataset.idx));
    });
  }
}

function renderFaltas(materias) {
  if (!materias.length) return `<div class="al-card"><div class="al-empty">Nenhuma matéria com aulas registradas ainda.</div></div>`;

  return materias.map(m => {
    let cor = "#16a34a", bg = "#dcfce7", txt = "#15803d", rotulo = "OK";
    if (m.limite != null) {
      if (m.faltas >= m.limite)             { cor = "#dc2626"; bg = "#fee2e2"; txt = "#b91c1c"; rotulo = "Limite atingido"; }
      else if (m.faltas / m.limite >= 0.7)  { cor = "#ea580c"; bg = "#ffedd5"; txt = "#c2410c"; rotulo = "Atenção"; }
    }
    const pct = Math.min(100, Math.round((m.limite ? m.faltas / m.limite : (m.aulas ? m.faltas / m.aulas : 0)) * 100));
    const detalhe = m.limite != null
      ? `${m.faltas} de ${m.limite} faltas permitidas${m.aulas ? ` · ${m.total}/${m.aulas} aulas dadas` : ""}`
      : `${m.faltas} falta${m.faltas !== 1 ? "s" : ""}${m.aulas ? ` · de ${m.aulas} aulas no semestre` : ` em ${m.total} aula${m.total !== 1 ? "s" : ""}`}`;

    return `
      <div class="al-card">
        <div class="fal-top">
          <span class="fal-mat">${esc(m.nome)}</span>
          <span class="fal-count" style="color:${cor}">
            ${m.faltas}${m.limite != null ? `/${m.limite}` : ""}
            <span class="fal-badge" style="background:${bg};color:${txt};margin-left:6px">${rotulo}</span>
          </span>
        </div>
        <div class="fal-bar"><div class="fal-bar-fill" style="width:${pct}%;background:${cor}"></div></div>
        <div class="fal-sub">${detalhe}</div>
      </div>`;
  }).join("");
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
      <div class="al-modal-header">
        <button class="al-modal-close" id="al-modal-close">${SVG_X}</button>
      </div>
      <div class="al-modal-photo">${p.foto ? `<img src="${p.foto}" alt="" />` : `<span>${esc(iniciais(p.nome))}</span>`}</div>
      <div class="al-modal-body">
        <div class="al-modal-eyebrow">Professor${p.materias.length !== 1 ? "(a)" : ""}</div>
        <div class="al-modal-nome">${esc(p.nome)}</div>
        <div class="al-modal-label">Matérias que leciona</div>
        <div class="al-modal-mats">
          ${p.materias.length
            ? p.materias.map((m, j) => {
                const mc = GRID_COLORS[(idx + j + 1) % GRID_COLORS.length];
                return `<span class="al-modal-mat-badge" style="background:${mc.bg};color:${mc.text}">${SVG_BOOK} ${esc(m)}</span>`;
              }).join("")
            : `<span class="al-modal-mat-badge vazio">Nenhuma matéria vinculada</span>`}
        </div>
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
