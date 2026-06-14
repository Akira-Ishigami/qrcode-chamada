import { supabase }      from "./supabase.js";
import { supabaseAdmin }  from "./supabaseAdmin.js";
import { podeAdmin }      from "./nav-role.js";

const root = document.getElementById("page-root");

// ─── SVGs ─────────────────────────────────────────────────────────────────────
const SVG_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const SVG_DOTS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>`;
const SVG_EYE  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const SVG_USER_BIG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const SVG_CAMERA   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
let modalEl = null;

function openModal(html, onMounted) {
  if (modalEl) modalEl.remove();
  modalEl = document.createElement("div");
  modalEl.className = "prof-modal-bg";
  modalEl.innerHTML = `<div class="prof-modal-box">${html}</div>`;
  document.body.appendChild(modalEl);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeModal();
  });
  document.addEventListener("keydown", escHandler);
  if (onMounted) onMounted();
}

function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  document.removeEventListener("keydown", escHandler);
}

function escHandler(e) { if (e.key === "Escape") closeModal(); }

// ─── Dropdown menu ────────────────────────────────────────────────────────────
let currentMenu = null;

function closeAllMenus() {
  if (currentMenu) { currentMenu.classList.remove("open"); currentMenu = null; }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".action-cell")) closeAllMenus();
});

// ─── Dados em memória ─────────────────────────────────────────────────────────
let profilesCache = [];
let _instId = null;   // instituicao_id do usuário logado

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, instituicao_id")
    .eq("id", session.user.id)
    .single();

  if (!profile)                       { window.location.href = "/login.html"; return; }
  if (profile.role === "admin")       { window.location.href = "/dashboard.html"; return; }
  if (profile.role === "professor")   { window.location.href = "/chamada.html"; return; }

  await renderPage(profile);
}

// ─── Render ───────────────────────────────────────────────────────────────────
async function renderPage(profile) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  // Carrega professores + limite da instituição em paralelo
  const [{ data, error }, { data: instData }] = await Promise.all([
    supabase.from("profiles")
      .select("id, nome, email, role, instituicao_id, foto_url")
      .eq("instituicao_id", profile.instituicao_id)
      .eq("role", "professor")
      .order("nome"),
    supabase.from("instituicoes")
      .select("limite_professores")
      .eq("id", profile.instituicao_id)
      .single(),
  ]);

  const _limite = instData?.limite_professores ?? null;

  if (error) {
    root.innerHTML = `<div class="prof-empty"><p>Erro: ${esc(error.message)}</p></div>`;
    return;
  }

  _instId = profile.instituicao_id;
  profilesCache = data || [];

  const profIds = profilesCache.map(p => p.id);

  // Carrega matérias vinculadas e pares matéria+turma dos horários
  const [{ data: pmData }, { data: horData }] = await Promise.all([
    profIds.length
      ? supabase.from("professor_materias")
          .select("professor_id, materias(nome)")
          .in("professor_id", profIds)
      : { data: [] },
    profIds.length
      ? supabaseAdmin.from("horarios")
          .select("professor_id, materias(nome), turmas(nome)")
          .in("professor_id", profIds)
      : { data: [] },
  ]);

  // Matérias vinculadas (sem turma ainda)
  const materiasPorProf = {};
  (pmData ?? []).forEach(pm => {
    (materiasPorProf[pm.professor_id] ??= new Set()).add(pm.materias?.nome);
  });

  // Pares únicos matéria+turma via horários
  const paresPorProf = {};
  (horData ?? []).forEach(h => {
    const mat   = h.materias?.nome;
    const turma = h.turmas?.nome;
    if (!mat || !turma) return;
    const key = `${mat}||${turma}`;
    (paresPorProf[h.professor_id] ??= new Map()).set(key, { mat, turma });
  });

  // Enriquece os perfis
  profilesCache = profilesCache.map(p => ({
    ...p,
    _materias: [...(materiasPorProf[p.id] ?? [])].filter(Boolean),
    _pares:    [...(paresPorProf[p.id]?.values() ?? [])],
  }));

  const atual   = profilesCache.length;
  const limiteAtingido = _limite !== null && atual >= _limite;
  const limPct  = _limite ? Math.min(Math.round(atual / _limite * 100), 100) : 0;
  const limCor  = _limite ? (limPct >= 90 ? "#ef4444" : limPct >= 70 ? "#f59e0b" : "#16a34a") : "#2563eb";

  root.innerHTML = `
    <div class="prof-header">
      <div>
        <div class="prof-title">Professores</div>
        <div class="prof-subtitle">${atual} professor${atual !== 1 ? "es" : ""}${_limite ? ` <span style="color:${limCor};font-weight:700">· ${atual}/${_limite} acessos usados</span>` : ""}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${_limite ? `
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:120px">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
              <span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)">Acessos</span>
              <span style="font-size:.68rem;font-weight:700;color:${limCor}">${limPct}%</span>
            </div>
            <div style="width:100%;height:5px;background:var(--surface-3);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${limPct}%;background:${limCor};border-radius:99px;transition:width .4s ease"></div>
            </div>
          </div>` : ""}
        <button class="btn btn-primary" id="btn-novo" ${limiteAtingido ? "disabled title='Limite de professores atingido'" : ""}>
          ${SVG_PLUS}&nbsp; Novo Professor
        </button>
      </div>
    </div>
    ${limiteAtingido ? `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fff5f5;border:1px solid #fecaca;border-radius:10px;margin-bottom:16px;font-size:.82rem;color:#b91c1c;font-weight:600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Limite de ${_limite} professor${_limite !== 1 ? "es" : ""} atingido. Aumente o limite no painel do administrador para adicionar mais.
      </div>` : ""}
    ${atual
      ? `<div class="prof-grid" id="prof-grid">${profilesCache.map(buildCard).join("")}</div>`
      : `<div class="prof-empty">${SVG_USER_BIG}<p>Nenhum professor cadastrado ainda.</p></div>`
    }`;

  document.getElementById("btn-novo").addEventListener("click", () => {
    if (limiteAtingido) return;
    modalNovoUsuario();
  });

  // Bind direto em cada card
  document.querySelectorAll(".prof-card[data-prof-id]").forEach(card => {
    const id = card.dataset.profId;
    const p  = profilesCache.find(x => x.id === id);
    if (!p) return;
    card.querySelector(".pc-btn-edit")?.addEventListener("click",     ()  => modalEditar(p));
    card.querySelector(".pc-btn-turmas")?.addEventListener("click",   async () => modalTurmas(p));
    card.querySelector(".pc-btn-materias")?.addEventListener("click", async () => modalMaterias(p));
    card.querySelector(".pc-btn-del")?.addEventListener("click",      ()  => modalExcluir(p));
  });
}

// ─── Card de professor ────────────────────────────────────────────────────────
const CARD_PALETTES = [
  ["#dbeafe","#1d4ed8"], ["#dcfce7","#15803d"], ["#fce7f3","#be185d"],
  ["#fef9c3","#a16207"], ["#ede9fe","#6d28d9"], ["#ffedd5","#c2410c"],
];

function buildCard(p) {
  const initials = (p.nome || p.email || "?")
    .split(" ").slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const [bg, fg] = CARD_PALETTES[((p.nome || p.email || "").charCodeAt(0) || 0) % CARD_PALETTES.length];

  return `
    <div class="prof-card" data-prof-id="${p.id}">
      <div class="prof-card-avatar" style="background:${bg};color:${fg}">${p.foto_url ? `<img src="${p.foto_url}" alt="${esc(initials)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : esc(initials)}</div>
      <div class="prof-card-name">${esc(p.nome || "—")}</div>
      <div class="prof-card-email">${esc(p.email || "—")}</div>
      <div class="prof-card-badge">
        <span class="badge badge-professor">Professor</span>
      </div>
      <div class="prof-card-resumo">
        ${p._pares?.length ? p._pares.map(par => `
          <div class="prof-resumo-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10" style="flex-shrink:0;opacity:.45"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span class="prof-resumo-mat">${esc(par.mat)}</span>
            <span class="prof-resumo-sep">·</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10" style="flex-shrink:0;opacity:.45"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span class="prof-resumo-turma">${esc(par.turma)}</span>
          </div>`).join("") : p._materias?.length ? p._materias.map(m => `
          <div class="prof-resumo-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10" style="flex-shrink:0;opacity:.45"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span class="prof-resumo-mat">${esc(m)}</span>
          </div>`).join("") : `<span class="prof-resumo-vazio">Sem matéria ou turma</span>`}
      </div>
      <div class="prof-card-actions">
        <button class="pc-btn pc-btn-edit" title="Editar dados">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="pc-btn pc-btn-turmas" title="Atribuir turmas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Turmas
        </button>
        <button class="pc-btn pc-btn-materias" title="Matérias do professor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          Matérias
        </button>
        <button class="pc-btn pc-btn-del" title="Excluir professor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
}

// ─── Modal: Novo professor ────────────────────────────────────────────────────
function modalNovoUsuario() {
  let fotoBase64 = null;

  openModal(`
    <div class="modal-title">Novo Professor</div>
    <div class="modal-info-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>O e-mail e a senha abaixo serão o acesso do professor no sistema para fazer chamadas pelo celular.</span>
    </div>
    <div class="foto-upload-area" id="m-foto-area">
      <div class="foto-upload-preview" id="m-foto-preview">${SVG_USER_BIG}</div>
      <div class="foto-upload-info">
        <span class="foto-upload-label">${SVG_CAMERA} Adicionar foto</span>
        <span class="foto-upload-hint">JPG ou PNG, máx 2MB (opcional)</span>
      </div>
      <input type="file" id="m-foto-input" accept="image/*" style="display:none" />
    </div>
    <div class="modal-field">
      <label>Nome completo</label>
      <input id="m-nome" placeholder="Ex: Carlos Eduardo Silva" autocomplete="off" />
      <small class="modal-field-hint">Como o nome vai aparecer nos relatórios</small>
    </div>
    <div class="modal-field">
      <label>E-mail de acesso</label>
      <input id="m-email" type="email" placeholder="Ex: carlos@escola.com.br" autocomplete="off" />
      <small class="modal-field-hint">O professor vai usar este e-mail para fazer login</small>
    </div>
    <div class="modal-field">
      <label>Senha de acesso</label>
      <div class="modal-field-pw">
        <input id="m-senha" type="password" placeholder="Mínimo 6 caracteres" />
        <button class="pw-toggle" id="m-pw-toggle" type="button">${SVG_EYE}</button>
      </div>
      <small class="modal-field-hint">Crie uma senha e passe para o professor — ele pode trocar depois</small>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
      <button class="btn btn-primary" id="m-save">Criar professor</button>
    </div>
  `, () => {
    document.getElementById("m-cancel").addEventListener("click", closeModal);
    document.getElementById("m-pw-toggle").addEventListener("click", () => togglePw("m-senha", "m-pw-toggle"));

    const fotoArea  = document.getElementById("m-foto-area");
    const fotoInput = document.getElementById("m-foto-input");
    const fotoPrev  = document.getElementById("m-foto-preview");
    fotoArea.addEventListener("click", () => fotoInput.click());
    fotoInput.addEventListener("change", () => {
      const file = fotoInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast("Foto muito grande (máx 2MB).", "error"); return; }
      const reader = new FileReader();
      reader.onload = e => {
        fotoBase64 = e.target.result;
        fotoPrev.innerHTML = `<img src="${fotoBase64}" alt="" />`;
        fotoArea.classList.add("has-foto");
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("m-save").addEventListener("click", async () => {
      const nome  = document.getElementById("m-nome").value.trim();
      const email = document.getElementById("m-email").value.trim();
      const senha = document.getElementById("m-senha").value;

      if (!nome || !email || !senha) { showToast("Preencha todos os campos", "error"); return; }
      if (senha.length < 6) { showToast("Senha mínima de 6 caracteres", "error"); return; }

      const btn = document.getElementById("m-save");
      btn.disabled = true; btn.textContent = "Criando…";

      const { supabaseAdmin } = await import("./supabaseAdmin.js").catch(() => ({ supabaseAdmin: null }));
      if (!supabaseAdmin) {
        showToast("Service key não configurada no .env", "error");
        btn.disabled = false; btn.textContent = "Criar professor"; return;
      }

      // Verifica limite de professores
      const { data: instData } = await supabaseAdmin
        .from("instituicoes").select("limite_professores").eq("id", _instId).single();
      const limite = instData?.limite_professores;
      if (limite) {
        const { count } = await supabaseAdmin
          .from("profiles").select("id", { count: "exact", head: true })
          .eq("instituicao_id", _instId).eq("role", "professor");
        if (count >= limite) {
          showToast(`Limite de ${limite} professor${limite !== 1 ? "es" : ""} atingido.`, "error");
          btn.disabled = false; btn.textContent = "Criar professor"; return;
        }
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        user_metadata: { nome, role: "professor" },
      });

      if (error || !data?.user) {
        const msg = error?.message || "Usuário não criado";
        const msgPt = msg.includes("already been registered") || msg.includes("already registered")
          ? "Este email já está cadastrado no sistema."
          : msg.includes("invalid") ? "Email inválido."
          : msg.includes("password") ? "Senha muito fraca. Use ao menos 6 caracteres."
          : "Erro: " + msg;
        showToast(msgPt, "error");
        btn.disabled = false; btn.textContent = "Criar professor"; return;
      }

      // Vincula à instituição
      await supabaseAdmin.from("profiles")
        .update({ nome, email, instituicao_id: _instId, foto_url: fotoBase64 })
        .eq("id", data.user.id);

      showToast("Professor criado!", "success");
      closeModal();
      await renderPage({ role: "instituicao", instituicao_id: _instId });

      // Abre fluxo de matérias e turmas imediatamente
      const novoPerfil = { id: data.user.id, nome, email, role: "professor" };
      setTimeout(() => modalMaterias(novoPerfil, () => modalTurmas(novoPerfil)), 300);
    });
  });
}

// ─── Modal: Editar dados ──────────────────────────────────────────────────────
function modalEditar(p) {
  let fotoBase64 = p.foto_url ?? null;
  const initials = (p.nome || p.email || "?")
    .split(" ").slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  openModal(`
    <div class="modal-title">Editar dados</div>
    <div class="foto-upload-area${p.foto_url ? " has-foto" : ""}" id="e-foto-area">
      <div class="foto-upload-preview" id="e-foto-preview">${p.foto_url ? `<img src="${p.foto_url}" alt="" />` : esc(initials)}</div>
      <div class="foto-upload-info">
        <span class="foto-upload-label">${SVG_CAMERA} ${p.foto_url ? "Trocar foto" : "Adicionar foto"}</span>
        <span class="foto-upload-hint">JPG ou PNG, máx 2MB</span>
      </div>
      <input type="file" id="e-foto-input" accept="image/*" style="display:none" />
    </div>
    <div class="modal-field">
      <label>Nome</label>
      <input id="e-nome" value="${esc(p.nome || "")}" placeholder="Nome completo" />
    </div>
    <div class="modal-field">
      <label>Email</label>
      <input id="e-email" type="email" value="${esc(p.email || "")}" />
    </div>
    <div class="modal-field">
      <label>Nova senha <span style="font-weight:400;color:var(--text-3)">(deixe em branco para manter)</span></label>
      <div class="modal-field-pw">
        <input id="e-senha" type="password" placeholder="Nova senha (opcional)" />
        <button class="pw-toggle" id="e-pw-toggle" type="button">${SVG_EYE}</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="e-cancel">Cancelar</button>
      <button class="btn btn-primary" id="e-save">Salvar</button>
    </div>
  `, () => {
    document.getElementById("e-cancel").addEventListener("click", closeModal);
    document.getElementById("e-pw-toggle").addEventListener("click", () => togglePw("e-senha", "e-pw-toggle"));

    const fotoArea  = document.getElementById("e-foto-area");
    const fotoInput = document.getElementById("e-foto-input");
    const fotoPrev  = document.getElementById("e-foto-preview");
    const fotoLabel = fotoArea.querySelector(".foto-upload-label");
    fotoArea.addEventListener("click", () => fotoInput.click());
    fotoInput.addEventListener("change", () => {
      const file = fotoInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast("Foto muito grande (máx 2MB).", "error"); return; }
      const reader = new FileReader();
      reader.onload = e => {
        fotoBase64 = e.target.result;
        fotoPrev.innerHTML = `<img src="${fotoBase64}" alt="" />`;
        fotoArea.classList.add("has-foto");
        fotoLabel.innerHTML = `${SVG_CAMERA} Trocar foto`;
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("e-save").addEventListener("click", async () => {
      const nome  = document.getElementById("e-nome").value.trim();
      const email = document.getElementById("e-email").value.trim();
      const senha = document.getElementById("e-senha").value;

      if (!nome || !email) { showToast("Nome e email obrigatórios", "error"); return; }

      const btn = document.getElementById("e-save");
      btn.disabled = true; btn.textContent = "Salvando…";

      const { supabaseAdmin } = await import("./supabaseAdmin.js").catch(() => ({ supabaseAdmin: null }));
      if (!supabaseAdmin) { showToast("Service key não configurada", "error"); btn.disabled = false; btn.textContent = "Salvar"; return; }

      const updates = { email, user_metadata: { nome } };
      if (senha) updates.password = senha;
      const { error: ae } = await supabaseAdmin.auth.admin.updateUserById(p.id, updates);
      if (ae) { showToast("Erro: " + ae.message, "error"); btn.disabled = false; btn.textContent = "Salvar"; return; }

      await supabase.from("profiles").update({ nome, email, foto_url: fotoBase64 }).eq("id", p.id);
      showToast("Dados atualizados!", "success");
      closeModal();
      await renderPage({ role: "instituicao", instituicao_id: _instId });
    });
  });
}

// ─── Modal: Nível de acesso ───────────────────────────────────────────────────
function modalNivel(p) {
  openModal(`
    <div class="modal-title">Nível de acesso</div>
    <p style="font-size:.875rem;color:var(--text-2);margin-bottom:18px">
      Defina o nível de <strong>${esc(p.nome || p.email)}</strong>:
    </p>
    <div class="modal-field">
      <div class="role-options">
        <label class="role-option ${p.role === "admin" ? "selected-admin" : ""}" id="n-opt-admin">
          <input type="radio" name="n-role" value="admin" ${p.role === "admin" ? "checked" : ""} />
          <span>Admin</span>
        </label>
        <label class="role-option ${p.role === "professor" ? "selected-professor" : ""}" id="n-opt-prof">
          <input type="radio" name="n-role" value="professor" ${p.role === "professor" ? "checked" : ""} />
          <span>Professor</span>
        </label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="n-cancel">Cancelar</button>
      <button class="btn btn-primary" id="n-save">Salvar</button>
    </div>
  `, () => {
    setupRoleOptions("n-");
    document.getElementById("n-cancel").addEventListener("click", closeModal);
    document.getElementById("n-save").addEventListener("click", async () => {
      const role = document.querySelector('input[name="n-role"]:checked')?.value;
      if (!role) return;

      const btn = document.getElementById("n-save");
      btn.disabled = true; btn.textContent = "Salvando…";

      const { supabaseAdmin } = await import("./supabaseAdmin.js").catch(() => ({ supabaseAdmin: null }));
      if (!supabaseAdmin) { showToast("Service key não configurada", "error"); btn.disabled = false; btn.textContent = "Salvar"; return; }

      await supabaseAdmin.auth.admin.updateUserById(p.id, { user_metadata: { role } });
      const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
      if (error) { showToast("Erro: " + error.message, "error"); btn.disabled = false; btn.textContent = "Salvar"; return; }

      showToast("Nível atualizado!", "success");
      closeModal();
      await renderPage();
    });
  });
}

// ─── Modal: Atribuir turmas ───────────────────────────────────────────────────
async function modalTurmas(p) {
  const profNome = p.nome || p.email;

  const { data: turmas } = await supabase
    .from("turmas")
    .select("id, nome, professor")
    .eq("instituicao_id", _instId)
    .order("nome");

  const lista    = turmas || [];
  const atribSet = new Set(lista.filter(t => t.professor === profNome).map(t => t.id));

  const SVG_HOUSE  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const SVG_CHECK  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>`;

  const items = lista.length === 0
    ? `<p style="padding:16px;color:var(--text-3);font-size:.84rem;text-align:center">Nenhuma turma cadastrada nesta instituição.</p>`
    : lista.map(t => {
        const sel      = atribSet.has(t.id);
        const outroProf = t.professor && t.professor !== profNome;
        return `
          <div class="tc-item${sel ? " selected" : ""}" data-id="${t.id}">
            <input type="checkbox" value="${t.id}"${sel ? " checked" : ""} />
            <div class="tc-item-icon">${SVG_HOUSE}</div>
            <div class="tc-item-body">
              <div class="tc-item-name">${esc(t.nome)}</div>
              ${outroProf ? `<div class="tc-item-sub">Atribuída a ${esc(t.professor)}</div>` : ""}
            </div>
            <div class="tc-item-check">${SVG_CHECK}</div>
          </div>`;
      }).join("");

  openModal(`
    <div class="tc-modal-head">
      <div class="tc-modal-icon">${SVG_HOUSE}</div>
      <div>
        <div class="modal-title" style="margin-bottom:1px">Turmas do professor</div>
        <p style="font-size:.76rem;color:var(--text-3);margin:0">${esc(profNome)}</p>
      </div>
    </div>
    <div class="tc-item-grid" id="tc-grid">${items}</div>
    <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <button class="btn btn-ghost" id="t-edit-dados" style="color:var(--acc);border-color:var(--border-acc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Editar dados
      </button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="t-cancel">Cancelar</button>
        <button class="btn btn-primary" id="t-save">Salvar</button>
      </div>
    </div>
  `, () => {
    // Toggle card selection
    document.querySelectorAll(".tc-item").forEach(item => {
      item.addEventListener("click", () => {
        item.classList.toggle("selected");
        const cb = item.querySelector("input[type='checkbox']");
        if (cb) cb.checked = !cb.checked;
      });
    });

    document.getElementById("t-edit-dados").addEventListener("click", () => {
      closeModal();
      modalEditar(p);
    });

    document.getElementById("t-cancel").addEventListener("click", closeModal);

    document.getElementById("t-save").addEventListener("click", async () => {
      const checks    = [...document.querySelectorAll("#tc-grid input[type=checkbox]")];
      const novas     = new Set(checks.filter(c => c.checked).map(c => c.value));
      const remover   = [...atribSet].filter(id => !novas.has(id));
      const adicionar = [...novas].filter(id => !atribSet.has(id));

      const btn = document.getElementById("t-save");
      btn.disabled = true; btn.textContent = "Salvando…";

      if (remover.length)
        await supabase.from("turmas").update({ professor: null }).in("id", remover);
      if (adicionar.length)
        await supabase.from("turmas").update({ professor: profNome }).in("id", adicionar);

      showToast("Turmas atualizadas!", "success");
      closeModal();
    });
  });
}

// ─── Modal: Excluir ───────────────────────────────────────────────────────────
function modalExcluir(p) {
  openModal(`
    <div class="modal-title" style="color:var(--red)">Excluir usuário</div>
    <p style="font-size:.9rem;color:var(--text-2);margin-bottom:20px">
      Excluir <strong>${esc(p.nome || p.email)}</strong>? Esta ação não pode ser desfeita.
    </p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="x-cancel">Cancelar</button>
      <button class="btn btn-danger" id="x-confirm">Excluir</button>
    </div>
  `, () => {
    document.getElementById("x-cancel").addEventListener("click", closeModal);
    document.getElementById("x-confirm").addEventListener("click", async () => {
      const btn = document.getElementById("x-confirm");
      btn.disabled = true; btn.textContent = "Excluindo…";

      // Cascade manual: remove vínculos antes de deletar o usuário
      await Promise.all([
        supabaseAdmin.from("professor_materias").delete().eq("professor_id", p.id),
        supabaseAdmin.from("horarios").update({ professor_id: null }).eq("professor_id", p.id),
        supabaseAdmin.from("chamadas").update({ professor_id: null }).eq("professor_id", p.id),
      ]);

      const { error } = await supabaseAdmin.auth.admin.deleteUser(p.id);
      if (error) { showToast("Erro: " + error.message, "error"); btn.disabled = false; btn.textContent = "Excluir"; return; }

      showToast("Professor excluído.", "success");
      closeModal();
      await renderPage({ role: "instituicao", instituicao_id: _instId });
    });
  });
}

// ─── Modal: Matérias do professor ─────────────────────────────────────────────
async function modalMaterias(p, onSave = null) {
  const profNome = p.nome || p.email;

  const [{ data: materias }, { data: vinculos }] = await Promise.all([
    supabase.from("materias").select("id, nome").eq("instituicao_id", _instId).order("nome"),
    supabase.from("professor_materias").select("materia_id").eq("professor_id", p.id),
  ]);

  const lista     = materias || [];
  const vinculSet = new Set((vinculos || []).map(v => v.materia_id));

  const SVG_BOOK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
  const SVG_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>`;

  const items = lista.length === 0
    ? `<p style="padding:16px;color:var(--text-3);font-size:.84rem;text-align:center">
        Nenhuma matéria cadastrada. <a href="materias.html" style="color:var(--acc)">Cadastrar →</a>
       </p>`
    : lista.map(m => {
        const sel = vinculSet.has(m.id);
        return `
          <div class="tc-item${sel ? " selected" : ""}" data-id="${m.id}">
            <input type="checkbox" value="${m.id}"${sel ? " checked" : ""} />
            <div class="tc-item-icon">${SVG_BOOK}</div>
            <div class="tc-item-body">
              <div class="tc-item-name">${esc(m.nome)}</div>
            </div>
            <div class="tc-item-check">${SVG_CHECK}</div>
          </div>`;
      }).join("");

  openModal(`
    <div class="tc-modal-head">
      <div class="tc-modal-icon">${SVG_BOOK}</div>
      <div>
        <div class="modal-title" style="margin-bottom:1px">Matérias do professor</div>
        <p style="font-size:.76rem;color:var(--text-3);margin:0">${esc(profNome)}</p>
      </div>
    </div>
    <div class="tc-item-grid" id="mat-grid">${items}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mat-cancel">Cancelar</button>
      <button class="btn btn-primary" id="mat-save">${onSave ? "Salvar e continuar →" : "Salvar"}</button>
    </div>
  `, () => {
    document.querySelectorAll(".tc-item").forEach(item => {
      item.addEventListener("click", () => {
        item.classList.toggle("selected");
        const cb = item.querySelector("input[type='checkbox']");
        if (cb) cb.checked = !cb.checked;
      });
    });

    document.getElementById("mat-cancel").addEventListener("click", closeModal);

    document.getElementById("mat-save").addEventListener("click", async () => {
      const btn = document.getElementById("mat-save");
      btn.disabled = true; btn.textContent = "Salvando…";

      const selecionados = [...document.querySelectorAll("#mat-grid input:checked")].map(cb => cb.value);

      // Remove vínculos antigos e recria
      await supabase.from("professor_materias").delete().eq("professor_id", p.id);

      if (selecionados.length > 0) {
        const inserts = selecionados.map(matId => ({
          professor_id: p.id,
          materia_id:   matId,
        }));
        const { error } = await supabase.from("professor_materias").insert(inserts);
        if (error) {
          showToast("Erro: " + error.message, "error");
          btn.disabled = false; btn.textContent = onSave ? "Salvar e continuar →" : "Salvar";
          return;
        }
      }

      showToast("Matérias salvas!", "success");
      closeModal();
      if (onSave) setTimeout(() => onSave(), 200);
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function togglePw(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp) return;
  inp.type = inp.type === "text" ? "password" : "text";
  btn.innerHTML = inp.type === "text" ? SVG_EYE_OFF : SVG_EYE;
}

function setupRoleOptions(prefix) {
  const adminOpt = document.getElementById(`${prefix}opt-admin`);
  const profOpt  = document.getElementById(`${prefix}opt-prof`);
  const radios   = document.querySelectorAll(`input[name="${prefix}role"]`);

  function update() {
    const val = document.querySelector(`input[name="${prefix}role"]:checked`)?.value;
    if (adminOpt) adminOpt.className = `role-option${val === "admin"     ? " selected-admin"     : ""}`;
    if (profOpt)  profOpt.className  = `role-option${val === "professor" ? " selected-professor" : ""}`;
  }

  radios.forEach((r) => r.addEventListener("change", update));
  update();
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
