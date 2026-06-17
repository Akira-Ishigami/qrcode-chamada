import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

const root = document.getElementById("page-root");
const esc  = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3000);
}

let _instId = null;
let _professores = [];

const MAT_PALETTE = [
  { solid:"#3b82f6", tint:"#eff6ff", text:"#1e40af" },
  { solid:"#22c55e", tint:"#f0fdf4", text:"#15803d" },
  { solid:"#ec4899", tint:"#fdf2f8", text:"#9d174d" },
  { solid:"#f97316", tint:"#fff7ed", text:"#c2410c" },
  { solid:"#8b5cf6", tint:"#f5f3ff", text:"#5b21b6" },
  { solid:"#14b8a6", tint:"#f0fdfa", text:"#115e59" },
  { solid:"#eab308", tint:"#fefce8", text:"#a16207" },
  { solid:"#ef4444", tint:"#fef2f2", text:"#991b1b" },
];

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }
  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

  if (!profile || profile.role !== "instituicao") {
    window.location.href = "/inst-dashboard.html"; return;
  }

  _instId = profile.instituicao_id;

  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, nome, email")
    .eq("instituicao_id", _instId)
    .eq("role", "professor")
    .order("nome");

  _professores = profs ?? [];

  await renderPage();
}

// ── Render principal ──────────────────────────────────────────────────────────
async function renderPage() {
  root.innerHTML = `
    <div class="mat-topbar">
      <div>
        <div class="mat-eyebrow">Configuração</div>
        <div class="mat-title">Matérias</div>
      </div>
      <button class="mat-btn-nova" id="btn-nova-mat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span class="mbn-lbl">Nova matéria</span>
      </button>
    </div>
    <div id="mat-list" class="mat-list"></div>
  `;

  document.getElementById("btn-nova-mat").addEventListener("click", abrirModalNova);
  await renderMaterias();
}

// ── Modal nova matéria ────────────────────────────────────────────────────────
function abrirModalNova() {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov";
  ov.innerHTML = `
    <div class="mat-modal">
      <div class="mat-modal-head">
        <div class="mat-modal-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <div>
          <div class="mat-modal-title">Nova matéria</div>
          <div class="mat-modal-sub">Digite o nome da disciplina</div>
        </div>
        <button class="mat-modal-x" id="modal-x">✕</button>
      </div>
      <div class="mat-modal-body">
        <label class="mat-label">Nome</label>
        <input id="modal-input" class="mat-input" type="text" placeholder="Ex: Matemática, Português, Ciências…" maxlength="80" autofocus />
        <div id="modal-err" class="mat-modal-err"></div>

        <div class="matd-section-title" style="margin-top:10px">Frequência do semestre</div>
        <div class="mat-faltas-box">
          <div class="mat-faltas-title-row">
            <div class="mat-faltas-hint">Defina o total de aulas e o limite de faltas em %. O sistema calcula quantas faltas isso representa. Pode deixar vazio e configurar depois.</div>
          </div>
          <div class="mat-faltas-fields">
            <div class="mat-faltas-field">
              <label>Aulas no semestre</label>
              <input id="new-aulas" class="mat-input" type="number" min="0" max="999" placeholder="—" style="text-align:center" />
            </div>
            <div class="mat-faltas-field">
              <label>Faltas permitidas (%)</label>
              <input id="new-faltas" class="mat-input" type="number" min="0" max="100" placeholder="%" style="text-align:center" />
            </div>
          </div>
          <div id="new-faltas-resumo" class="mat-faltas-resumo"></div>
        </div>
      </div>
      <div class="mat-modal-foot">
        <button class="mat-btn-ghost" id="modal-cancel">Cancelar</button>
        <button class="mat-btn-criar" id="modal-criar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar matéria
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => {
    ov.classList.remove("open");
    setTimeout(() => ov.remove(), 200);
  };

  ov.querySelector("#modal-x").addEventListener("click", fechar);
  ov.querySelector("#modal-cancel").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  const input = ov.querySelector("#modal-input");
  const err   = ov.querySelector("#modal-err");
  const btn   = ov.querySelector("#modal-criar");
  const elAulas  = ov.querySelector("#new-aulas");
  const elFaltas = ov.querySelector("#new-faltas");
  const resumo   = ov.querySelector("#new-faltas-resumo");

  const parseOpt   = (raw) => {
    raw = (raw || "").trim();
    if (raw === "") return { ok: true, val: null };
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return { ok: false };
    return { ok: true, val: n };
  };
  const calcLimite = (aulas, pct) => (aulas != null && pct != null) ? Math.floor(aulas * pct / 100) : null;

  const atualizarResumo = () => {
    const a = parseOpt(elAulas.value);
    const f = parseOpt(elFaltas.value);
    if (a.ok && f.ok && a.val != null && f.val != null && a.val > 0 && f.val <= 100) {
      const limite  = calcLimite(a.val, f.val);
      const presPct = Math.round((a.val - limite) / a.val * 100);
      resumo.textContent = `Máx. ${limite} falta${limite !== 1 ? "s" : ""} (${f.val}%) · presença mínima ${presPct}% de ${a.val} aulas.`;
      resumo.style.display = "";
    } else {
      resumo.style.display = "none";
    }
  };
  elAulas.addEventListener("input", atualizarResumo);
  elFaltas.addEventListener("input", atualizarResumo);
  atualizarResumo();

  const criar = async () => {
    const nome = input.value.trim();
    err.textContent = "";
    if (!nome) { err.textContent = "Digite o nome da matéria."; return; }

    const a = parseOpt(elAulas.value);
    const f = parseOpt(elFaltas.value);
    if (!a.ok || !f.ok)                       { err.textContent = "Informe números válidos na frequência."; return; }
    if (f.val != null && f.val > 100)         { err.textContent = "A porcentagem de faltas não pode passar de 100%."; return; }
    if (f.val != null && a.val == null)       { err.textContent = "Informe o total de aulas para calcular as faltas."; return; }
    const limite = calcLimite(a.val, f.val);

    btn.disabled = true; btn.textContent = "Criando…";

    const { error } = await supabaseAdmin
      .from("materias").insert({ nome, instituicao_id: _instId, aulas_semestre: a.val, limite_faltas: limite });

    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Criar matéria`;

    if (error) {
      err.textContent = error.code === "23505" ? "Já existe uma matéria com esse nome." : "Erro: " + error.message;
      return;
    }

    fechar();
    showToast(`"${nome}" criada!`, "success");
    await renderMaterias();
  };

  btn.addEventListener("click", criar);
  input.addEventListener("keydown", e => { if (e.key === "Enter") criar(); });
  setTimeout(() => input.focus(), 80);
}

// ── Lista de matérias ─────────────────────────────────────────────────────────
async function renderMaterias() {
  const lista = document.getElementById("mat-list");
  if (!lista) return;

  const { data: materias } = await supabaseAdmin
    .from("materias").select("id, nome, aulas_semestre, limite_faltas").eq("instituicao_id", _instId).order("nome");

  if (!materias?.length) {
    lista.innerHTML = `
      <div class="mat-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <p>Nenhuma matéria cadastrada ainda.<br>Clique em <strong>Nova matéria</strong> para começar.</p>
      </div>`;
    return;
  }

  const matIds = materias.map(m => m.id);
  const { data: vinculos } = await supabaseAdmin
    .from("professor_materias")
    .select("materia_id, professor_id, profiles(id, nome, email, foto_url)")
    .in("materia_id", matIds);

  const vinculosPorMateria = {};
  (vinculos ?? []).forEach(v => { (vinculosPorMateria[v.materia_id] ??= []).push(v); });

  lista.innerHTML = "";

  materias.forEach((mat, idx) => {
    const profs = vinculosPorMateria[mat.id] ?? [];
    const c = MAT_PALETTE[idx % MAT_PALETTE.length];

    const card = document.createElement("div");
    card.className = "matx-card";
    card.style.cssText = `--c:${c.solid};--ct:${c.tint};--ctx:${c.text};animation-delay:${idx * .05}s`;
    card.dataset.id = mat.id;

    const avatars = profs.length
      ? `<div class="matx-avs">
           ${profs.slice(0,6).map(v => {
             const p = v.profiles;
             const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
             return p?.foto_url
               ? `<span class="matx-av has-img" title="${esc(p?.nome || "")}"><img src="${esc(p.foto_url)}" alt="${esc(p?.nome || "")}" loading="lazy"></span>`
               : `<span class="matx-av" title="${esc(p?.nome || p?.email || "")}">${esc(ini)}</span>`;
           }).join("")}
           ${profs.length > 6 ? `<span class="matx-av more">+${profs.length - 6}</span>` : ""}
         </div>`
      : `<span class="matx-noprof">Sem professores vinculados</span>`;

    const presMin = (mat.limite_faltas != null && mat.aulas_semestre)
      ? Math.round((mat.aulas_semestre - mat.limite_faltas) / mat.aulas_semestre * 100) : null;

    const freq = mat.aulas_semestre != null
      ? `<div class="matx-freq">
           <div class="matx-freq-top">
             <span class="matx-freq-lbl">Presença mínima</span>
             <span class="matx-freq-val">${presMin != null ? `${presMin}%` : "—"}</span>
           </div>
           <div class="matx-freq-bar"><i style="width:${presMin ?? 0}%"></i></div>
           <div class="matx-freq-sub">${mat.limite_faltas != null ? `${mat.limite_faltas} falta${mat.limite_faltas !== 1 ? "s" : ""} permitida${mat.limite_faltas !== 1 ? "s" : ""}` : "sem limite"} · ${mat.aulas_semestre} aulas</div>
         </div>`
      : `<span class="matx-flag" title="Sem frequência configurada">!</span>`;

    card.innerHTML = `
      <button class="matx-del" title="Excluir matéria">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
      <div class="matx-head">
        <div class="matx-ico">${esc(mat.nome[0].toUpperCase())}</div>
        <div class="matx-name">${esc(mat.nome)}</div>
      </div>
      <div class="matx-profs">${avatars}</div>
      ${freq}
    `;

    card.addEventListener("click", e => {
      if (e.target.closest(".matx-del")) return;
      abrirModalMateria(mat, profs, c);
    });
    card.querySelector(".matx-del").addEventListener("click", () => confirmarExcluir(mat.id, mat.nome));

    lista.appendChild(card);
  });
}

// ── Drawer da matéria: frequência + professores (foto+nome) + editar nome ─────
function abrirModalMateria(mat, profs, c = MAT_PALETTE[0]) {
  const ov = document.createElement("div");
  ov.className = "matd-bg";
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => { ov.classList.remove("open"); setTimeout(() => ov.remove(), 320); };

  const profRows = profs.length === 0
    ? `<div class="matd-prof-vazio">Nenhum professor vinculado.<br>Gerencie em <strong>Professores</strong>.</div>`
    : profs.map(v => {
        const p   = v.profiles;
        const ini = (p?.nome || "?").split(" ").slice(0,2).map(n => n[0]).join("");
        const av  = p?.foto_url
          ? `<img src="${esc(p.foto_url)}" alt="${esc(p?.nome || "")}" loading="lazy">`
          : `<span>${esc(ini)}</span>`;
        return `
          <div class="matd-prof">
            <div class="matd-prof-av">${av}</div>
            <div class="matd-prof-info">
              <div class="matd-prof-nome">${esc(p?.nome || "Professor")}</div>
              ${p?.email ? `<div class="matd-prof-email">${esc(p.email)}</div>` : ""}
            </div>
          </div>`;
      }).join("");

  ov.innerHTML = `
    <div class="matd" style="--c:${c.solid};--ct:${c.tint};--ctx:${c.text}">
      <div class="matd-hero">
        <div class="matd-hero-bar"></div>
        <div class="matd-hero-row">
          <div class="matd-ico">${esc(mat.nome[0].toUpperCase())}</div>
          <div class="matd-hero-info">
            <div class="matd-eyebrow">Matéria</div>
            <div class="matd-name" id="mgr-nome-display">${esc(mat.nome)}</div>
            <div class="matd-sub">${profs.length} professor${profs.length !== 1 ? "es" : ""} vinculado${profs.length !== 1 ? "s" : ""}</div>
          </div>
          <button class="matd-x" id="mgr-x">✕</button>
        </div>
        <button class="matd-editbtn" id="mgr-editar-nome">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar nome
        </button>
        <div id="mgr-edit-area" style="display:none;padding:12px 20px 0">
          <label class="mat-label">Novo nome</label>
          <div style="display:flex;gap:8px;margin-top:5px">
            <input id="mgr-input-nome" class="mat-input" type="text" value="${esc(mat.nome)}" maxlength="80" />
            <button class="mat-btn-criar" id="mgr-salvar-nome" style="white-space:nowrap">Salvar</button>
          </div>
          <div id="mgr-nome-err" class="mat-modal-err"></div>
        </div>
      </div>

      <div class="matd-body">
        <div class="matd-section-title">Frequência do semestre</div>
        <div class="mat-faltas-box">
          <div class="mat-faltas-title-row">
            <div class="mat-faltas-hint">Defina o total de aulas e o limite de faltas em %. O sistema calcula quantas faltas isso representa. Vazio = não definido.</div>
          </div>
          <div class="mat-faltas-fields">
            <div class="mat-faltas-field">
              <label>Aulas no semestre</label>
              <input id="mgr-aulas" class="mat-input" type="number" min="0" max="999"
                value="${mat.aulas_semestre ?? ""}" placeholder="—" style="text-align:center" />
            </div>
            <div class="mat-faltas-field">
              <label>Faltas permitidas (%)</label>
              <input id="mgr-faltas" class="mat-input" type="number" min="0" max="100"
                value="${(mat.limite_faltas != null && mat.aulas_semestre) ? Math.round(mat.limite_faltas / mat.aulas_semestre * 100) : ""}" placeholder="%" style="text-align:center" />
            </div>
          </div>
          <div id="mgr-faltas-resumo" class="mat-faltas-resumo"></div>
        </div>
        <div id="mgr-faltas-err" class="mat-modal-err"></div>

        <div class="matd-section-title" style="margin-top:18px">Professores vinculados</div>
        <div class="matd-prof-hint">Marque os professores que dão esta matéria.</div>
        <div class="matd-profs" id="mgr-profs"><div class="matd-prof-vazio">Carregando professores…</div></div>
      </div>

      <div class="matd-foot">
        <button class="matd-btn-del" id="mgr-excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          Excluir
        </button>
        <div class="matd-foot-right">
          <button class="matd-btn-ghost" id="mgr-fechar">Cancelar</button>
          <button class="matd-btn-save" id="mgr-salvar">Salvar</button>
        </div>
      </div>
    </div>`;

  ov.querySelector("#mgr-x").addEventListener("click", fechar);
  ov.querySelector("#mgr-fechar").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  // Toggle editar nome
  ov.querySelector("#mgr-editar-nome").addEventListener("click", () => {
    const area = ov.querySelector("#mgr-edit-area");
    const visible = area.style.display !== "none";
    area.style.display = visible ? "none" : "";
    if (!visible) setTimeout(() => ov.querySelector("#mgr-input-nome")?.focus(), 60);
  });

  // Parse de campo numérico opcional (vazio = null)
  const parseOpt = (raw) => {
    raw = raw.trim();
    if (raw === "") return { ok: true, val: null };
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return { ok: false };
    return { ok: true, val: n };
  };

  // Converte aulas + % de faltas em nº absoluto de faltas
  const calcLimite = (aulas, pct) => (aulas != null && pct != null) ? Math.floor(aulas * pct / 100) : null;

  // Mostra resumo (faltas calculadas + presença mínima) conforme os campos
  const atualizarResumo = () => {
    const resumo = ov.querySelector("#mgr-faltas-resumo");
    const a = parseOpt(ov.querySelector("#mgr-aulas").value);
    const f = parseOpt(ov.querySelector("#mgr-faltas").value);
    if (a.ok && f.ok && a.val != null && f.val != null && a.val > 0 && f.val <= 100) {
      const limite  = calcLimite(a.val, f.val);
      const presPct = Math.round((a.val - limite) / a.val * 100);
      resumo.textContent = `Máx. ${limite} falta${limite !== 1 ? "s" : ""} (${f.val}%) · presença mínima ${presPct}% de ${a.val} aulas.`;
      resumo.style.display = "";
    } else {
      resumo.style.display = "none";
    }
  };

  // Salvar aulas + % de faltas (gravado como limite absoluto)
  const salvarFaltas = async () => {
    const err = ov.querySelector("#mgr-faltas-err");
    err.textContent = "";
    const a = parseOpt(ov.querySelector("#mgr-aulas").value);
    const f = parseOpt(ov.querySelector("#mgr-faltas").value);
    if (!a.ok || !f.ok) { err.textContent = "Informe números válidos."; return; }
    if (f.val != null && f.val > 100) { err.textContent = "A porcentagem de faltas não pode passar de 100%."; return; }
    if (f.val != null && a.val == null) { err.textContent = "Informe o total de aulas para calcular as faltas."; return; }

    const limite = calcLimite(a.val, f.val);

    const btn = ov.querySelector("#mgr-salvar");
    btn.disabled = true; btn.textContent = "Salvando…";

    const { error } = await supabaseAdmin
      .from("materias").update({ aulas_semestre: a.val, limite_faltas: limite }).eq("id", mat.id);

    if (error) { btn.disabled = false; btn.textContent = "Salvar"; err.textContent = "Erro: " + error.message; return; }

    // Salvar vínculos de professores (toggles marcados)
    const cont = ov.querySelector("#mgr-profs");
    if (cont && cont.dataset.ready === "1") {
      const desired  = new Set([...cont.querySelectorAll(".matd-prof.on")].map(r => r.dataset.pid));
      const toAdd    = [...desired].filter(id => !vinculadoSet.has(id));
      const toRemove = [...vinculadoSet].filter(id => !desired.has(id));
      if (toAdd.length) {
        const { error: eA } = await supabaseAdmin.from("professor_materias")
          .insert(toAdd.map(pid => ({ professor_id: pid, materia_id: mat.id })));
        if (eA) { btn.disabled = false; btn.textContent = "Salvar"; err.textContent = "Erro ao vincular: " + eA.message; return; }
      }
      if (toRemove.length) {
        const { error: eR } = await supabaseAdmin.from("professor_materias")
          .delete().eq("materia_id", mat.id).in("professor_id", toRemove);
        if (eR) { btn.disabled = false; btn.textContent = "Salvar"; err.textContent = "Erro ao desvincular: " + eR.message; return; }
      }
    }

    btn.disabled = false; btn.textContent = "Salvar";
    mat.aulas_semestre = a.val;
    mat.limite_faltas  = limite;
    showToast("Matéria atualizada!", "success");
    await renderMaterias();
    fechar();
  };

  ov.querySelector("#mgr-salvar").addEventListener("click", salvarFaltas);
  ov.querySelector("#mgr-excluir").addEventListener("click", () => { fechar(); confirmarExcluir(mat.id, mat.nome); });
  ov.querySelector("#mgr-aulas").addEventListener("input", atualizarResumo);
  ov.querySelector("#mgr-faltas").addEventListener("input", atualizarResumo);
  ov.querySelector("#mgr-aulas").addEventListener("keydown", e => { if (e.key === "Enter") salvarFaltas(); });
  ov.querySelector("#mgr-faltas").addEventListener("keydown", e => { if (e.key === "Enter") salvarFaltas(); });
  atualizarResumo();

  // Salvar nome
  const salvarNome = async () => {
    const novoNome = ov.querySelector("#mgr-input-nome").value.trim();
    const err = ov.querySelector("#mgr-nome-err");
    err.textContent = "";
    if (!novoNome) { err.textContent = "Digite o nome."; return; }
    if (novoNome === mat.nome) { ov.querySelector("#mgr-edit-area").style.display = "none"; return; }

    const btn = ov.querySelector("#mgr-salvar-nome");
    btn.disabled = true; btn.textContent = "Salvando…";

    const { error } = await supabaseAdmin.from("materias").update({ nome: novoNome }).eq("id", mat.id);

    btn.disabled = false; btn.textContent = "Salvar";
    if (error) { err.textContent = "Erro: " + error.message; return; }

    ov.querySelector("#mgr-nome-display").textContent = novoNome;
    ov.querySelector("#mgr-edit-area").style.display = "none";
    mat.nome = novoNome;
    showToast("Nome atualizado!", "success");
    await renderMaterias();
  };

  ov.querySelector("#mgr-salvar-nome").addEventListener("click", salvarNome);
  ov.querySelector("#mgr-input-nome").addEventListener("keydown", e => { if (e.key === "Enter") salvarNome(); });

  // ── Vincular professores (toggle) ──
  const vinculadoSet = new Set(profs.map(v => v.profiles?.id).filter(Boolean));
  (async () => {
    const { data: allProfs } = await supabaseAdmin
      .from("profiles").select("id, nome, email, foto_url")
      .eq("instituicao_id", _instId).eq("role", "professor").order("nome");
    const cont = ov.querySelector("#mgr-profs");
    if (!cont) return;
    if (!allProfs?.length) {
      cont.innerHTML = `<div class="matd-prof-vazio">Nenhum professor cadastrado.<br>Crie em <strong>Professores</strong>.</div>`;
      return;
    }
    cont.innerHTML = allProfs.map(p => {
      const ini = (p.nome || "?").split(" ").slice(0, 2).map(n => n[0]).join("");
      const av  = p.foto_url
        ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nome || "")}" loading="lazy">`
        : `<span>${esc(ini)}</span>`;
      const on = vinculadoSet.has(p.id);
      return `
        <div class="matd-prof toggle${on ? " on" : ""}" data-pid="${p.id}">
          <div class="matd-prof-av">${av}</div>
          <div class="matd-prof-info">
            <div class="matd-prof-nome">${esc(p.nome || "Professor")}</div>
            ${p.email ? `<div class="matd-prof-email">${esc(p.email)}</div>` : ""}
          </div>
          <div class="matd-prof-check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>`;
    }).join("");
    cont.querySelectorAll(".matd-prof.toggle").forEach(r =>
      r.addEventListener("click", () => r.classList.toggle("on")));
    cont.dataset.ready = "1";
  })();
}

// ── Confirmar exclusão (modal inline) ────────────────────────────────────────
function confirmarExcluir(id, nome) {
  const ov = document.createElement("div");
  ov.className = "mat-modal-ov center";
  ov.innerHTML = `
    <div class="mat-modal center">
      <div class="mat-modal-head">
        <div class="mat-modal-icon" style="background:#fef2f2;color:#dc2626">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </div>
        <div>
          <div class="mat-modal-title">Excluir matéria</div>
          <div class="mat-modal-sub">Esta ação não pode ser desfeita</div>
        </div>
        <button class="mat-modal-x" id="del-x">✕</button>
      </div>
      <div class="mat-modal-body">
        <p style="font-size:.875rem;color:var(--text-2);line-height:1.6">
          Tem certeza que deseja excluir <strong>${esc(nome)}</strong>?<br>
          Os vínculos com professores e entradas na grade de horários também serão removidos.
        </p>
      </div>
      <div class="mat-modal-foot">
        <button class="mat-btn-ghost" id="del-cancel">Cancelar</button>
        <button class="mat-btn-del-confirm" id="del-confirm">Excluir</button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("open"));

  const fechar = () => { ov.classList.remove("open"); setTimeout(() => ov.remove(), 200); };
  ov.querySelector("#del-x").addEventListener("click", fechar);
  ov.querySelector("#del-cancel").addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  ov.querySelector("#del-confirm").addEventListener("click", async () => {
    const btn = ov.querySelector("#del-confirm");
    btn.disabled = true; btn.textContent = "Excluindo…";
    await excluirMateria(id, nome);
    fechar();
  });
}

async function excluirMateria(id, nome) {
  // 1. Horários dessa matéria
  const { data: hs } = await supabaseAdmin.from("horarios").select("id").eq("materia_id", id);
  const hIds = (hs ?? []).map(h => h.id);

  // 2. Desliga as chamadas desses horários (preserva as chamadas, só tira o vínculo)
  if (hIds.length) {
    await supabaseAdmin.from("chamadas").update({ horario_id: null }).in("horario_id", hIds);
  }

  // 3. Remove vínculos de professor e os horários da matéria
  await supabaseAdmin.from("professor_materias").delete().eq("materia_id", id);
  const { error: hErr } = await supabaseAdmin.from("horarios").delete().eq("materia_id", id);
  if (hErr) { showToast("Erro: " + hErr.message, "error"); return; }

  // 4. Apaga a matéria
  const { error } = await supabaseAdmin.from("materias").delete().eq("id", id);
  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast(`"${nome}" excluída.`, "success");
  await renderMaterias();
}

// ── Vincular professor ────────────────────────────────────────────────────────
async function vincularProfessor(materiaId, profId) {
  if (!profId) { showToast("Selecione um professor.", "error"); return; }

  const { error } = await supabaseAdmin
    .from("professor_materias").insert({ professor_id: profId, materia_id: materiaId });

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor vinculado!", "success");
  await renderMaterias();
}

// ── Desvincular professor ─────────────────────────────────────────────────────
async function desvincularProfessor(materiaId, profId) {
  const { error } = await supabaseAdmin
    .from("professor_materias").delete().eq("materia_id", materiaId).eq("professor_id", profId);

  if (error) { showToast("Erro: " + error.message, "error"); return; }

  showToast("Professor desvinculado.", "success");
  await renderMaterias();
}

init();
