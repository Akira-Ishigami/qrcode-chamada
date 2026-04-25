import { supabase } from "./supabase.js";
import { podeAdmin } from "./nav-role.js";

const root = document.getElementById("page-root");

// ─── Estado ───────────────────────────────────────────────────────────────────
let instAtualId   = null;
let instAtualNome = "";

// ─── Ícones SVG reutilizáveis ────────────────────────────────────────────────
const SVG_INST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="24" height="24">
  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
</svg>`;

const SVG_TURMA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="24" height="24">
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
  <circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
</svg>`;

const SVG_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15">
  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

const SVG_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
  <polyline points="15 18 9 12 15 6"/>
</svg>`;

const SVG_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
  <path d="M10 11v6"/><path d="M14 11v6"/>
  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
</svg>`;

const SVG_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
  <polyline points="9 18 15 12 9 6"/>
</svg>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 3500);
}

function ripple(el, e) {
  const r    = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const sp   = document.createElement("span");
  sp.className = "t-ripple";
  sp.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-r.left-size/2}px;top:${e.clientY-r.top-size/2}px`;
  el.appendChild(sp);
  sp.addEventListener("animationend", () => sp.remove());
}

function setSkeleton(n = 4) {
  root.innerHTML = `
    <div class="tv-header">
      <div class="tv-header-left">
        <div class="tv-icon inst">${SVG_INST}</div>
        <div><div class="tv-title skel-line" style="width:180px;height:28px;border-radius:8px"></div>
        <div class="skel-line" style="width:140px;height:14px;border-radius:6px;margin-top:6px"></div></div>
      </div>
    </div>
    <div class="tv-grid">${Array(n).fill('<div class="tv-card skel-card" style="height:148px"></div>').join("")}</div>
  `;
}

// ─── TELA 1: Instituições ─────────────────────────────────────────────────────
async function renderInstituicoes() {
  instAtualId = null; instAtualNome = "";
  setSkeleton(4);

  const { data, error } = await supabase
    .from("instituicoes").select("id, nome").order("nome");

  if (error) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar: ${error.message}</div>`;
    return;
  }

  // Contagem de turmas
  const { data: td } = await supabase.from("turmas").select("id, instituicao_id");
  const porInst = {};
  (td ?? []).forEach(t => { porInst[t.instituicao_id] = (porInst[t.instituicao_id] ?? 0) + 1; });

  const lista = data ?? [];

  // Monta HTML
  root.innerHTML = `
    <div class="tv-header">
      <div class="tv-header-left">
        <div class="tv-icon inst">${SVG_INST}</div>
        <div>
          <h1 class="tv-title">Instituições <span class="tv-pill">${lista.length}</span></h1>
          <p class="tv-sub">Clique em uma instituição para ver suas turmas</p>
        </div>
      </div>
      <button class="tv-btn-add" id="btn-add-inst">${SVG_PLUS} Nova Instituição</button>
    </div>

    ${lista.length === 0 ? `
      <div class="tv-empty">
        <div class="tv-empty-icon inst">${SVG_INST}</div>
        <h3>Nenhuma instituição ainda</h3>
        <p>Crie sua primeira instituição para começar a organizar turmas e chamadas.</p>
        <button class="tv-btn-add" id="btn-add-inst-empty">${SVG_PLUS} Criar Instituição</button>
      </div>
    ` : `
      <div class="tv-grid" id="inst-grid"></div>
    `}
  `;

  document.getElementById("btn-add-inst")?.addEventListener("click", () => abrirModal("inst"));
  document.getElementById("btn-add-inst-empty")?.addEventListener("click", () => abrirModal("inst"));

  if (lista.length > 0) {
    const grid = document.getElementById("inst-grid");
    lista.forEach((inst, i) => {
      const qtd  = porInst[inst.id] ?? 0;
      const card = document.createElement("div");
      card.className = "tv-card inst-card";
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="tvc-head">
          <div class="tvc-avatar inst">${SVG_INST}</div>
          <button class="tvc-del" title="Excluir">${SVG_TRASH}</button>
        </div>
        <div class="tvc-name">${inst.nome}</div>
        <div class="tvc-meta">
          <span class="tvc-dot"></span>
          ${qtd === 0 ? "Sem turmas" : qtd === 1 ? "1 turma" : `${qtd} turmas`}
        </div>
        <div class="tvc-footer">
          <span class="tvc-badge inst">${SVG_TURMA} ${qtd}</span>
          <span class="tvc-enter">Ver turmas ${SVG_ARROW}</span>
        </div>
      `;
      card.addEventListener("click", e => {
        if (e.target.closest(".tvc-del")) return;
        ripple(card, e);
        setTimeout(() => renderTurmas(inst.id, inst.nome), 110);
      });
      card.querySelector(".tvc-del").addEventListener("click", e => {
        e.stopPropagation();
        deletarInstituicao(inst.id, inst.nome);
      });
      grid.appendChild(card);
    });
  }
}

// ─── TELA 2: Turmas da instituição ────────────────────────────────────────────
async function renderTurmas(instId, instNome) {
  instAtualId = instId; instAtualNome = instNome;
  setSkeleton(3);

  const { data, error } = await supabase
    .from("turmas").select("id, nome, professor, horario")
    .eq("instituicao_id", instId).order("nome");

  if (error) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar: ${error.message}</div>`;
    return;
  }

  const lista = data ?? [];

  root.innerHTML = `
    <div class="tv-breadcrumb">
      <button class="tv-btn-back" id="btn-back">${SVG_BACK} Instituições</button>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="color:#cbd5e1"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="tv-bc-name">${instNome}</span>
    </div>

    <div class="tv-header">
      <div class="tv-header-left">
        <div class="tv-icon turma">${SVG_TURMA}</div>
        <div>
          <h1 class="tv-title">Turmas <span class="tv-pill green">${lista.length}</span></h1>
          <p class="tv-sub">${instNome}</p>
        </div>
      </div>
      <button class="tv-btn-add green" id="btn-add-turma">${SVG_PLUS} Nova Turma</button>
    </div>

    ${lista.length === 0 ? `
      <div class="tv-empty">
        <div class="tv-empty-icon turma">${SVG_TURMA}</div>
        <h3>Nenhuma turma ainda</h3>
        <p>Esta instituição ainda não tem turmas. Adicione a primeira para iniciar chamadas.</p>
        <button class="tv-btn-add green" id="btn-add-turma-empty">${SVG_PLUS} Criar Turma</button>
      </div>
    ` : `
      <div class="tv-grid" id="turma-grid"></div>
    `}
  `;

  document.getElementById("btn-back")?.addEventListener("click", renderInstituicoes);
  document.getElementById("btn-add-turma")?.addEventListener("click", () => abrirModal("turma"));
  document.getElementById("btn-add-turma-empty")?.addEventListener("click", () => abrirModal("turma"));

  if (lista.length > 0) {
    const grid = document.getElementById("turma-grid");
    lista.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "tv-card turma-card";
      card.style.animationDelay = `${i * 0.05}s`;

      const tags = [];
      if (t.professor) tags.push(`<span class="tv-tag">${t.professor}</span>`);
      if (t.horario)   tags.push(`<span class="tv-tag">${t.horario}</span>`);

      card.innerHTML = `
        <div class="tvc-head">
          <div class="tvc-avatar turma">${SVG_TURMA}</div>
          <button class="tvc-del" title="Excluir">${SVG_TRASH}</button>
        </div>
        <div class="tvc-name">${t.nome}</div>
        ${tags.length ? `<div class="tv-tags">${tags.join("")}</div>` : ""}
        <div class="tvc-footer">
          <span class="tvc-badge turma">Ativa</span>
        </div>
      `;

      card.querySelector(".tvc-del").addEventListener("click", () => deletarTurma(t.id, t.nome));
      grid.appendChild(card);
    });
  }
}

// ─── Modal genérico ───────────────────────────────────────────────────────────
function abrirModal(tipo) {
  // Remove modal existente
  document.getElementById("tv-modal")?.remove();

  const isInst = tipo === "inst";
  const overlay = document.createElement("div");
  overlay.id = "tv-modal";
  overlay.className = "tv-modal-overlay";

  overlay.innerHTML = `
    <div class="tv-modal-card">
      <div class="tv-modal-head">
        <div class="tv-modal-icon ${isInst ? "inst" : "turma"}">${isInst ? SVG_INST : SVG_TURMA}</div>
        <div>
          <h2>${isInst ? "Nova Instituição" : "Nova Turma"}</h2>
          <p>${isInst ? "Escola, faculdade ou centro educacional" : instAtualNome}</p>
        </div>
        <button class="tv-modal-x" id="modal-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="tv-modal-body">
        ${isInst ? `
          <label class="tv-label">Nome da instituição</label>
          <input class="tv-input" id="mi-nome" placeholder="Ex: Escola Estadual João Silva" autocomplete="off" />
        ` : `
          <label class="tv-label">Nome da turma <span style="color:var(--red)">*</span></label>
          <input class="tv-input" id="mt-nome" placeholder="Ex: Turma A, 1º Ano Noturno" autocomplete="off" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">
            <div>
              <label class="tv-label">Professor</label>
              <input class="tv-input" id="mt-prof" placeholder="Nome do professor" />
            </div>
            <div>
              <label class="tv-label">Horário</label>
              <input class="tv-input" id="mt-hor" placeholder="Ex: Seg 19h" />
            </div>
          </div>
        `}
        <div class="tv-modal-err" id="modal-err"></div>
      </div>

      <div class="tv-modal-foot">
        <button class="tv-btn-ghost" id="modal-cancel">Cancelar</button>
        <button class="tv-btn-add ${isInst ? "" : "green"}" id="modal-ok">
          ${SVG_PLUS} ${isInst ? "Adicionar" : "Adicionar Turma"}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("open"), 10);

  const fechar = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.getElementById("modal-x").addEventListener("click", fechar);
  document.getElementById("modal-cancel").addEventListener("click", fechar);

  const firstInput = overlay.querySelector(".tv-input");
  setTimeout(() => firstInput?.focus(), 150);

  document.getElementById("modal-ok").addEventListener("click", async () => {
    const err = document.getElementById("modal-err");
    err.textContent = "";
    const btn = document.getElementById("modal-ok");
    btn.disabled = true;
    btn.innerHTML = `<svg style="animation:spin .8s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Salvando...`;

    if (isInst) {
      const nome = document.getElementById("mi-nome")?.value.trim();
      if (!nome) { err.textContent = "Informe o nome."; btn.disabled = false; btn.innerHTML = `${SVG_PLUS} Adicionar`; return; }
      const { data, error } = await supabase.from("instituicoes").insert({ nome }).select("id").single();
      if (error) { err.textContent = error.code === "23505" ? "Nome já existe." : error.message; btn.disabled = false; btn.innerHTML = `${SVG_PLUS} Adicionar`; return; }
      fechar();
      showToast(`"${nome}" adicionada!`, "success");
      await renderInstituicoes();
      renderTurmas(data.id, nome);
    } else {
      const nome    = document.getElementById("mt-nome")?.value.trim();
      const prof    = document.getElementById("mt-prof")?.value.trim() || null;
      const horario = document.getElementById("mt-hor")?.value.trim()  || null;
      if (!nome) { err.textContent = "Informe o nome da turma."; btn.disabled = false; btn.innerHTML = `${SVG_PLUS} Adicionar Turma`; return; }
      const { error } = await supabase.from("turmas").insert({ nome, professor: prof, horario, instituicao_id: instAtualId });
      if (error) { err.textContent = "Erro: " + error.message; btn.disabled = false; btn.innerHTML = `${SVG_PLUS} Adicionar Turma`; return; }
      fechar();
      showToast(`Turma "${nome}" adicionada!`, "success");
      renderTurmas(instAtualId, instAtualNome);
    }
  });

  overlay.querySelector(".tv-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("modal-ok")?.click();
  });

  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });
}

// ─── Deletar ──────────────────────────────────────────────────────────────────
async function deletarInstituicao(id, nome) {
  if (!confirm(`Excluir "${nome}"? Só é possível se não houver turmas vinculadas.`)) return;
  const { error } = await supabase.from("instituicoes").delete().eq("id", id);
  if (error) { showToast("Não é possível excluir: existem dados vinculados.", "error"); return; }
  showToast(`"${nome}" excluída.`, "success");
  renderInstituicoes();
}

async function deletarTurma(id, nome) {
  if (!confirm(`Excluir turma "${nome}"? Só é possível se não houver chamadas vinculadas.`)) return;
  const { error } = await supabase.from("turmas").delete().eq("id", id);
  if (error) { showToast("Não é possível excluir: existem dados vinculados.", "error"); return; }
  showToast(`Turma "${nome}" excluída.`, "success");
  renderTurmas(instAtualId, instAtualNome);
}

// ─── Iniciar ──────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

  if (!profile) { window.location.href = "/login.html"; return; }

  if (profile.role === "professor") {
    window.location.href = "/minhas-turmas.html";
    return;
  }

  if (profile.role === "admin") {
    if (!profile.instituicao_id) {
      root.innerHTML = `<div class="tv-error">Sua conta não está vinculada a uma instituição. Contate o super administrador.</div>`;
      return;
    }
    const { data: inst } = await supabase
      .from("instituicoes").select("nome").eq("id", profile.instituicao_id).single();
    renderTurmas(profile.instituicao_id, inst?.nome || "Minha Instituição");
    return;
  }

  // super_admin: vê lista de todas as instituições
  renderInstituicoes().catch(err => {
    root.innerHTML = `<div class="tv-error">Erro inesperado: ${err?.message ?? err}</div>`;
  });
}

init();
