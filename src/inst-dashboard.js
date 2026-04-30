import { supabase }     from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

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

  await render(profile);
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
    { data: chamadas },
    { data: inst },
  ] = await Promise.all([
    supabase.from("turmas").select("id, nome").eq("instituicao_id", instId),
    supabase.from("alunos").select("id").eq("instituicao_id", instId),
    supabase.from("profiles").select("id").eq("instituicao_id", instId).eq("role", "professor"),
    supabase.from("chamadas")
      .select("id, aberta, turmas!inner(nome, professor, instituicao_id)")
      .eq("data", hoje)
      .eq("turmas.instituicao_id", instId),
    instId ? supabase.from("instituicoes").select("nome").eq("id", instId).single() : { data: null },
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
      <div>
        <div class="idash-greeting">${greeting}</div>
        <div class="idash-title">${instNome}</div>
      </div>
      <div class="idash-date-pill">
        <span class="idash-date-dot"></span>
        ${hora} · ${data}
      </div>
    </div>

    <div class="idash-body">
      <div class="idash-stats">
        ${stat("blue",   svgTurma(), nTurmas, "Turmas",      0)}
        ${stat("green",  svgAluno(), nAlunos, "Alunos",      1)}
        ${stat("purple", svgProf(),  nProfs,  "Professores", 2)}
        ${stat("orange", svgQr(),    nCham,   nAbertas ? `Chamadas hoje<br><span style="font-size:.62rem;font-weight:700;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;margin-top:2px;display:inline-block">${nAbertas} aberta${nAbertas>1?"s":""}</span>` : "Chamadas hoje", 3)}
      </div>

      <div class="idash-nav-strip">
        ${pill("turmas.html",        svgTurma(), "Turmas",      0)}
        ${pill("cadastro.html",      svgAluno(), "Alunos",      1)}
        ${pill("professores.html",   svgProf(),  "Professores", 2)}
        ${pill("relatorio-dia.html", svgRel(),   "Rel. do Dia", 3)}
      </div>

      <div class="idash-section-head">
        <span class="idash-section-title">Chamadas de Hoje</span>
        ${nAbertas > 0 ? `<span style="font-size:.68rem;font-weight:700;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;padding:3px 11px;border-radius:20px">${nAbertas} aberta${nAbertas > 1 ? "s" : ""}</span>` : ""}
      </div>

      ${nCham > 0 ? `
        <div class="idash-chamadas">
          ${(chamadas ?? []).map((c, i) => `
            <div class="idash-cham-row ${c.aberta ? "aberta-row" : ""}" style="animation-delay:${i * .04}s">
              <div class="idash-cham-dot ${c.aberta ? "aberta" : "fechada"}"></div>
              <div class="idash-cham-info">
                <div class="idash-cham-turma">${esc(c.turmas?.nome ?? "—")}</div>
                ${c.turmas?.professor ? `<div class="idash-cham-meta">${esc(c.turmas.professor)}</div>` : ""}
              </div>
              <span class="idash-cham-badge ${c.aberta ? "aberta" : "fechada"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
            </div>
          `).join("")}
        </div>
      ` : `<div class="idash-empty-box">Nenhuma chamada registrada hoje.</div>`}

      <div class="fb-section-head">
        <span class="fb-section-label">Meus Feedbacks</span>
        <button class="fb-btn-new" id="btn-novo-feedback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Relatar
        </button>
      </div>
      <div id="fb-list-wrap"></div>
    </div>
  `;

  // Carrega feedbacks da instituição
  await renderFeedbackList(instId);

  document.getElementById("btn-novo-feedback").addEventListener("click", () => abrirModalFeedback(instId));
}

async function renderFeedbackList(instId) {
  const wrap = document.getElementById("fb-list-wrap");
  if (!wrap) return;

  const { data: feedbacks, error } = await supabase
    .from("feedbacks")
    .select("id, tipo, titulo, descricao, status, criado_em")
    .eq("instituicao_id", instId)
    .order("criado_em", { ascending: false })
    .limit(20);

  if (error || !feedbacks?.length) {
    wrap.innerHTML = `<div class="idash-empty-box" style="margin-top:0">Nenhum relato enviado ainda.</div>`;
    return;
  }

  const STATUS_LABEL = { aberto: "Aberto", em_analise: "Em análise", resolvido: "Resolvido" };

  wrap.innerHTML = `
    <div class="fb-list">
      ${feedbacks.map((f, i) => `
        <div class="fb-item" style="animation-delay:${i * .04}s">
          <div class="fb-item-main">
            <div class="fb-item-title">${esc(f.titulo)}</div>
            ${f.descricao ? `<div class="fb-item-desc">${esc(f.descricao)}</div>` : ""}
            <div class="fb-item-meta">
              <span class="fb-chip ${f.tipo}">${f.tipo === "bug" ? "Bug" : "Melhoria"}</span>
              <span class="fb-chip ${f.status}">${STATUS_LABEL[f.status] ?? f.status}</span>
              <span class="fb-date-lbl">${new Date(f.criado_em).toLocaleDateString("pt-BR", { day:"numeric", month:"short", year:"numeric" })}</span>
            </div>
          </div>
        </div>`).join("")}
    </div>`;
}

function abrirModalFeedback(instId) {
  const overlay = document.createElement("div");
  overlay.className = "tv-modal-overlay";
  overlay.innerHTML = `
    <div class="tv-modal-card">
      <div class="tv-modal-head">
        <div class="tv-modal-icon inst">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div><h2>Novo Relato</h2><p>Bug ou sugestão de melhoria</p></div>
        <button class="tv-modal-x" id="fb-modal-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="tv-modal-body">
        <label class="tv-label">Tipo <span style="color:var(--red)">*</span></label>
        <select class="tv-input" id="fb-tipo">
          <option value="bug">🐛 Bug — algo não está funcionando</option>
          <option value="melhoria">✨ Melhoria — sugestão de funcionalidade</option>
        </select>
        <label class="tv-label">Título <span style="color:var(--red)">*</span></label>
        <input class="tv-input" id="fb-titulo" placeholder="Descreva brevemente o problema ou sugestão" maxlength="120" autocomplete="off"/>
        <label class="tv-label">Detalhes</label>
        <textarea class="tv-input" id="fb-desc" rows="3" placeholder="Explique com mais detalhes (opcional)" style="resize:vertical"></textarea>
        <div class="tv-modal-err" id="fb-err"></div>
      </div>
      <div class="tv-modal-foot">
        <button class="tv-btn-ghost" id="fb-cancel">Cancelar</button>
        <button class="tv-btn-add" id="fb-ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Enviar
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("open"), 10);

  const fechar = () => overlay.remove();
  overlay.querySelector("#fb-modal-x").addEventListener("click", fechar);
  overlay.querySelector("#fb-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  overlay.querySelector("#fb-titulo").focus();

  overlay.querySelector("#fb-ok").addEventListener("click", async () => {
    const err    = overlay.querySelector("#fb-err");
    const btn    = overlay.querySelector("#fb-ok");
    const tipo   = overlay.querySelector("#fb-tipo").value;
    const titulo = overlay.querySelector("#fb-titulo").value.trim();
    const desc   = overlay.querySelector("#fb-desc").value.trim();

    err.textContent = "";
    if (!titulo) { err.textContent = "Informe o título."; return; }

    btn.disabled = true; btn.textContent = "Enviando…";

    const { error } = await supabase.from("feedbacks").insert({
      instituicao_id: instId, tipo, titulo, descricao: desc,
    });

    if (error) {
      err.textContent = error.message;
      btn.disabled = false; btn.textContent = "Enviar";
      return;
    }

    fechar();
    showToast("Relato enviado!", "success");
    await renderFeedbackList(instId);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function stat(color, icon, num, lbl, idx) {
  return `
    <div class="idash-stat ${color}" style="animation-delay:${idx * .07}s">
      <div class="idash-stat-icon ${color}">${icon}</div>
      <div class="idash-stat-info">
        <div class="idash-stat-num">${num}</div>
        <div class="idash-stat-lbl">${lbl}</div>
      </div>
    </div>`;
}

function pill(href, icon, label, idx) {
  return `
    <a href="${href}" class="idash-nav-pill" style="animation-delay:${idx * .06}s">
      <div class="idash-nav-pill-icon">${icon}</div>
      <span>${label}</span>
    </a>`;
}

function svgTurma()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`; }
function svgProf()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgQr()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgRel()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; }

init();
