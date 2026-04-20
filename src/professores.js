import { supabase } from "./supabase.js";

const root = document.getElementById("page-root");

// ─── SVGs ─────────────────────────────────────────────────────────────────────
const SVG_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const SVG_DOTS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>`;
const SVG_EYE  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const SVG_USER_BIG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

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

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    root.innerHTML = `<div class="prof-empty">${SVG_USER_BIG}<p>Acesso negado. Apenas admins.</p></div>`;
    return;
  }

  await renderPage();
}

// ─── Render ───────────────────────────────────────────────────────────────────
async function renderPage() {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, role")
    .order("nome");

  if (error) {
    root.innerHTML = `<div class="prof-empty"><p>Erro: ${esc(error.message)}</p></div>`;
    return;
  }

  profilesCache = data || [];

  root.innerHTML = `
    <div class="prof-header">
      <div>
        <div class="prof-title">Professores</div>
        <div class="prof-subtitle">${profilesCache.length} usuário${profilesCache.length !== 1 ? "s" : ""}</div>
      </div>
      <button class="btn btn-primary" id="btn-novo">${SVG_PLUS}&nbsp; Novo Usuário</button>
    </div>
    <div class="prof-table-wrap">
      <table class="prof-table">
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Email</th>
            <th>Nível</th>
            <th style="width:56px"></th>
          </tr>
        </thead>
        <tbody id="prof-tbody">
          ${profilesCache.length ? profilesCache.map(buildRow).join("") : `
            <tr><td colspan="4">
              <div class="prof-empty">${SVG_USER_BIG}<p>Nenhum usuário cadastrado.</p></div>
            </td></tr>`}
        </tbody>
      </table>
    </div>`;

  // ── Botão Novo Usuário ───────────────────────────────────────────────────────
  document.getElementById("btn-novo").addEventListener("click", () => modalNovoUsuario());

  // ── Event delegation nos botões ⋮ e itens do menu ───────────────────────────
  const tbody = document.getElementById("prof-tbody");
  if (!tbody) return;

  tbody.addEventListener("click", async (e) => {
    // Botão ⋮
    const dotsBtn = e.target.closest(".action-btn[data-id]");
    if (dotsBtn) {
      e.stopPropagation();
      const menu = document.getElementById("menu-" + dotsBtn.dataset.id);
      if (!menu) return;
      if (currentMenu && currentMenu !== menu) closeAllMenus();
      if (menu.classList.contains("open")) {
        closeAllMenus();
        return;
      }
      // Posiciona o menu com fixed usando coordenadas do botão
      const rect = dotsBtn.getBoundingClientRect();
      menu.style.top  = (rect.bottom + 4) + "px";
      menu.style.left = (rect.right - 200) + "px";
      menu.classList.add("open");
      currentMenu = menu;
      return;
    }

    // Item do menu
    const item = e.target.closest(".action-menu-item[data-action]");
    if (item) {
      const { id, action } = item.dataset;
      closeAllMenus();
      const p = profilesCache.find((x) => x.id === id);
      if (!p) return;
      if (action === "editar")  modalEditar(p);
      if (action === "nivel")   modalNivel(p);
      if (action === "turmas")  await modalTurmas(p);
      if (action === "excluir") modalExcluir(p);
    }
  });
}

// ─── Linha da tabela ──────────────────────────────────────────────────────────
function buildRow(p) {
  const initials = (p.nome || p.email || "?")
    .split(" ").slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const badge = p.role === "admin"
    ? `<span class="badge badge-admin">Admin</span>`
    : `<span class="badge badge-professor">Professor</span>`;
  return `
    <tr>
      <td>
        <div class="prof-name-cell">
          <div class="prof-avatar">${esc(initials)}</div>
          <div class="prof-name-info"><strong>${esc(p.nome || "—")}</strong></div>
        </div>
      </td>
      <td style="color:var(--text-2)">${esc(p.email || "—")}</td>
      <td>${badge}</td>
      <td class="action-cell">
        <button class="action-btn" data-id="${p.id}" title="Ações">${SVG_DOTS}</button>
        <div class="action-menu" id="menu-${p.id}">
          <button class="action-menu-item" data-action="editar" data-id="${p.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar dados
          </button>
          <button class="action-menu-item" data-action="nivel" data-id="${p.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="8" r="4"/><path d="M2 20c0-4 4-7 10-7s10 3 10 7"/></svg>
            Nível de acesso
          </button>
          <button class="action-menu-item" data-action="turmas" data-id="${p.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Atribuir turmas
          </button>
          <div class="action-menu-sep"></div>
          <button class="action-menu-item danger" data-action="excluir" data-id="${p.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Excluir usuário
          </button>
        </div>
      </td>
    </tr>`;
}

// ─── Modal: Novo usuário ──────────────────────────────────────────────────────
function modalNovoUsuario() {
  openModal(`
    <div class="modal-title">Novo Usuário</div>
    <div class="modal-field">
      <label>Nome</label>
      <input id="m-nome" placeholder="Nome completo" autocomplete="off" />
    </div>
    <div class="modal-field">
      <label>Email</label>
      <input id="m-email" type="email" placeholder="email@exemplo.com" autocomplete="off" />
    </div>
    <div class="modal-field">
      <label>Senha</label>
      <div class="modal-field-pw">
        <input id="m-senha" type="password" placeholder="Mínimo 6 caracteres" />
        <button class="pw-toggle" id="m-pw-toggle" type="button">${SVG_EYE}</button>
      </div>
    </div>
    <div class="modal-field">
      <label>Nível de acesso</label>
      <div class="role-options">
        <label class="role-option" id="m-opt-admin">
          <input type="radio" name="m-role" value="admin" />
          <span>Admin</span>
        </label>
        <label class="role-option selected-professor" id="m-opt-prof">
          <input type="radio" name="m-role" value="professor" checked />
          <span>Professor</span>
        </label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
      <button class="btn btn-primary" id="m-save">Criar usuário</button>
    </div>
  `, () => {
    setupRoleOptions("m-");
    document.getElementById("m-cancel").addEventListener("click", closeModal);
    document.getElementById("m-pw-toggle").addEventListener("click", () => togglePw("m-senha", "m-pw-toggle"));
    document.getElementById("m-save").addEventListener("click", async () => {
      const nome  = document.getElementById("m-nome").value.trim();
      const email = document.getElementById("m-email").value.trim();
      const senha = document.getElementById("m-senha").value;
      const role  = document.querySelector('input[name="m-role"]:checked')?.value || "professor";

      if (!nome || !email || !senha) { showToast("Preencha todos os campos", "error"); return; }
      if (senha.length < 6) { showToast("Senha mínima de 6 caracteres", "error"); return; }

      const btn = document.getElementById("m-save");
      btn.disabled = true; btn.textContent = "Criando…";

      // Cria via Admin API (requer service key)
      const { supabaseAdmin } = await import("./supabaseAdmin.js").catch(() => ({ supabaseAdmin: null }));
      if (!supabaseAdmin) {
        showToast("Service key não configurada no .env", "error");
        btn.disabled = false; btn.textContent = "Criar usuário";
        return;
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome, role },
      });

      if (error) {
        showToast("Erro: " + error.message, "error");
        btn.disabled = false; btn.textContent = "Criar usuário";
        return;
      }

      await supabase.from("profiles").upsert({ id: data.user.id, nome, email, role });

      showToast("Usuário criado!", "success");
      closeModal();
      await renderPage();
    });
  });
}

// ─── Modal: Editar dados ──────────────────────────────────────────────────────
function modalEditar(p) {
  openModal(`
    <div class="modal-title">Editar dados</div>
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

      await supabase.from("profiles").update({ nome, email }).eq("id", p.id);
      showToast("Dados atualizados!", "success");
      closeModal();
      await renderPage();
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
  const [{ data: turmas }, { data: atribuidas }] = await Promise.all([
    supabase.from("turmas").select("id, nome, materia").order("nome"),
    supabase.from("turmas").select("id").eq("professor_id", p.id),
  ]);

  const atribSet = new Set((atribuidas || []).map((t) => t.id));
  const items = (turmas || []).map((t) => `
    <label class="turma-check-item">
      <input type="checkbox" value="${t.id}" ${atribSet.has(t.id) ? "checked" : ""} />
      ${esc(t.nome)}${t.materia ? ` <span style="color:var(--text-3)"> · ${esc(t.materia)}</span>` : ""}
    </label>`).join("") || `<p style="padding:12px;color:var(--text-3);font-size:.85rem">Nenhuma turma cadastrada.</p>`;

  openModal(`
    <div class="modal-title">Atribuir turmas</div>
    <p style="font-size:.875rem;color:var(--text-2);margin-bottom:14px">
      Turmas de <strong>${esc(p.nome || p.email)}</strong>:
    </p>
    <div class="modal-field">
      <div class="turmas-check-list">${items}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="t-cancel">Cancelar</button>
      <button class="btn btn-primary" id="t-save">Salvar</button>
    </div>
  `, () => {
    document.getElementById("t-cancel").addEventListener("click", closeModal);
    document.getElementById("t-save").addEventListener("click", async () => {
      const checks = [...document.querySelectorAll(".turmas-check-list input[type=checkbox]")];
      const novas  = new Set(checks.filter((c) => c.checked).map((c) => c.value));

      const btn = document.getElementById("t-save");
      btn.disabled = true; btn.textContent = "Salvando…";

      const remover   = [...atribSet].filter((id) => !novas.has(id));
      const adicionar = [...novas].filter((id) => !atribSet.has(id));

      if (remover.length)   await supabase.from("turmas").update({ professor_id: null }).in("id", remover);
      if (adicionar.length) await supabase.from("turmas").update({ professor_id: p.id }).in("id", adicionar);

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

      const { supabaseAdmin } = await import("./supabaseAdmin.js").catch(() => ({ supabaseAdmin: null }));
      if (!supabaseAdmin) { showToast("Service key não configurada", "error"); btn.disabled = false; btn.textContent = "Excluir"; return; }

      const { error } = await supabaseAdmin.auth.admin.deleteUser(p.id);
      if (error) { showToast("Erro: " + error.message, "error"); btn.disabled = false; btn.textContent = "Excluir"; return; }

      showToast("Usuário excluído.", "success");
      closeModal();
      await renderPage();
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
