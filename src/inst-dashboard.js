import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

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

  // Verifica se veio do link "Suporte" via URL param ?view=suporte
  const urlView = new URLSearchParams(window.location.search).get("view");
  if (urlView === "suporte") {
    await renderPedidos(profile);
    return;
  }

  await render(profile);
  setupRealtime(profile);
}

let _rtChannel   = null;
let _renderTimer = null;

function setupRealtime(profile) {
  if (_rtChannel) supabase.removeChannel(_rtChannel);

  _rtChannel = supabase
    .channel("idash-chamadas-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "chamadas" }, () => {
      clearTimeout(_renderTimer);
      _renderTimer = setTimeout(() => render(profile), 1500);
    })
    .subscribe();

  window.addEventListener("beforeunload", () => {
    if (_rtChannel) supabase.removeChannel(_rtChannel);
  }, { once: true });
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
    { data: inst },
    { data: chamadas },
  ] = await Promise.all([
    supabaseAdmin.from("turmas").select("id, nome").eq("instituicao_id", instId),
    supabaseAdmin.from("alunos").select("id").eq("instituicao_id", instId),
    supabaseAdmin.from("profiles").select("id").eq("instituicao_id", instId).eq("role", "professor"),
    instId ? supabaseAdmin.from("instituicoes").select("nome").eq("id", instId).single() : { data: null },
    supabaseAdmin.from("chamadas")
      .select("id, aberta, criado_em, duracao_seg, professor_id, turmas!inner(id, nome, instituicao_id), profiles(nome)")
      .eq("data", hoje)
      .eq("turmas.instituicao_id", instId)
      .order("criado_em", { ascending: false }),
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
      <div class="idash-header-left">
        <div class="idash-greeting">${greeting}</div>
        <div class="idash-title">${instNome}</div>
      </div>
      <div class="idash-date-pill">
        <span class="idash-date-dot"></span>
        ${hora} &nbsp;&middot;&nbsp; ${data}
      </div>
    </div>

    <div class="idash-body">
      <div class="idash-stats">
        ${stat("blue",   svgTurma(), nTurmas, "Turmas",      0)}
        ${stat("green",  svgAluno(), nAlunos, "Alunos",      1)}
        ${stat("purple", svgProf(),  nProfs,  "Professores", 2)}
        ${stat("orange", svgQr(),    nCham,   nAbertas
          ? `Chamadas <span style="display:block;font-size:.58rem;font-weight:700;color:#c2410c;margin-top:3px;letter-spacing:.04em">${nAbertas} ABERTA${nAbertas>1?"S":""}</span>`
          : "Chamadas hoje", 3)}
      </div>

      <div class="idash-nav-strip">
        ${pill("turmas.html",        svgTurma(), "Turmas",      0)}
        ${pill("cadastro.html",      svgAluno(), "Alunos",      1)}
        ${pill("professores.html",   svgProf(),  "Professores", 2)}
        ${pill("relatorio-dia.html", svgRel(),   "Rel. do Dia", 3)}
      </div>

      <div class="idash-section-head">
        <span class="idash-section-title">Chamadas de Hoje</span>
        ${nAbertas > 0
          ? `<span style="font-family:'Sora',sans-serif;font-size:.6rem;font-weight:700;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;padding:4px 12px;border-radius:20px;letter-spacing:.06em">${nAbertas} ABERTA${nAbertas>1?"S":""}</span>`
          : `<span style="font-family:'Sora',sans-serif;font-size:.6rem;font-weight:600;color:#8fa4be">${nCham} registrada${nCham!==1?"s":""}</span>`}
      </div>

      ${nCham === 0 ? `
        <div class="idash-empty-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Nenhuma chamada registrada hoje.
        </div>
      ` : `
        <div class="idash-chamadas">
          <div class="idash-chamadas-header">
            <div></div>
            <div style="padding-left:14px">Turma / Professor</div>
            <div style="padding-right:18px;text-align:right">Status</div>
          </div>
          ${(chamadas ?? []).map((c, i) => {
            const horaRow = c.criado_em ? new Date(c.criado_em).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" }) : "";
            return `
            <div class="idash-cham-row ${c.aberta ? "aberta-row" : ""}" style="animation-delay:${i * .035}s"
              data-id="${c.id}" data-turma-id="${c.turmas?.id ?? ""}" data-turma="${esc(c.turmas?.nome ?? "")}" data-prof="${esc(c.profiles?.nome ?? "")}" data-hora="${horaRow}">
              <div class="idash-cham-stripe"></div>
              <div class="idash-cham-main">
                <div class="idash-cham-dot ${c.aberta ? "aberta" : "fechada"}"></div>
                <div class="idash-cham-info">
                  <div class="idash-cham-turma">${esc(c.turmas?.nome ?? "—")}</div>
                  <div class="idash-cham-meta">${[c.profiles?.nome ? esc(c.profiles.nome) : "", horaRow].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <div class="idash-cham-right">
                <span class="idash-cham-badge ${c.aberta ? "aberta" : "fechada"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
                <svg class="idash-cham-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>`;
          }).join("")}
        </div>
      `}
    </div>
  `;

  bindChamadaRows();
}

// ─── Detalhes da chamada (drawer) ────────────────────────────────────────────
function bindChamadaRows() {
  root.querySelectorAll(".idash-cham-row[data-id]").forEach(row => {
    row.addEventListener("click", () => {
      abrirDetalhesChamada(
        row.dataset.id,
        row.dataset.turmaId,
        row.dataset.turma,
        row.dataset.prof,
        row.dataset.hora
      );
    });
  });
}

async function abrirDetalhesChamada(chamadaId, turmaId, turmaNome, professor, hora) {
  // Modal centralizado
  const ov = document.createElement("div");
  ov.style.cssText = `position:fixed;inset:0;z-index:800;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);opacity:0;transition:opacity .2s`;
  ov.innerHTML = `
    <div id="det-card" style="background:var(--surface);border-radius:20px;width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.25);transform:scale(.94) translateY(10px);transition:transform .28s cubic-bezier(.22,1,.36,1)">
      <div style="padding:18px 20px 14px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:.58rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">Detalhes da chamada</div>
          <div style="font-size:1.05rem;font-weight:800;color:var(--text);letter-spacing:-.02em">${esc(turmaNome)}</div>
          ${professor ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${esc(professor)}${hora ? " · " + hora : ""}</div>` : hora ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${hora}</div>` : ""}
        </div>
        <button id="det-fechar" style="width:30px;height:30px;border-radius:50%;background:var(--surface-3);border:none;cursor:pointer;color:var(--text-2);font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div id="det-body" style="flex:1;overflow-y:auto;padding:18px 20px">
        <div style="text-align:center;padding:32px;color:var(--text-3);font-size:.875rem">Carregando…</div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  requestAnimationFrame(() => {
    ov.style.opacity = "1";
    ov.querySelector("#det-card").style.transform = "scale(1) translateY(0)";
  });

  const fechar = () => {
    ov.style.opacity = "0";
    ov.querySelector("#det-card").style.transform = "scale(.94) translateY(10px)";
    setTimeout(() => ov.remove(), 250);
  };
  ov.querySelector("#det-fechar").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  // Busca chamada (observação/duração), presenças e alunos em paralelo
  const [{ data: chamada }, { data: presencas }, { data: alunos }] = await Promise.all([
    supabaseAdmin.from("chamadas").select("observacao, duracao_seg, aberta").eq("id", chamadaId).single(),
    supabaseAdmin.from("presencas").select("aluno_id, atrasado").eq("chamada_id", chamadaId),
    turmaId ? supabaseAdmin.from("alunos").select("id, nome, matricula").eq("turma_id", turmaId).order("nome") : { data: [] },
  ]);

  const presenteIds  = new Set((presencas ?? []).map(p => p.aluno_id));
  const atrasadoIds  = new Set((presencas ?? []).filter(p => p.atrasado).map(p => p.aluno_id));
  const alunosList   = alunos ?? [];
  // Atrasado = presente com chegada tardia; ambos contam como presença
  const presentes    = alunosList.filter(a => presenteIds.has(a.id) && !atrasadoIds.has(a.id));
  const atrasados    = alunosList.filter(a => atrasadoIds.has(a.id));
  const ausentes     = alunosList.filter(a => !presenteIds.has(a.id));
  const totalPresenca = presentes.length + atrasados.length; // quem compareceu

  const fmtBadge = (label, bg, color) =>
    `<span style="font-size:.58rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${bg};color:${color}">${label}</span>`;

  const alunoRow = (a, badge) => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--surface-3);color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0">
        ${a.nome.split(" ").slice(0,2).map(n=>n[0]).join("")}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--text)">${esc(a.nome)}</div>
        <div style="font-size:.68rem;color:var(--text-3)">${esc(a.matricula ?? "")}</div>
      </div>
      ${badge}
    </div>`;

  const section = (titulo, lista, bg, color, badgeLabel) => lista.length === 0 ? "" : `
    <div style="margin-bottom:18px">
      <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px;display:flex;align-items:center;gap:7px">
        ${titulo} <span style="background:var(--surface-3);color:var(--text-3);padding:2px 7px;border-radius:10px;font-size:.65rem">${lista.length}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${lista.map(a => alunoRow(a, fmtBadge(badgeLabel, bg, color))).join("")}
      </div>
    </div>`;

  const total = alunosList.length;
  const fmtSeg = s => { const m = Math.floor(s/60); const seg = s%60; return `${String(m).padStart(2,"0")}:${String(seg).padStart(2,"0")}`; };

  const det = document.getElementById("det-body");
  if (det) det.innerHTML = `
    ${chamada?.observacao ? `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-left:3px solid var(--acc);border-radius:10px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:.58rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">Observação</div>
        <div style="font-size:.875rem;color:var(--text);line-height:1.6">${esc(chamada.observacao)}</div>
      </div>` : ""}
    ${chamada?.duracao_seg ? `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;font-size:.78rem;color:var(--text-3)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Duração: <strong style="color:var(--text)">${fmtSeg(chamada.duracao_seg)}</strong>
      </div>` : ""}
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <div style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.3rem;font-weight:800;color:var(--text)">${total}</div>
        <div style="font-size:.62rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Total</div>
      </div>
      <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.3rem;font-weight:800;color:#14532d">${totalPresenca}</div>
        <div style="font-size:.62rem;color:#14532d;text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Presentes</div>
        ${atrasados.length > 0 ? `<div style="font-size:.58rem;color:#9a3412;margin-top:3px">${atrasados.length} atrasado${atrasados.length>1?"s":""}</div>` : ""}
      </div>
      <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.3rem;font-weight:800;color:#991b1b">${ausentes.length}</div>
        <div style="font-size:.62rem;color:#991b1b;text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Ausentes</div>
      </div>
    </div>
    ${section("Presentes no horário", presentes, "#dcfce7", "#14532d", "Presente")}
    ${section("Atrasados", atrasados, "#fed7aa", "#9a3412", "Atrasado")}
    ${section("Ausentes",  ausentes,  "#fee2e2", "#991b1b", "Ausente")}
    ${total === 0 ? `<div style="text-align:center;padding:24px;color:var(--text-3);font-size:.875rem">Nenhum aluno cadastrado nesta turma.</div>` : ""}
  `;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function stat(color, icon, num, lbl, idx) {
  return `
    <div class="idash-stat ${color}" style="animation-delay:${idx * .07}s">
      <div class="idash-stat-left">
        <div class="idash-stat-icon ${color}">${icon}</div>
        <div class="idash-stat-lbl">${lbl}</div>
      </div>
      <div class="idash-stat-info">
        <div class="idash-stat-num">${num}</div>
      </div>
    </div>`;
}

function pill(href, icon, label, idx) {
  return `
    <a href="${href}" class="idash-nav-pill" style="animation-delay:${idx * .06}s">
      <div class="idash-nav-pill-icon">${icon}</div>
      <span>${label}</span>
      <svg style="margin-left:auto;opacity:.3;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
    </a>`;
}

function svgTurma()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`; }
function svgProf()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgMsg()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`; }
function svgQr()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgRel()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; }

// ── PEDIDOS — Instituição envia reclamações e pedidos de melhoria ─────────────
async function renderPedidos(profile) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const instId = profile.instituicao_id;

  const { data: pedidos } = await supabaseAdmin
    .from("pedidos")
    .select("id, tipo, titulo, descricao, status, criado_em")
    .eq("instituicao_id", instId)
    .order("criado_em", { ascending: false });

  const lista = pedidos ?? [];
  const statusLabel = { pendente: "Pendente", em_analise: "Em análise", resolvido: "Resolvido" };
  const tipoLabel   = { reclamacao: "Reclamação", melhoria: "Melhoria", outro: "Outro" };
  const fmtData = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day:"numeric", month:"short", year:"numeric" });

  // Seletor de tipo como pills clicáveis
  const tipoAtual = { value: "melhoria" };

  root.innerHTML = `
    <div style="margin-bottom:24px">
      <div style="font-family:'Outfit',sans-serif;font-size:1.45rem;font-weight:700;color:var(--text);letter-spacing:-.025em">Suporte</div>
      <div style="font-size:.8rem;color:var(--text-3);margin-top:3px">Envie reclamações ou sugestões de melhoria ao administrador</div>
    </div>

    <!-- Formulário nova solicitação -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:28px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">
        Nova solicitação
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:16px">

        <!-- Tipo como pills -->
        <div>
          <div style="font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Tipo</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="tipo-pills">
            <button class="tipo-pill active" data-tipo="melhoria" style="padding:7px 14px;border-radius:20px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--acc);background:var(--acc-sub);color:var(--acc)">
              📈 Melhoria
            </button>
            <button class="tipo-pill" data-tipo="reclamacao" style="padding:7px 14px;border-radius:20px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--surface-2);color:var(--text-2)">
              ⚠️ Reclamação
            </button>
            <button class="tipo-pill" data-tipo="outro" style="padding:7px 14px;border-radius:20px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--surface-2);color:var(--text-2)">
              💬 Outro
            </button>
          </div>
        </div>

        <!-- Título -->
        <div>
          <div style="font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">
            Título <span style="color:var(--red)">*</span>
          </div>
          <input id="sup-titulo" type="text" placeholder="Resumo em uma linha" maxlength="100"
            style="width:100%;padding:10px 13px;border:1px solid var(--border);border-radius:9px;font-size:.875rem;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;transition:border-color .13s"
            onfocus="this.style.borderColor='var(--acc)';this.style.background='#fff'"
            onblur="this.style.borderColor='var(--border)';this.style.background='var(--surface-2)'"
          />
        </div>

        <!-- Descrição -->
        <div>
          <div style="font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">
            Descrição <span style="color:var(--red)">*</span>
          </div>
          <textarea id="sup-desc" rows="4" placeholder="Descreva com detalhes o que aconteceu ou o que gostaria de melhorar..."
            style="width:100%;padding:10px 13px;border:1px solid var(--border);border-radius:9px;font-size:.875rem;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none;resize:vertical;line-height:1.65;box-sizing:border-box;transition:border-color .13s"
            onfocus="this.style.borderColor='var(--acc)';this.style.background='#fff'"
            onblur="this.style.borderColor='var(--border)';this.style.background='var(--surface-2)'"
          ></textarea>
        </div>

        <!-- Ação -->
        <div style="display:flex;align-items:center;gap:12px">
          <button id="btn-enviar-sup"
            style="padding:10px 22px;background:var(--acc);color:white;border:none;border-radius:9px;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px var(--acc-glow);transition:background .13s,transform .12s">
            Enviar solicitação
          </button>
          <span id="sup-feedback" style="font-size:.82rem;font-weight:600"></span>
        </div>
      </div>
    </div>

    <!-- Histórico -->
    <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:12px;display:flex;align-items:center;gap:8px">
      <span style="width:12px;height:2px;background:var(--text-3);border-radius:2px;display:inline-block"></span>
      Minhas solicitações (${lista.length})
    </div>
    <div id="sup-lista">
      ${lista.length === 0
        ? `<div style="background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:48px 24px;text-align:center;color:var(--text-3);font-size:.875rem">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.25;display:block;margin:0 auto 12px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
             Nenhuma solicitação enviada ainda.
           </div>`
        : lista.map((p, i) => {
          const statusConf = {
            pendente:   { label: "Pendente",   bg: "var(--amber-sub)", color: "var(--amber-text)", border: "#fde68a" },
            em_analise: { label: "Em análise", bg: "#eff6ff",          color: "var(--acc)",        border: "#bfdbfe" },
            resolvido:  { label: "Resolvido",  bg: "#dcfce7",          color: "#14532d",           border: "#86efac" },
          }[p.status] ?? { label: p.status, bg: "var(--surface-3)", color: "var(--text-3)", border: "var(--border)" };
          const tipoColors = { reclamacao: "#ef4444", melhoria: "var(--acc)", outro: "#7c3aed" };
          return `
          <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${tipoColors[p.tipo]??'var(--border)'};border-radius:12px;margin-bottom:8px;overflow:hidden;animation:idashUp .28s cubic-bezier(.22,1,.36,1) ${i*.04}s both">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:4px">${esc(p.titulo)}</div>
                <div style="font-size:.72rem;color:var(--text-3)">
                  ${tipoLabel[p.tipo]??"Outro"} · ${fmtData(p.criado_em)}
                </div>
              </div>
              <span style="font-size:.6rem;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;background:${statusConf.bg};color:${statusConf.color};border:1px solid ${statusConf.border}">
                ${statusConf.label}
              </span>
            </div>
            <div style="padding:0 16px 14px;font-size:.84rem;color:var(--text-2);line-height:1.6;border-top:1px solid var(--border);padding-top:12px">
              ${esc(p.descricao)}
            </div>
          </div>`}).join("")}
    </div>
  `;

  // Pills de tipo
  root.querySelectorAll(".tipo-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      tipoAtual.value = btn.dataset.tipo;
      root.querySelectorAll(".tipo-pill").forEach(b => {
        const active = b === btn;
        b.style.background = active ? "var(--acc-sub)" : "var(--surface-2)";
        b.style.borderColor = active ? "var(--acc)" : "var(--border)";
        b.style.color = active ? "var(--acc)" : "var(--text-2)";
      });
    });
  });

  const btnEnviar  = document.getElementById("btn-enviar-sup");
  const feedback   = document.getElementById("sup-feedback");

  btnEnviar.addEventListener("click", async () => {
    const tipo    = tipoAtual.value;
    const titulo  = document.getElementById("sup-titulo").value.trim();
    const descricao = document.getElementById("sup-desc").value.trim();

    if (!titulo)    { feedback.style.color = "var(--red)"; feedback.textContent = "Informe o título."; return; }
    if (!descricao) { feedback.style.color = "var(--red)"; feedback.textContent = "Informe a descrição."; return; }

    btnEnviar.disabled = true; btnEnviar.textContent = "Enviando…";
    feedback.textContent = "";

    const { error } = await supabaseAdmin
      .from("pedidos")
      .insert({ instituicao_id: instId, tipo, titulo, descricao });

    btnEnviar.disabled = false; btnEnviar.textContent = "Enviar solicitação";

    if (error) {
      feedback.style.color = "var(--red)"; feedback.textContent = "Erro: " + error.message;
    } else {
      feedback.style.color = "var(--green)"; feedback.textContent = "Solicitação enviada com sucesso!";
      setTimeout(() => renderPedidos(profile), 1200);
    }
  });
}

init();
