import { supabase }     from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");
let _instId   = null;
let _userId   = null;
let _rtSub      = null;   // realtime mensagens do chat aberto
let _statusSub  = null;   // realtime mudança de status do ticket aberto

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function fmtDate(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (d.toDateString() === hoje.toDateString())  return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(s) {
  return { aberto: "Aberto", em_andamento: "Em andamento", finalizado: "Finalizado" }[s] || s;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome, email, instituicao_id, id")
    .eq("id", session.user.id)
    .single();

  if (!profile || profile.role !== "instituicao") {
    window.location.href = profile?.role === "admin" ? "/dashboard.html" : "/chamada.html";
    return;
  }

  _instId = profile.instituicao_id;
  _userId = profile.id;

  await applyNavRole();

  if (profile.instituicao_id) {
    const { data: inst } = await supabase
      .from("instituicoes").select("nome").eq("id", profile.instituicao_id).single();
    const el = document.getElementById("sidebar-inst-name");
    if (el && inst) el.textContent = inst.nome;
  }

  const userName = document.getElementById("sidebar-user-name");
  if (userName) userName.textContent = profile.nome || profile.email || "";

  await renderList();
}

// ─── TELA 1: Lista de tickets ─────────────────────────────────────────────────
async function renderList() {
  unsubscribeRealtime();
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const { data: feedbacks, error } = await supabase
    .from("feedbacks")
    .select("id, tipo, titulo, descricao, status, criado_em, suporte_mensagens(id, texto, autor_role, criado_em)")
    .eq("instituicao_id", _instId)
    .order("criado_em", { ascending: false });

  if (error) {
    root.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">Erro: ${esc(error.message)}</div>`;
    return;
  }

  const all    = feedbacks ?? [];
  const nAbert = all.filter(f => f.status === "aberto").length;
  const nAnal  = all.filter(f => f.status === "em_andamento").length;
  const nRes   = all.filter(f => f.status === "finalizado").length;

  root.innerHTML = `
    <div class="sp-header">
      <div class="sp-header-left">
        <div class="sp-eyebrow">Central de Suporte</div>
        <div class="sp-title">Meus Chamados</div>
        <div class="sp-subtitle">Clique em um chamado para ver a conversa</div>
      </div>
      <button class="sp-btn-new" id="btn-novo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Chamado
      </button>
    </div>

    ${all.length > 0 ? `
      <div class="sp-stats">
        <div class="sp-stat" style="animation-delay:0s">
          <div class="sp-stat-icon amber">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div><div class="sp-stat-num">${nAbert}</div><div class="sp-stat-lbl">Abertos</div></div>
        </div>
        <div class="sp-stat" style="animation-delay:.06s">
          <div class="sp-stat-icon indigo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div><div class="sp-stat-num">${nAnal}</div><div class="sp-stat-lbl">Em análise</div></div>
        </div>
        <div class="sp-stat" style="animation-delay:.12s">
          <div class="sp-stat-icon green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div><div class="sp-stat-num">${nRes}</div><div class="sp-stat-lbl">Resolvidos</div></div>
        </div>
      </div>
    ` : ""}

    ${all.length === 0 ? `
      <div class="sp-empty">
        <div class="sp-empty-icon">
          <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.5" width="72" height="72">
            <circle cx="40" cy="40" r="36"/>
            <path d="M30 30c0-5.5 4.5-10 10-10s10 4.5 10 10c0 6-10 10-10 14"/>
            <circle cx="40" cy="56" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div class="sp-empty-title">Nenhum chamado ainda</div>
        <div class="sp-empty-sub">Encontrou um problema ou tem uma sugestão? Abra um chamado e converse com a equipe.</div>
        <button class="sp-empty-btn" id="btn-novo-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Abrir Primeiro Chamado
        </button>
      </div>
    ` : `
      <div class="sp-list" id="sp-list"></div>
    `}
  `;

  root.querySelector("#btn-novo")?.addEventListener("click", () => abrirModalNovoRelato());
  root.querySelector("#btn-novo-empty")?.addEventListener("click", () => abrirModalNovoRelato());

  if (all.length > 0) {
    const lista = root.querySelector("#sp-list");
    all.forEach((f, i) => {
      const msgs  = (f.suporte_mensagens ?? []).sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
      const last  = msgs[0];
      const isBug = f.tipo === "bug";

      const card = document.createElement("div");
      card.className = "sp-ticket-row";
      card.dataset.id = f.id;
      card.style.animationDelay = `${i * 0.04}s`;
      card.innerHTML = `
        <div class="sp-tr-icon ${f.tipo}">
          ${isBug
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M8 2l1.5 1.5"/><path d="M14.5 3.5L16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M6.3 20A5 5 0 0 0 17.7 20"/><path d="M6.3 20a5 5 0 0 1-.8-3.2c.1-1.5.9-2.8 2-3.6L9 12"/><path d="M17.7 20a5 5 0 0 0 .8-3.2c-.1-1.5-.9-2.8-2-3.6L15 12"/><path d="M4 10c.9-1 2.3-1.7 4-1.7h8c1.7 0 3.1.7 4 1.7"/><path d="M2 14h4"/><path d="M18 14h4"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
          }
        </div>
        <div class="sp-tr-body">
          <div class="sp-tr-top">
            <span class="sp-tr-title">${esc(f.titulo)}</span>
            <span class="sp-tr-time">${last ? fmtDate(last.criado_em) : fmtDate(f.criado_em)}</span>
          </div>
          <div class="sp-tr-preview">${last ? esc(last.texto) : (f.descricao ? esc(f.descricao) : "Sem mensagens ainda")}</div>
          <div class="sp-tr-chips">
            <span class="sp-chip ${f.tipo}">${isBug ? "Bug" : "Melhoria"}</span>
            <span class="sp-chip ${f.status}">${statusLabel(f.status)}</span>
          </div>
        </div>
        <svg class="sp-tr-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      card.addEventListener("click", () => renderChat(f));
      lista.appendChild(card);
    });
  }
}

// ─── TELA 2: Chat do ticket ───────────────────────────────────────────────────
async function renderChat(ticket) {
  unsubscribeRealtime();
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando conversa…</div>`;

  const { data: msgs, error } = await supabase
    .from("suporte_mensagens")
    .select("id, autor_id, autor_role, texto, imagem_base64, criado_em")
    .eq("feedback_id", ticket.id)
    .order("criado_em", { ascending: true });

  if (error) {
    root.innerHTML = `<div style="padding:40px;color:var(--red)">Erro: ${esc(error.message)}</div>`;
    return;
  }

  const isBug = ticket.tipo === "bug";

  root.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-header">
        <button class="chat-back" id="chat-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
          Chamados
        </button>
        <div class="chat-header-info">
          <div class="chat-header-title">${esc(ticket.titulo)}</div>
          <div class="chat-header-chips">
            <span class="sp-chip ${ticket.tipo}">${isBug ? "Bug" : "Melhoria"}</span>
            <span class="sp-chip ${ticket.status}" id="chat-status-chip">${statusLabel(ticket.status)}</span>
          </div>
        </div>
      </div>

      <div class="chat-messages" id="chat-messages">
        ${ticket.descricao ? `
          <div class="chat-original">
            <div class="chat-original-label">Relato original</div>
            <div class="chat-original-text">${esc(ticket.descricao)}</div>
          </div>
        ` : ""}
        <div id="chat-bubbles"></div>
        ${msgs.length === 0 && !ticket.descricao ? `
          <div class="chat-no-msgs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.2;margin-bottom:8px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p>Nenhuma mensagem ainda.<br>Envie uma mensagem para a equipe.</p>
          </div>
        ` : ""}
      </div>

      ${ticket.status !== "finalizado" ? `
        <div class="chat-img-preview" id="chat-img-preview" style="display:none">
          <img id="chat-img-thumb" src="" alt="preview">
          <button class="chat-img-remove" id="chat-img-remove" title="Remover imagem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="chat-input-bar">
          <label class="chat-img-btn" title="Enviar imagem">
            <input type="file" id="chat-img-input" accept="image/*" style="display:none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </label>
          <textarea class="chat-input" id="chat-input" placeholder="Escreva uma mensagem…" rows="1"></textarea>
          <button class="chat-send" id="chat-send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      ` : `
        <div class="chat-resolved-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
          Chamado finalizado — não é possível enviar mensagens
        </div>
      `}
    </div>
  `;

  document.getElementById("chat-back").addEventListener("click", renderList);

  // Renderiza mensagens existentes
  const bubblesEl = document.getElementById("chat-bubbles");
  (msgs ?? []).forEach(m => bubblesEl.appendChild(buildBubble(m)));
  scrollBottom();

  // ── Input de texto ──────────────────────────────────────────────────────────
  const inputEl = document.getElementById("chat-input");
  inputEl?.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doEnviar(); }
  });
  document.getElementById("chat-send")?.addEventListener("click", doEnviar);

  // ── Seleção de imagem ───────────────────────────────────────────────────────
  let _imgBase64 = null;

  const fileInput  = document.getElementById("chat-img-input");
  const imgPreview = document.getElementById("chat-img-preview");
  const imgThumb   = document.getElementById("chat-img-thumb");

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast("Imagem muito grande. Máximo 3 MB.", "error"); fileInput.value = ""; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      _imgBase64 = e.target.result;
      imgThumb.src = _imgBase64;
      imgPreview.style.display = "flex";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("chat-img-remove")?.addEventListener("click", () => {
    _imgBase64 = null;
    fileInput.value = "";
    imgThumb.src = "";
    imgPreview.style.display = "none";
  });

  function doEnviar() {
    const texto = inputEl?.value.trim() || "";
    if (!texto && !_imgBase64) return;
    enviarMensagem(ticket.id, inputEl, _imgBase64);
    // Limpa imagem
    _imgBase64 = null;
    if (fileInput) fileInput.value = "";
    if (imgThumb) imgThumb.src = "";
    if (imgPreview) imgPreview.style.display = "none";
  }

  // Realtime: novas mensagens do admin aparecem em tempo real
  // Re-busca por ID para contornar limite de payload (imagens base64 grandes)
  _rtSub = supabase
    .channel(`chat-msgs-${ticket.id}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "suporte_mensagens",
      filter: `feedback_id=eq.${ticket.id}`,
    }, async (payload) => {
      const id = payload.new?.id;
      if (!id || payload.new?.autor_id === _userId) return;
      const { data: m } = await supabase
        .from("suporte_mensagens")
        .select("id, autor_id, autor_role, texto, imagem_base64, criado_em")
        .eq("id", id)
        .single();
      if (!m) return;
      bubblesEl.appendChild(buildBubble(m));
      scrollBottom();
    })
    .subscribe();

  // Realtime: status do ticket muda quando admin atualiza
  _statusSub = supabase
    .channel(`chat-status-${ticket.id}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "feedbacks",
      filter: `id=eq.${ticket.id}`,
    }, (payload) => {
      const novoStatus = payload.new.status;
      if (novoStatus === ticket.status) return;
      ticket.status = novoStatus;

      // Atualiza chip de status no header
      const chip = document.getElementById("chat-status-chip");
      if (chip) { chip.textContent = statusLabel(novoStatus); chip.className = `sp-chip ${novoStatus}`; }

      // Atualiza chip na lista de tickets
      const listChip = document.querySelector(`.sp-ticket-row[data-id="${ticket.id}"] .sp-chip:last-child`);
      if (listChip) { listChip.textContent = statusLabel(novoStatus); listChip.className = `sp-chip ${novoStatus}`; }

      // Mostra/esconde input conforme status
      const inputBar  = document.querySelector(".chat-input-bar");
      const encerrado = document.querySelector(".chat-resolved-bar");
      if (novoStatus === "finalizado") {
        if (inputBar) inputBar.outerHTML = `<div class="chat-resolved-bar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>Chamado finalizado — não é possível enviar mensagens</div>`;
      } else if (encerrado) {
        encerrado.outerHTML = `<div class="chat-input-bar"><textarea class="chat-input" id="chat-input" placeholder="Escreva uma mensagem…" rows="1"></textarea><button class="chat-send" id="chat-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>`;
        const newInput = document.getElementById("chat-input");
        newInput?.addEventListener("input", () => { newInput.style.height = "auto"; newInput.style.height = Math.min(newInput.scrollHeight,120)+"px"; });
        newInput?.addEventListener("keydown", e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();enviarMensagem(ticket.id,newInput);} });
        document.getElementById("chat-send")?.addEventListener("click", () => enviarMensagem(ticket.id, newInput));
      }

      // Toast informando a mudança
      const labels = { aberto: "Chamado reaberto", em_andamento: "Chamado em andamento", finalizado: "Chamado finalizado" };
      showToast(labels[novoStatus] ?? "Status atualizado", "");
    })
    .subscribe();
}

function buildBubble(msg) {
  const isMine = msg.autor_role === "instituicao";
  const wrap = document.createElement("div");
  wrap.className = `chat-bubble-wrap ${isMine ? "mine" : "theirs"}`;

  const conteudo = [
    msg.imagem_base64 ? `<img class="chat-bubble-img" src="${msg.imagem_base64}" alt="imagem" style="cursor:zoom-in" onclick="this.requestFullscreen?.()">` : "",
    msg.texto ? `<span>${esc(msg.texto).replace(/\n/g, "<br>")}</span>` : "",
  ].filter(Boolean).join("");

  wrap.innerHTML = `
    ${!isMine ? `<div class="chat-bubble-avatar">S</div>` : ""}
    <div class="chat-bubble-col">
      ${!isMine ? `<div class="chat-bubble-name">Suporte</div>` : ""}
      <div class="chat-bubble ${isMine ? "mine" : "theirs"} ${msg.imagem_base64 ? "has-img" : ""}">${conteudo}</div>
      <div class="chat-bubble-time">${fmtTime(msg.criado_em)}</div>
    </div>
  `;
  return wrap;
}

async function enviarMensagem(ticketId, inputEl, imgBase64 = null) {
  const texto = inputEl?.value.trim() || "";
  if (!texto && !imgBase64) return;

  if (inputEl) { inputEl.value = ""; inputEl.style.height = "auto"; }

  // Bolha otimista
  const fakeMsg = { autor_id: _userId, autor_role: "instituicao", texto: texto || null, imagem_base64: imgBase64, criado_em: new Date().toISOString() };
  const bubblesEl = document.getElementById("chat-bubbles");
  if (bubblesEl) { bubblesEl.appendChild(buildBubble(fakeMsg)); scrollBottom(); }

  const payload = { feedback_id: ticketId, autor_id: _userId, autor_role: "instituicao" };
  if (texto)     payload.texto          = texto;
  if (imgBase64) payload.imagem_base64  = imgBase64;

  const { error } = await supabase.from("suporte_mensagens").insert(payload);
  if (error) showToast("Erro ao enviar mensagem.", "error");
}

function scrollBottom() {
  const el = document.getElementById("chat-messages");
  if (el) el.scrollTop = el.scrollHeight;
}

function unsubscribeRealtime() {
  if (_rtSub)     { supabase.removeChannel(_rtSub);     _rtSub     = null; }
  if (_statusSub) { supabase.removeChannel(_statusSub); _statusSub = null; }
}

// ─── Modal novo chamado ───────────────────────────────────────────────────────
function abrirModalNovoRelato() {
  let selectedTipo = "bug";

  const overlayEl = document.getElementById("sp-modal");
  overlayEl.style.display = "flex";
  overlayEl.innerHTML = `
    <div class="sp-modal">
      <div class="sp-modal-head">
        <div>
          <div class="sp-modal-title">Novo Chamado</div>
          <div class="sp-modal-sub">Descreva o problema ou sugestão</div>
        </div>
        <button class="sp-modal-close" id="sp-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sp-modal-body">
        <div class="sp-field">
          <div class="sp-label">Tipo</div>
          <div class="sp-type-pick">
            <div class="sp-type-card bug selected" data-tipo="bug">
              <div class="sp-type-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 2l1.5 1.5"/><path d="M14.5 3.5L16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M6.3 20A5 5 0 0 0 17.7 20"/><path d="M6.3 20a5 5 0 0 1-.8-3.2c.1-1.5.9-2.8 2-3.6L9 12"/><path d="M17.7 20a5 5 0 0 0 .8-3.2c-.1-1.5-.9-2.8-2-3.6L15 12"/><path d="M4 10c.9-1 2.3-1.7 4-1.7h8c1.7 0 3.1.7 4 1.7"/><path d="M2 14h4"/><path d="M18 14h4"/></svg>
              </div>
              <div class="sp-type-card-label">Bug</div>
              <div class="sp-type-card-desc">Algo não está funcionando</div>
            </div>
            <div class="sp-type-card melhoria" data-tipo="melhoria">
              <div class="sp-type-card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <div class="sp-type-card-label">Melhoria</div>
              <div class="sp-type-card-desc">Sugestão de funcionalidade</div>
            </div>
          </div>
        </div>
        <div class="sp-field">
          <label class="sp-label" for="sp-titulo">Título <span style="color:var(--red)">*</span></label>
          <input class="sp-input" id="sp-titulo" placeholder="Descreva brevemente o chamado" maxlength="120" autocomplete="off"/>
        </div>
        <div class="sp-field">
          <label class="sp-label" for="sp-desc">Detalhes <span style="color:var(--text-3);font-weight:500;text-transform:none;letter-spacing:0">(opcional)</span></label>
          <textarea class="sp-textarea" id="sp-desc" placeholder="O que aconteceu? Como reproduzir?" rows="4"></textarea>
        </div>
        <div class="sp-err" id="sp-err"></div>
      </div>
      <div class="sp-modal-foot">
        <button class="sp-btn-cancel" id="sp-cancel">Cancelar</button>
        <button class="sp-btn-submit" id="sp-submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Abrir Chamado
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

  overlayEl.querySelectorAll(".sp-type-card").forEach(card => {
    card.addEventListener("click", () => {
      overlayEl.querySelectorAll(".sp-type-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedTipo = card.dataset.tipo;
    });
  });

  overlayEl.querySelector("#sp-submit").addEventListener("click", async () => {
    const err    = overlayEl.querySelector("#sp-err");
    const btn    = overlayEl.querySelector("#sp-submit");
    const titulo = overlayEl.querySelector("#sp-titulo").value.trim();
    const desc   = overlayEl.querySelector("#sp-desc").value.trim();

    err.textContent = "";
    if (!titulo) { err.textContent = "Informe o título do chamado."; return; }

    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Abrindo…`;

    const { data: newTicket, error: insErr } = await supabase
      .from("feedbacks")
      .insert({ instituicao_id: _instId, tipo: selectedTipo, titulo, descricao: desc })
      .select()
      .single();

    if (insErr) {
      err.textContent = insErr.message;
      btn.disabled = false;
      btn.innerHTML = "Abrir Chamado";
      return;
    }

    fechar();
    showToast("Chamado aberto!", "success");
    // Abre direto o chat do novo ticket
    await renderChat(newTicket);
  });
}

init();
