import { supabase }     from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome, email, instituicao_id")
    .eq("id", session.user.id)
    .single();

  if (!profile || profile.role !== "instituicao") {
    window.location.href = profile?.role === "admin" ? "/dashboard.html" : "/chamada.html";
    return;
  }

  await applyNavRole();

  // Nome da instituição na sidebar
  if (profile.instituicao_id) {
    const { data: inst } = await supabase
      .from("instituicoes").select("nome").eq("id", profile.instituicao_id).single();
    const el = document.getElementById("sidebar-inst-name");
    if (el && inst) el.textContent = inst.nome;
  }

  const userName = document.getElementById("sidebar-user-name");
  if (userName) userName.textContent = profile.nome || profile.email || "";

  await renderPage(profile.instituicao_id);
}

// ─── Main render ──────────────────────────────────────────────────────────────
async function renderPage(instId) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const { data: feedbacks, error } = await supabase
    .from("feedbacks")
    .select("id, tipo, titulo, descricao, status, criado_em")
    .eq("instituicao_id", instId)
    .order("criado_em", { ascending: false });

  if (error) {
    root.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">Erro: ${esc(error.message)}</div>`;
    return;
  }

  const all    = feedbacks ?? [];
  const nAbert = all.filter(f => f.status === "aberto").length;
  const nAnal  = all.filter(f => f.status === "em_analise").length;
  const nRes   = all.filter(f => f.status === "resolvido").length;

  root.innerHTML = `
    <div class="sp-header">
      <div class="sp-header-left">
        <div class="sp-eyebrow">Central de Suporte</div>
        <div class="sp-title">Meus Relatos</div>
        <div class="sp-subtitle">Acompanhe bugs e sugestões enviadas à equipe</div>
      </div>
      ${all.length > 0 ? `
        <button class="sp-btn-new" id="btn-novo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novo Relato
        </button>` : ""}
    </div>

    ${all.length > 0 ? `
      <div class="sp-stats">
        <div class="sp-stat" style="animation-delay:0s">
          <div class="sp-stat-icon amber">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div class="sp-stat-num">${nAbert}</div>
            <div class="sp-stat-lbl">Abertos</div>
          </div>
        </div>
        <div class="sp-stat" style="animation-delay:.06s">
          <div class="sp-stat-icon indigo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div>
            <div class="sp-stat-num">${nAnal}</div>
            <div class="sp-stat-lbl">Em análise</div>
          </div>
        </div>
        <div class="sp-stat" style="animation-delay:.12s">
          <div class="sp-stat-icon green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <div class="sp-stat-num">${nRes}</div>
            <div class="sp-stat-lbl">Resolvidos</div>
          </div>
        </div>
        <div class="sp-stat" style="animation-delay:.18s">
          <div class="sp-stat-icon slate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <div class="sp-stat-num">${all.length}</div>
            <div class="sp-stat-lbl">Total</div>
          </div>
        </div>
      </div>

      <div class="sp-list" id="sp-list">
        ${all.map((f, i) => ticketCard(f, i)).join("")}
      </div>
    ` : `
      <div class="sp-empty">
        <div class="sp-empty-icon">
          <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.5" width="72" height="72">
            <circle cx="40" cy="40" r="36"/>
            <path d="M30 30c0-5.5 4.5-10 10-10s10 4.5 10 10c0 6-10 10-10 14"/>
            <circle cx="40" cy="56" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div class="sp-empty-title">Nenhum relato enviado ainda</div>
        <div class="sp-empty-sub">Encontrou um problema ou tem uma sugestão? Envie para a equipe e acompanhe o progresso aqui.</div>
        <button class="sp-empty-btn" id="btn-novo-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar Primeiro Relato
        </button>
      </div>
    `}
  `;

  // Bind expand/collapse
  root.querySelectorAll(".sp-ticket").forEach(card => {
    card.querySelector(".sp-ticket-bar").addEventListener("click", () => {
      card.classList.toggle("expanded");
    });
  });

  // Bind new buttons
  root.querySelector("#btn-novo")?.addEventListener("click", () => abrirModal(instId));
  root.querySelector("#btn-novo-empty")?.addEventListener("click", () => abrirModal(instId));
}

// ─── Ticket card HTML ─────────────────────────────────────────────────────────
function ticketCard(f, i) {
  const isBug = f.tipo === "bug";
  const date  = new Date(f.criado_em).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });

  const STEPS = [
    { key: "aberto",     label: "Aberto" },
    { key: "em_analise", label: "Em análise" },
    { key: "resolvido",  label: "Resolvido" },
  ];

  const idx = STEPS.findIndex(s => s.key === f.status);

  const stepperHTML = STEPS.map((s, si) => {
    const state = si < idx ? "done" : si === idx ? "current" : "pending";
    const checkSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>`;
    const dotNum   = `<span style="font-size:.65rem;font-weight:800">${si + 1}</span>`;
    return `
      <div class="sp-step ${state}">
        <div class="sp-step-top">
          <div class="sp-step-line-l"></div>
          <div class="sp-step-dot">${state === "done" ? checkSVG : dotNum}</div>
          <div class="sp-step-line-r"></div>
        </div>
        <div class="sp-step-label">${s.label}</div>
      </div>`;
  }).join("");

  return `
    <div class="sp-ticket" style="animation-delay:${i * .05}s">
      <div class="sp-ticket-bar">
        <div class="sp-tipo-icon ${f.tipo}">
          ${isBug
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M8 2l1.5 1.5"/><path d="M14.5 3.5L16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M6.3 20A5 5 0 0 0 17.7 20"/><path d="M6.3 20a5 5 0 0 1-.8-3.2c.1-1.5.9-2.8 2-3.6L9 12"/><path d="M17.7 20a5 5 0 0 0 .8-3.2c-.1-1.5-.9-2.8-2-3.6L15 12"/><path d="M4 10c.9-1 2.3-1.7 4-1.7h8c1.7 0 3.1.7 4 1.7"/><path d="M2 14h4"/><path d="M18 14h4"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
          }
        </div>
        <div class="sp-ticket-info">
          <div class="sp-ticket-title">${esc(f.titulo)}</div>
          <div class="sp-ticket-meta">
            <span class="sp-chip ${f.tipo}">${isBug ? "Bug" : "Melhoria"}</span>
            <span class="sp-chip ${f.status}">${{ aberto: "Aberto", em_analise: "Em análise", resolvido: "Resolvido" }[f.status]}</span>
            <span class="sp-ticket-date">${date}</span>
          </div>
        </div>
        <svg class="sp-ticket-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="sp-detail">
        <div class="sp-detail-inner">
          ${f.descricao
            ? `<div class="sp-detail-desc">${esc(f.descricao)}</div>`
            : `<div class="sp-detail-no-desc">Nenhum detalhe adicional foi informado.</div>`}
          <div class="sp-stepper" data-status="${f.status}">${stepperHTML}</div>
        </div>
      </div>
    </div>`;
}

// ─── Modal novo relato ────────────────────────────────────────────────────────
function abrirModal(instId) {
  let selectedTipo = "bug";

  const overlayEl = document.getElementById("sp-modal");
  overlayEl.style.display = "flex";
  overlayEl.innerHTML = `
    <div class="sp-modal">
      <div class="sp-modal-head">
        <div>
          <div class="sp-modal-title">Novo Relato</div>
          <div class="sp-modal-sub">Descreva o problema ou sugestão</div>
        </div>
        <button class="sp-modal-close" id="sp-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sp-modal-body">
        <div class="sp-field">
          <div class="sp-label">Tipo do relato</div>
          <div class="sp-type-pick">
            <div class="sp-type-card bug selected" data-tipo="bug">
              <div class="sp-type-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 2l1.5 1.5"/><path d="M14.5 3.5L16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M6.3 20A5 5 0 0 0 17.7 20"/><path d="M6.3 20a5 5 0 0 1-.8-3.2c.1-1.5.9-2.8 2-3.6L9 12"/><path d="M17.7 20a5 5 0 0 0 .8-3.2c-.1-1.5-.9-2.8-2-3.6L15 12"/><path d="M4 10c.9-1 2.3-1.7 4-1.7h8c1.7 0 3.1.7 4 1.7"/><path d="M2 14h4"/><path d="M18 14h4"/></svg>
              </div>
              <div class="sp-type-card-label">Bug</div>
              <div class="sp-type-card-desc">Algo não está funcionando como esperado</div>
            </div>
            <div class="sp-type-card melhoria" data-tipo="melhoria">
              <div class="sp-type-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <div class="sp-type-card-label">Melhoria</div>
              <div class="sp-type-card-desc">Sugestão de nova funcionalidade ou ajuste</div>
            </div>
          </div>
        </div>
        <div class="sp-field">
          <label class="sp-label" for="sp-titulo">Título <span style="color:var(--red)">*</span></label>
          <input class="sp-input" id="sp-titulo" placeholder="Descreva brevemente em uma frase" maxlength="120" autocomplete="off"/>
        </div>
        <div class="sp-field">
          <label class="sp-label" for="sp-desc">Detalhes <span style="color:var(--text-3);font-weight:500;text-transform:none;letter-spacing:0">(opcional)</span></label>
          <textarea class="sp-textarea" id="sp-desc" placeholder="Explique com mais detalhes: o que aconteceu, quando, como reproduzir…" rows="4"></textarea>
        </div>
        <div class="sp-err" id="sp-err"></div>
      </div>
      <div class="sp-modal-foot">
        <button class="sp-btn-cancel" id="sp-cancel">Cancelar</button>
        <button class="sp-btn-submit" id="sp-submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Enviar Relato
        </button>
      </div>
    </div>`;

  setTimeout(() => overlayEl.classList.add("open"), 10);

  const fechar = () => {
    overlayEl.classList.remove("open");
    setTimeout(() => { overlayEl.style.display = "none"; overlayEl.innerHTML = ""; }, 220);
  };

  overlayEl.querySelector("#sp-close").addEventListener("click", fechar);
  overlayEl.querySelector("#sp-cancel").addEventListener("click", fechar);
  overlayEl.addEventListener("click", e => { if (e.target === overlayEl) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });
  overlayEl.querySelector("#sp-titulo").focus();

  // Type card selection
  overlayEl.querySelectorAll(".sp-type-card").forEach(card => {
    card.addEventListener("click", () => {
      overlayEl.querySelectorAll(".sp-type-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedTipo = card.dataset.tipo;
    });
  });

  // Submit
  overlayEl.querySelector("#sp-submit").addEventListener("click", async () => {
    const err    = overlayEl.querySelector("#sp-err");
    const btn    = overlayEl.querySelector("#sp-submit");
    const titulo = overlayEl.querySelector("#sp-titulo").value.trim();
    const desc   = overlayEl.querySelector("#sp-desc").value.trim();

    err.textContent = "";
    if (!titulo) { err.textContent = "Informe o título do relato."; return; }

    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Enviando…`;

    const { error } = await supabase.from("feedbacks").insert({
      instituicao_id: instId, tipo: selectedTipo, titulo, descricao: desc,
    });

    if (error) {
      err.textContent = error.message;
      btn.disabled = false;
      btn.innerHTML = `Enviar Relato`;
      return;
    }

    fechar();
    showToast("Relato enviado com sucesso!", "success");
    await renderPage(instId);
  });
}

init();
