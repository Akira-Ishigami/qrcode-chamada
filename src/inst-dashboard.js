import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

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

  // Verifica se veio do link "Pedidos" da sidebar
  if (window.__showPedidos) {
    window.__showPedidos = false;
    const navPed = document.getElementById("nav-pedidos-inst");
    if (navPed) navPed.classList.add("active");
    await renderPedidos(profile);
    return;
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

    <div class="idash-stats">
      ${stat("blue",   svgTurma(), nTurmas, "Turmas",      0)}
      ${stat("green",  svgAluno(), nAlunos, "Alunos",      1)}
      ${stat("purple", svgProf(),  nProfs,  "Professores", 2)}
      ${stat("orange", svgQr(),    nCham,   nAbertas ? `Chamadas <span style="font-size:.6rem;font-weight:700;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:middle">${nAbertas} abertas</span>` : "Chamadas hoje", 3)}
    </div>

    <div class="idash-nav-strip">
      ${pill("turmas.html",       svgTurma(), "Turmas",      0)}
      ${pill("cadastro.html",     svgAluno(), "Alunos",      1)}
      ${pill("professores.html",  svgProf(),  "Professores", 2)}
      ${pill("relatorio-dia.html",svgRel(),   "Rel. do Dia", 3)}
    </div>

    <div class="idash-section-head">
      <span class="idash-section-title">Chamadas de Hoje</span>
      ${nAbertas > 0 ? `<span style="font-size:.7rem;font-weight:700;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;padding:3px 10px;border-radius:20px">${nAbertas} aberta${nAbertas > 1 ? "s" : ""}</span>` : ""}
    </div>

    ${nCham > 0 ? `
      <div class="idash-chamadas">
        ${(chamadas ?? []).map((c, i) => `
          <div class="idash-cham-row" style="animation-delay:${i * .04}s">
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
  `;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function stat(color, icon, num, lbl, idx) {
  return `
    <div class="idash-stat" style="animation-delay:${idx * .06}s">
      <div class="idash-stat-icon ${color}">${icon}</div>
      <div class="idash-stat-info">
        <div class="idash-stat-num">${num}</div>
        <div class="idash-stat-lbl">${lbl}</div>
      </div>
    </div>`;
}

function pill(href, icon, label, idx) {
  return `
    <a href="${href}" class="idash-nav-pill" style="animation-delay:${idx * .05}s">
      ${icon}
      ${label}
    </a>`;
}

function svgTurma()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`; }
function svgProf()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgQr()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgRel()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; }

// ── PEDIDOS — Instituição envia reclamações e pedidos de melhoria ─────────────
function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

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

  root.innerHTML = `
    <div style="margin-bottom:28px">
      <div style="font-family:'Outfit',sans-serif;font-size:1.45rem;font-weight:700;color:var(--text);letter-spacing:-.025em">
        Pedidos e Reclamações
      </div>
      <div style="font-size:.8rem;color:var(--text-3);margin-top:3px">
        Envie reclamações ou sugestões de melhoria para o administrador
      </div>
    </div>

    <!-- Formulário novo pedido -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface-2);font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">
        Novo pedido
      </div>
      <div style="padding:18px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px">
            <label style="display:block;font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Tipo</label>
            <select id="ped-tipo" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:.875rem;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none">
              <option value="reclamacao">Reclamação</option>
              <option value="melhoria" selected>Pedido de melhoria</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div style="flex:2;min-width:200px">
            <label style="display:block;font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Título <span style="color:var(--red)">*</span></label>
            <input id="ped-titulo" type="text" placeholder="Resumo em uma linha" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:.875rem;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none" maxlength="100"/>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:.68rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Descrição <span style="color:var(--red)">*</span></label>
          <textarea id="ped-desc" rows="4" placeholder="Descreva em detalhes..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:9px;font-size:.875rem;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none;resize:vertical;line-height:1.6"></textarea>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <button id="btn-enviar-ped" style="padding:10px 22px;background:var(--acc);color:white;border:none;border-radius:9px;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background .13s;box-shadow:0 2px 8px var(--acc-glow)">
            Enviar pedido
          </button>
          <span id="ped-feedback" style="font-size:.82rem;font-weight:600;min-height:16px"></span>
        </div>
      </div>
    </div>

    <!-- Lista dos pedidos enviados -->
    <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:12px">
      Meus pedidos (${lista.length})
    </div>
    <div id="ped-lista">
      ${lista.length === 0
        ? `<div style="background:var(--surface);border:1px dashed var(--border-2);border-radius:13px;padding:40px 24px;text-align:center;color:var(--text-3);font-size:.875rem">
             Nenhum pedido enviado ainda.
           </div>`
        : lista.map((p, i) => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:13px;overflow:hidden;margin-bottom:8px;animation:dashUp .3s cubic-bezier(.22,1,.36,1) ${i*.05}s both">
            <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:3px">${esc(p.titulo)}</div>
                <div style="font-size:.73rem;color:var(--text-3);margin-bottom:8px">
                  ${tipoLabel[p.tipo]??"Outro"} · ${new Date(p.criado_em).toLocaleDateString("pt-BR",{day:"numeric",month:"short",year:"numeric"})}
                </div>
                <div style="font-size:.84rem;color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;line-height:1.55">${esc(p.descricao)}</div>
              </div>
              <span class="ped-status ${p.status}">${statusLabel[p.status]??"—"}</span>
            </div>
          </div>`).join("")}
    </div>
  `;

  // Foco e submit
  const btnEnviar  = document.getElementById("btn-enviar-ped");
  const feedback   = document.getElementById("ped-feedback");

  btnEnviar.addEventListener("click", async () => {
    const tipo    = document.getElementById("ped-tipo").value;
    const titulo  = document.getElementById("ped-titulo").value.trim();
    const descricao = document.getElementById("ped-desc").value.trim();

    if (!titulo)    { feedback.style.color = "var(--red)"; feedback.textContent = "Informe o título."; return; }
    if (!descricao) { feedback.style.color = "var(--red)"; feedback.textContent = "Informe a descrição."; return; }

    btnEnviar.disabled = true; btnEnviar.textContent = "Enviando…";
    feedback.textContent = "";

    const { error } = await supabaseAdmin
      .from("pedidos")
      .insert({ instituicao_id: instId, tipo, titulo, descricao });

    btnEnviar.disabled = false; btnEnviar.textContent = "Enviar pedido";

    if (error) {
      feedback.style.color = "var(--red)"; feedback.textContent = "Erro: " + error.message;
    } else {
      feedback.style.color = "var(--green)"; feedback.textContent = "Pedido enviado com sucesso!";
      setTimeout(() => renderPedidos(profile), 1200);
    }
  });
}

init();
