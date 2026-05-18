import { supabase }      from "./supabase.js";
import { supabaseAdmin }  from "./supabaseAdmin.js";
import { abrirModalGerenciar, iniciarModalGerenciar } from "./gerenciar.js";
import * as XLSX from "xlsx";

// ─── State ────────────────────────────────────────────────────────────────────
let ALUNOS     = [];
let chamadaId  = null;
let turmaNome  = "";
let chamadaData = "";
let scanning   = false;
let decoding   = false;
let stream     = null;
let animFrame  = null;
let lastResult = null;
let _chamadaEncerrada = false;
let _modoReabertura   = false;   // true = QR registra como atrasado
let _instIdAtual      = null;    // instituicao_id do usuário logado
let _userId           = null;    // id do usuário logado

// Timer
let _timerStart    = null;
let _timerInterval = null;
let _duracaoSeg    = 0;          // duração calculada ao encerrar

// ─── DOM ──────────────────────────────────────────────────────────────────────
const viewSelector  = document.getElementById("view-selector");
const viewChamada   = document.getElementById("view-chamada");
const selInst       = document.getElementById("sel-inst");
const selTurma      = document.getElementById("sel-turma");
const btnIniciar    = document.getElementById("btn-iniciar");
const selFeedback   = document.getElementById("sel-feedback");
const studentList   = document.getElementById("student-list");
const countTotal    = document.getElementById("count-total");
const countPresent  = document.getElementById("count-present");
const countAbsent   = document.getElementById("count-absent");
const modalOverlay  = document.getElementById("modal-overlay");
const modalEncerrar = document.getElementById("modal-encerrar");
const video         = document.getElementById("video");
const canvas        = document.getElementById("canvas");
const ctx           = canvas.getContext("2d", { willReadFrequently: true });
const modalStatus   = document.getElementById("modal-status");
const contentTopbar = document.getElementById("content-topbar");
const statusBadge   = document.getElementById("sidebar-status-badge");

// ─── Modo professor (sem select de instituição) ───────────────────────────────
let _isProfessor = false;

// ─── Init: detecta perfil e carrega dados ─────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  _userId = session.user.id;

  const { data: profile } = await supabase
    .from("profiles").select("role, nome, instituicao_id").eq("id", session.user.id).single();

  if (!profile) { window.location.href = "/login.html"; return; }

  if (profile.role === "professor") _isProfessor = true;
  _instIdAtual = profile.instituicao_id;

  if (profile.instituicao_id) {
    await carregarTurmasDeInst(profile.instituicao_id);
    carregarHistoricoHoje(profile.instituicao_id);
    if (_isProfessor) carregarHorarioAtual(_userId);
  } else {
    // fallback: admin sem instituição vinculada
    await carregarInstituicoes();
  }
}

async function carregarInstituicoes() {
  selInst.innerHTML = '<option value="">Carregando...</option>';

  const { data, error } = await supabase
    .from("instituicoes").select("id, nome").order("nome");

  if (error || !data?.length) {
    selInst.innerHTML = '<option value="">Nenhuma instituição cadastrada</option>';
    const hint = document.getElementById("setup-hint");
    if (hint) { hint.style.display = ""; const b = hint.querySelector(".btn-setup"); if (b) b.href = "index.html"; }
    return;
  }

  const hint = document.getElementById("setup-hint");
  if (hint) hint.style.display = "none";

  selInst.innerHTML = '<option value="">Selecione...</option>';
  data.forEach(inst => {
    const opt = document.createElement("option");
    opt.value = inst.id; opt.textContent = inst.nome;
    selInst.appendChild(opt);
  });
}

async function carregarTurmasDeInst(instId) {
  selTurma.innerHTML = '<option value="">Carregando turmas…</option>';
  selTurma.disabled  = false;
  btnIniciar.disabled = true;

  const { data, error } = await supabase
    .from("turmas").select("id, nome, professor")
    .eq("instituicao_id", instId).order("nome");

  if (error || !data?.length) {
    selTurma.innerHTML = '<option value="">Nenhuma turma cadastrada</option>';
    selFeedback.textContent = "Nenhuma turma encontrada para esta instituição.";
    return;
  }

  selTurma.innerHTML = '<option value="">Selecione a turma…</option>';
  data.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.nome;
    selTurma.appendChild(opt);
  });
  selTurma.disabled = false;
}

async function carregarHorarioAtual(profId) {
  const agora      = new Date();
  const diaSemana  = agora.getDay(); // 0=Dom
  const hh         = String(agora.getHours()).padStart(2, "0");
  const mm         = String(agora.getMinutes()).padStart(2, "0");
  const horaAtual  = `${hh}:${mm}`;

  const { data } = await supabaseAdmin
    .from("horarios")
    .select("hora_inicio, hora_fim, turma_id, materias(nome), turmas(nome)")
    .eq("professor_id", profId)
    .eq("dia_semana", diaSemana);

  const slots = data ?? [];
  const ativa  = slots.find(h => h.hora_inicio <= horaAtual && horaAtual < h.hora_fim);

  const el = document.getElementById("aula-atual");
  if (!el) return;

  if (ativa) {
    const matNome   = ativa.materias?.nome  ?? "Aula";
    const turmaNome = ativa.turmas?.nome    ?? "";
    el.innerHTML = `
      <div class="aula-banner agora">
        <div class="aula-banner-dot"></div>
        <div class="aula-banner-info">
          <span class="aula-banner-mat">${matNome}</span>
          ${turmaNome ? `<span class="aula-banner-turma">${turmaNome}</span>` : ""}
        </div>
        <span class="aula-banner-chip">Agora</span>
      </div>`;
    el.style.display = "";
    if (ativa.turma_id && selTurma) {
      selTurma.value = ativa.turma_id;
      btnIniciar.disabled = selTurma.value !== ativa.turma_id;
    }
  } else {
    el.innerHTML = `
      <div class="aula-banner livre">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Horário livre</span>
      </div>`;
    el.style.display = "";
  }
}

selInst.addEventListener("change", async () => {
  const instId = selInst.value;
  selTurma.innerHTML  = '<option value="">Selecione...</option>';
  selTurma.disabled   = true;
  btnIniciar.disabled = true;
  selFeedback.textContent = "";

  if (!instId) return;

  await carregarTurmasDeInst(instId);
});

selTurma.addEventListener("change", () => {
  btnIniciar.disabled = !selTurma.value;
  selFeedback.textContent = "";
});

// ─── Iniciar chamada ──────────────────────────────────────────────────────────
btnIniciar.addEventListener("click", async () => {
  const turmaId = selTurma.value;
  if (!turmaId) return;

  btnIniciar.disabled    = true;
  btnIniciar.textContent = "Abrindo chamada...";
  selFeedback.textContent = "";

  const { data: turma } = await supabase
    .from("turmas").select("nome, professor, horario")
    .eq("id", turmaId).single();

  chamadaData = new Date().toISOString().split("T")[0];
  turmaNome   = turma?.nome ?? "Turma";

  // Verifica chamada ABERTA hoje
  let { data: chamadaExistente } = await supabase
    .from("chamadas")
    .select("id")
    .eq("turma_id", turmaId)
    .eq("data", chamadaData)
    .eq("aberta", true)
    .maybeSingle();

  if (chamadaExistente) {
    chamadaId = chamadaExistente.id;
  } else {
    const { data: novaChamada, error } = await supabase
      .from("chamadas")
      .insert({ turma_id: turmaId, data: chamadaData, professor_id: _userId || null })
      .select("id").single();

    if (error) {
      selFeedback.textContent = "Erro ao criar chamada: " + error.message;
      btnIniciar.disabled    = false;
      btnIniciar.textContent = "Iniciar Chamada";
      return;
    }
    chamadaId = novaChamada.id;
  }

  _chamadaEncerrada = false;
  _modoReabertura   = false;

  // Mostra topbar com info da chamada
  document.getElementById("topbar-titulo").textContent  = turma?.nome       ?? "—";
  document.getElementById("topbar-sub").textContent     = turma?.professor   ? `· ${turma.professor}` : "";
  document.getElementById("topbar-horario").textContent = turma?.horario     ?? "";
  if (contentTopbar) contentTopbar.style.display = "";
  if (statusBadge)   statusBadge.style.display   = "";

  await carregarAlunos(turmaId);
  if (chamadaExistente) await carregarPresencasExistentes();

  renderList();
  updateStats();
  aplicarModoEncerrada();
  iniciarTimer();
  if (turmaId) carregarMediaChamadas(turmaId);
  mostrarViewChamada();

  btnIniciar.disabled    = false;
  btnIniciar.textContent = "Iniciar Chamada";
});

// ─── Carregar alunos ──────────────────────────────────────────────────────────
async function carregarAlunos(turmaId) {
  const { data, error } = await supabase
    .from("alunos")
    .select("id, nome, matricula, foto_url")
    .eq("turma_id", turmaId).order("nome");

  if (error) {
    studentList.innerHTML = `<div class="list-msg error">Erro ao carregar alunos: ${error.message}</div>`;
    return;
  }

  ALUNOS = (data ?? []).map(a => ({ ...a, presente: false, qrCode: a.matricula }));
}

// ─── Presenças já registradas ─────────────────────────────────────────────────
async function carregarPresencasExistentes() {
  const { data } = await supabase
    .from("presencas").select("aluno_id").eq("chamada_id", chamadaId);

  if (!data) return;
  const ids = new Set(data.map(p => p.aluno_id));
  ALUNOS.forEach(a => { if (ids.has(a.id)) a.presente = true; });
}

// ─── Encerrar chamada ─────────────────────────────────────────────────────────
document.getElementById("btn-encerrar").addEventListener("click", () => {
  const presentes = ALUNOS.filter(a => a.presente).length;
  document.getElementById("confirm-msg").textContent =
    `${presentes} de ${ALUNOS.length} alunos presentes. Esta ação não pode ser desfeita.`;
  modalEncerrar.classList.add("open");
});

document.getElementById("btn-confirm-cancel").addEventListener("click", () => {
  modalEncerrar.classList.remove("open");
});

document.getElementById("btn-confirm-ok").addEventListener("click", async () => {
  modalEncerrar.classList.remove("open");

  pararTimer();
  const agora = new Date().toISOString();

  await supabase.from("chamadas").update({
    aberta: false,
    encerrada_em: agora,
    duracao_seg: _duracaoSeg,
  }).eq("id", chamadaId);

  const presentes = ALUNOS.filter(a => a.presente).length;
  const ausentes  = ALUNOS.length - presentes;
  const cIdAtual  = chamadaId;

  // Modal de observação
  abrirModalObservacao(_duracaoSeg, presentes, ausentes, async (obs) => {
    if (obs) {
      await supabase.from("chamadas").update({ observacao: obs }).eq("id", cIdAtual);
    }
  });

  chamadaId   = null;
  ALUNOS      = [];
  turmaNome   = "";
  chamadaData = "";
  _chamadaEncerrada = false;
  _modoReabertura   = false;
  _duracaoSeg       = 0;

  if (contentTopbar) contentTopbar.style.display = "none";
  if (statusBadge)   statusBadge.style.display   = "none";

  mostrarViewSeletor();
  showToast("Chamada encerrada.", "success");
});

// ─── Exportar planilha Excel ──────────────────────────────────────────────────
document.getElementById("btn-exportar").addEventListener("click", () => {
  if (!ALUNOS.length) {
    showToast("Nenhum aluno para exportar.", "error");
    return;
  }

  const dataFmt = chamadaData
    ? chamadaData.split("-").reverse().join("/")
    : new Date().toLocaleDateString("pt-BR");

  const presentes = ALUNOS.filter(a => a.presente).length;
  const ausentes  = ALUNOS.length - presentes;

  // Monta as linhas da planilha
  const linhas = [
    ["RELATÓRIO DE CHAMADA"],
    [""],
    ["Turma:",     turmaNome],
    ["Data:",      dataFmt],
    ["Total de alunos:", ALUNOS.length],
    ["Presentes:",  presentes],
    ["Ausentes:",   ausentes],
    [""],
    ["Nº", "Nome do Aluno", "Matrícula", "Presença"],
  ];

  ALUNOS.forEach((a, i) => {
    linhas.push([
      i + 1,
      a.nome,
      a.matricula,
      a.presente ? "Presente" : "Ausente",
    ]);
  });

  // Cria a worksheet
  const ws = XLSX.utils.aoa_to_sheet(linhas);

  // Largura das colunas
  ws["!cols"] = [
    { wch: 5  },   // Nº
    { wch: 40 },   // Nome
    { wch: 16 },   // Matrícula
    { wch: 12 },   // Presença
  ];

  // Mesclar célula do título
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

  const wb = XLSX.utils.book_new();
  const sheetName = `Chamada ${dataFmt.replace(/\//g, "-")}`;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

  const nomeSafe = turmaNome.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
  XLSX.writeFile(wb, `Chamada_${nomeSafe}_${chamadaData || "hoje"}.xlsx`);

  showToast("Planilha exportada com sucesso!", "success");
});

// ─── Render ───────────────────────────────────────────────────────────────────
function renderList() {
  studentList.innerHTML = "";

  if (ALUNOS.length === 0) {
    studentList.innerHTML = '<div class="list-msg">Nenhum aluno cadastrado nesta turma.</div>';
    return;
  }

  ALUNOS.forEach(aluno => {
    const status   = aluno.presente ? "present" : "absent";
    const badge    = aluno.presente ? "Presente" : "Ausente";
    const initials = aluno.nome.split(" ").slice(0, 2).map(n => n[0]).join("");
    const avatar   = aluno.foto_url
      ? `<img class="avatar-img ${status}" src="${aluno.foto_url}" alt="${initials}" />`
      : `<div class="avatar ${status}">${initials}</div>`;

    const card = document.createElement("div");
    card.className = "student-card";
    card.id        = `card-${aluno.id}`;
    card.innerHTML = `
      ${avatar}
      <div class="student-info">
        <div class="student-name">${aluno.nome}</div>
        <div class="student-meta">Matrícula: ${aluno.matricula}</div>
      </div>
      <span class="badge ${status}">${badge}</span>
    `;
    studentList.appendChild(card);
  });
}

function updateStats() {
  const total   = ALUNOS.length;
  const present = ALUNOS.filter(a => a.presente).length;
  countTotal.textContent   = total;
  countPresent.textContent = present;
  countAbsent.textContent  = total - present;
}

function refreshCard(aluno) {
  const card = document.getElementById(`card-${aluno.id}`);
  if (!card) return;

  const initials = aluno.nome.split(" ").slice(0, 2).map(n => n[0]).join("");
  const avatar   = aluno.foto_url
    ? `<img class="avatar-img present" src="${aluno.foto_url}" alt="${initials}" />`
    : `<div class="avatar present">${initials}</div>`;

  card.innerHTML = `
    ${avatar}
    <div class="student-info">
      <div class="student-name">${aluno.nome}</div>
      <div class="student-meta">Matrícula: ${aluno.matricula}</div>
    </div>
    <span class="badge present">Presente</span>
  `;
  card.classList.add("just-marked");
  setTimeout(() => card.classList.remove("just-marked"), 1200);
}

// ─── Lógica de presença ───────────────────────────────────────────────────────
async function handleQRResult(qrValue) {
  const aluno = ALUNOS.find(a => a.qrCode === qrValue.trim());

  if (!aluno) {
    showToast("QR Code não reconhecido.", "error");
    modalStatus.textContent = "Aluno não encontrado. Tente novamente.";
    setTimeout(() => { lastResult = null; }, 2000);
    return;
  }

  if (aluno.presente) {
    showToast(`${aluno.nome} já está presente.`, "error");
    modalStatus.textContent = "Presença já registrada.";
    setTimeout(() => { lastResult = null; }, 2000);
    return;
  }

  const { error } = await supabase
    .from("presencas")
    .insert({ chamada_id: chamadaId, aluno_id: aluno.id, atrasado: _modoReabertura });

  if (error && error.code !== "23505") {
    showToast("Erro ao registrar presença.", "error");
    setTimeout(() => { lastResult = null; }, 2000);
    return;
  }

  aluno.presente = true;
  updateStats();
  refreshCard(aluno);
  showPresencaConfirmada(aluno);
  modalStatus.textContent = "Aponte para o próximo QR Code";

  setTimeout(() => { lastResult = null; }, 2500);
}

// ─── Scanner ──────────────────────────────────────────────────────────────────
document.getElementById("btn-scan").addEventListener("click", openScanner);
document.getElementById("btn-fechar-modal").addEventListener("click", closeScanner);

async function openScanner() {
  modalOverlay.classList.add("open");
  modalStatus.textContent = "Iniciando câmera...";
  lastResult = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
    modalStatus.textContent = "Aponte para o QR Code do aluno";
    scanning = true;
    requestAnimationFrame(scanLoop);
  } catch (err) {
    modalStatus.textContent = "Erro ao acessar câmera: " + err.message;
  }
}

function closeScanner() {
  scanning = false;
  cancelAnimationFrame(animFrame);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  modalOverlay.classList.remove("open");
}

async function decodeQR(imageData) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const codes    = await detector.detect(await createImageBitmap(imageData));
      if (codes.length > 0) return codes[0].rawValue;
    } catch (_) {}
  }
  if (window.jsQR) {
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) return code.data;
  }
  return null;
}

function scanLoop() {
  if (!scanning) return;

  if (!decoding && video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    decoding = true;
    decodeQR(imageData).then(result => {
      decoding = false;
      if (result && result !== lastResult) {
        lastResult = result;
        handleQRResult(result);
      }
    });
  }

  animFrame = requestAnimationFrame(scanLoop);
}

// ─── Chamadas recentes (mantida para compatibilidade) ─────────────────────────
async function carregarChamadasRecentes() {
  const doze = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("chamadas")
    .select("id, aberta, criado_em, turmas(id, nome, instituicao_id, instituicoes(nome))")
    .eq("aberta", false)
    .gte("criado_em", doze)
    .order("criado_em", { ascending: false });

  const section = document.getElementById("recentes-section");
  const lista   = document.getElementById("recentes-lista");
  if (!section || !lista) return;

  if (!data?.length) { section.style.display = "none"; return; }

  section.style.display = "";
  lista.innerHTML = "";

  data.forEach(c => {
    const turma    = c.turmas;
    const inst     = turma?.instituicoes?.nome ?? "";
    const horaFmt  = new Date(c.criado_em).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });

    const card = document.createElement("button");
    card.style.cssText = `
      width:100%;display:flex;align-items:center;gap:12px;
      padding:13px 15px;background:white;
      border:1px solid #fde68a;border-radius:12px;
      cursor:pointer;text-align:left;font-family:inherit;
      transition:all .15s;box-shadow:0 1px 4px rgba(245,158,11,.1);
    `;
    card.innerHTML = `
      <div style="width:36px;height:36px;border-radius:10px;background:#fef3c7;
        display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" width="18" height="18">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.875rem;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${turma?.nome ?? "Turma"}
        </div>
        <div style="font-size:.72rem;color:#64748b;margin-top:2px">
          ${inst} · Encerrada às ${horaFmt}
        </div>
      </div>
      <div style="font-size:.7rem;font-weight:700;color:#d97706;background:#fef3c7;
        padding:3px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0">
        + Atrasados
      </div>
    `;
    card.addEventListener("mouseenter", () => { card.style.background = "#fffbeb"; card.style.borderColor = "#f59e0b"; });
    card.addEventListener("mouseleave", () => { card.style.background = "white";   card.style.borderColor = "#fde68a"; });
    card.addEventListener("click", () => abrirModalAtrasados(c.id, turma?.nome ?? "Turma", turma?.id));
    lista.appendChild(card);
  });
}

async function abrirModalAtrasados(chamadaIdRef, turmaNomeRef, turmaIdRef) {
  // Busca alunos da turma e presenças já registradas
  const [{ data: alunos }, { data: presentes }] = await Promise.all([
    supabase.from("alunos").select("id, nome, matricula").eq("turma_id", turmaIdRef).order("nome"),
    supabase.from("presencas").select("aluno_id").eq("chamada_id", chamadaIdRef),
  ]);

  const presenteIds = new Set((presentes ?? []).map(p => p.aluno_id));
  const ausentes = (alunos ?? []).filter(a => !presenteIds.has(a.id));

  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed;inset:0;z-index:900;
    display:flex;align-items:flex-end;justify-content:center;
    background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);
    opacity:0;transition:opacity .2s;
  `;

  ov.innerHTML = `
    <div id="at-card" style="
      background:white;border-radius:20px 20px 0 0;width:100%;max-width:520px;
      box-shadow:0 -8px 40px rgba(0,0,0,0.2);
      transform:translateY(100%);transition:transform .28s cubic-bezier(.22,1,.36,1);
      display:flex;flex-direction:column;max-height:80vh;overflow:hidden;
    ">
      <div style="padding:16px 18px 12px;border-bottom:1px solid #f1f5f9;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:.6rem;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px">
            ⏰ Chegada tardia
          </div>
          <h3 style="font-size:1rem;font-weight:800;color:#1e293b">${turmaNomeRef}</h3>
          <p style="font-size:.78rem;color:#94a3b8;margin-top:2px">Selecione quem chegou atrasado</p>
        </div>
        <button id="at-fechar" style="width:30px;height:30px;border-radius:50%;background:#f1f5f9;border:none;cursor:pointer;color:#64748b;font-size:1rem">✕</button>
      </div>

      <div style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:6px;">
        ${ausentes.length === 0
          ? `<div style="padding:32px;text-align:center;color:#94a3b8;font-size:.875rem">
               <div style="font-size:2rem;margin-bottom:8px">✅</div>
               Todos os alunos já foram registrados!
             </div>`
          : ausentes.map(a => {
              const ini = a.nome.split(" ").slice(0,2).map(n=>n[0]).join("");
              return `
              <label style="display:flex;align-items:center;gap:12px;padding:11px 13px;
                background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                cursor:pointer;" class="at-row">
                <input type="checkbox" value="${a.id}" style="width:16px;height:16px;accent-color:#f59e0b;cursor:pointer;flex-shrink:0">
                <div style="width:34px;height:34px;border-radius:50%;background:#fef3c7;
                  color:#d97706;display:flex;align-items:center;justify-content:center;
                  font-size:.75rem;font-weight:700;flex-shrink:0">${ini}</div>
                <div style="flex:1">
                  <div style="font-size:.875rem;font-weight:600;color:#1e293b">${a.nome}</div>
                  <div style="font-size:.72rem;color:#94a3b8">Matrícula: ${a.matricula}</div>
                </div>
              </label>`;
            }).join("")
        }
      </div>

      ${ausentes.length > 0 ? `
        <div style="padding:14px 16px;border-top:1px solid #f1f5f9;flex-shrink:0;display:flex;gap:10px">
          <button id="at-cancelar" style="flex:1;padding:12px;border:1px solid #e2e8f0;border-radius:10px;
            background:#f8fafc;color:#64748b;font-size:.875rem;font-weight:600;
            cursor:pointer;font-family:inherit">Cancelar</button>
          <button id="at-confirmar" style="flex:2;padding:12px;border:none;border-radius:10px;
            background:#f59e0b;color:white;font-size:.875rem;font-weight:700;
            cursor:pointer;font-family:inherit;
            box-shadow:0 4px 14px rgba(245,158,11,0.4)">
            Registrar como atrasado
          </button>
        </div>` : ""}
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = "1";
    ov.querySelector("#at-card").style.transform = "translateY(0)";
  });

  const fechar = () => {
    ov.style.opacity = "0";
    ov.querySelector("#at-card").style.transform = "translateY(100%)";
    setTimeout(() => ov.remove(), 250);
  };

  ov.querySelector("#at-fechar").addEventListener("click", fechar);
  ov.querySelector("#at-cancelar")?.addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  ov.querySelector("#at-confirmar")?.addEventListener("click", async () => {
    const selecionados = [...ov.querySelectorAll("input:checked")].map(cb => cb.value);
    if (!selecionados.length) { showToast("Selecione pelo menos um aluno.", "error"); return; }

    const btn = ov.querySelector("#at-confirmar");
    btn.disabled = true; btn.textContent = "Registrando…";

    const inserts = selecionados.map(alunoId => ({
      chamada_id: chamadaIdRef,
      aluno_id:   alunoId,
      atrasado:   true,
    }));

    const { error } = await supabase.from("presencas").insert(inserts);
    if (error) {
      showToast("Erro: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Registrar como atrasado";
      return;
    }

    fechar();
    showToast(`${selecionados.length} aluno${selecionados.length > 1 ? "s" : ""} registrado${selecionados.length > 1 ? "s" : ""} como atrasado!`, "success");
    carregarChamadasRecentes(); // atualiza a lista
  });
}

// ─── Modo chamada encerrada ───────────────────────────────────────────────────
function aplicarModoEncerrada() {
  const btnEncerrar = document.getElementById("btn-encerrar");
  const btnScan     = document.getElementById("btn-scan");
  const btnExportar = document.getElementById("btn-exportar");

  // Remove botão de presença manual anterior se existir
  document.getElementById("btn-presenca-manual")?.remove();

  if (_chamadaEncerrada) {
    if (btnEncerrar) btnEncerrar.style.display = "none";
    if (btnScan)     btnScan.style.display     = "none";

    // Insere badge "Encerrada" e botão de presença manual
    const btnManual = document.createElement("button");
    btnManual.id        = "btn-presenca-manual";
    btnManual.className = "scan-btn";
    btnManual.style.cssText = "background:#7c3aed;box-shadow:0 4px 14px rgba(124,58,237,0.4);gap:8px;display:flex;align-items:center;justify-content:center;";
    btnManual.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <line x1="19" y1="8" x2="19" y2="14"/>
        <line x1="22" y1="11" x2="16" y2="11"/>
      </svg>
      Adicionar presença manual
    `;
    btnManual.addEventListener("click", abrirModalPresencaManual);
    btnScan?.parentNode?.insertBefore(btnManual, btnScan);
  } else {
    if (btnEncerrar) btnEncerrar.style.display = "";
    if (btnScan)     btnScan.style.display     = "";
  }
}

async function abrirModalPresencaManual() {
  const ausentes = ALUNOS.filter(a => !a.presente);

  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed;inset:0;z-index:900;
    display:flex;align-items:flex-end;justify-content:center;
    background:rgba(7,9,18,0.65);backdrop-filter:blur(5px);
    opacity:0;transition:opacity .2s;
  `;

  ov.innerHTML = `
    <div id="pm-card" style="
      background:var(--surface);border:1px solid var(--border);
      border-radius:20px 20px 0 0;width:100%;max-width:520px;
      box-shadow:0 -8px 40px rgba(0,0,0,0.4);
      transform:translateY(100%);transition:transform .28s cubic-bezier(.22,1,.36,1);
      display:flex;flex-direction:column;max-height:80vh;overflow:hidden;
    ">
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:.6rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px">Presença manual</div>
          <h3 style="font-size:1rem;font-weight:800;color:var(--text);letter-spacing:-.02em">Alunos ausentes</h3>
          <p style="font-size:.78rem;color:var(--text-3);margin-top:2px">Selecione quem chegou atrasado</p>
        </div>
        <button id="pm-fechar" style="width:30px;height:30px;border-radius:50%;background:var(--surface-3);border:none;cursor:pointer;color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:1rem">✕</button>
      </div>

      <div id="pm-lista" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:6px;">
        ${ausentes.length === 0
          ? `<div style="padding:32px;text-align:center;color:var(--text-3);font-size:.875rem">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.3;margin-bottom:10px">
                 <polyline points="20 6 9 17 4 12"/>
               </svg>
               <p>Todos os alunos já estão presentes!</p>
             </div>`
          : ausentes.map(a => {
              const ini = a.nome.split(" ").slice(0,2).map(n=>n[0]).join("");
              return `
              <label style="display:flex;align-items:center;gap:12px;padding:11px 13px;
                background:var(--surface-2);border:1px solid var(--border);border-radius:10px;
                cursor:pointer;transition:background .12s;" class="pm-row">
                <input type="checkbox" value="${a.id}" style="width:16px;height:16px;accent-color:#7c3aed;flex-shrink:0;cursor:pointer">
                <div style="width:34px;height:34px;border-radius:50%;background:rgba(124,58,237,0.12);
                  color:#7c3aed;display:flex;align-items:center;justify-content:center;
                  font-size:.75rem;font-weight:700;flex-shrink:0">${ini}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.875rem;font-weight:600;color:var(--text)">${a.nome}</div>
                  <div style="font-size:.72rem;color:var(--text-3)">Matrícula: ${a.matricula}</div>
                </div>
              </label>`;
            }).join("")
        }
      </div>

      ${ausentes.length > 0 ? `
        <div style="padding:14px 16px;border-top:1px solid var(--border);flex-shrink:0;display:flex;gap:10px">
          <button id="pm-cancelar" style="flex:1;padding:12px;border:1px solid var(--border-2);border-radius:10px;
            background:var(--surface-2);color:var(--text-2);font-size:.875rem;font-weight:600;
            cursor:pointer;font-family:inherit;transition:all .13s">Cancelar</button>
          <button id="pm-confirmar" style="flex:2;padding:12px;border:none;border-radius:10px;
            background:#7c3aed;color:white;font-size:.875rem;font-weight:700;
            cursor:pointer;font-family:inherit;transition:all .13s;
            box-shadow:0 4px 14px rgba(124,58,237,0.4)">
            Confirmar presenças
          </button>
        </div>` : ""}
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = "1";
    ov.querySelector("#pm-card").style.transform = "translateY(0)";
  });

  const fechar = () => {
    ov.style.opacity = "0";
    ov.querySelector("#pm-card").style.transform = "translateY(100%)";
    setTimeout(() => ov.remove(), 250);
  };

  ov.querySelector("#pm-fechar").addEventListener("click", fechar);
  ov.querySelector("#pm-cancelar")?.addEventListener("click", fechar);
  ov.addEventListener("click", e => { if (e.target === ov) fechar(); });

  // Hover nas linhas
  ov.querySelectorAll(".pm-row").forEach(row => {
    row.addEventListener("mouseenter", () => row.style.background = "var(--surface-3)");
    row.addEventListener("mouseleave", () => row.style.background = "var(--surface-2)");
  });

  ov.querySelector("#pm-confirmar")?.addEventListener("click", async () => {
    const selecionados = [...ov.querySelectorAll("input[type=checkbox]:checked")].map(cb => cb.value);
    if (selecionados.length === 0) {
      showToast("Selecione pelo menos um aluno.", "error");
      return;
    }

    const btn = ov.querySelector("#pm-confirmar");
    btn.disabled = true; btn.textContent = "Salvando…";

    const inserts = selecionados.map(alunoId => ({ chamada_id: chamadaId, aluno_id: alunoId }));
    const { error } = await supabase.from("presencas").insert(inserts);

    if (error) {
      showToast("Erro ao salvar presenças: " + error.message, "error");
      btn.disabled = false; btn.textContent = "Confirmar presenças";
      return;
    }

    // Atualiza estado local
    selecionados.forEach(id => {
      const a = ALUNOS.find(x => x.id === id);
      if (a) { a.presente = true; refreshCard(a); }
    });
    updateStats();

    fechar();
    showToast(`${selecionados.length} presença${selecionados.length > 1 ? "s" : ""} adicionada${selecionados.length > 1 ? "s" : ""}!`, "success");
  });
}

// ─── Histórico de hoje (painel direito) ──────────────────────────────────────
async function carregarHistoricoHoje(instId) {
  const painel = document.getElementById("historico-hoje");
  const lista  = document.getElementById("historico-lista");
  if (!painel || !lista) return;

  const hoje = new Date().toISOString().split("T")[0];

  // Para professor: filtra por professor_id direto na chamada
  // Para admin/instituição: filtra por turmas da instituição
  let chamadasQuery = supabase
    .from("chamadas")
    .select("id, aberta, criado_em, duracao_seg, turma_id, turmas(id, nome)")
    .eq("data", hoje)
    .order("criado_em", { ascending: false });

  const baseQuery = () => supabase
    .from("chamadas")
    .select("id, aberta, criado_em, duracao_seg, turma_id, turmas(id, nome)")
    .eq("data", hoje)
    .order("criado_em", { ascending: false });

  // Para professor: tenta filtrar por professor_id; se a coluna ainda não estiver
  // no cache do Supabase (400), cai no fallback por turmas da instituição
  let data;
  if (_isProfessor && _userId) {
    const { data: porProfessor, error } = await baseQuery().eq("professor_id", _userId);
    if (!error) {
      data = porProfessor;
    } else {
      const { data: turmasData } = await supabase
        .from("turmas").select("id").eq("instituicao_id", instId);
      const turmaIds = (turmasData ?? []).map(t => t.id);
      if (!turmaIds.length) { lista.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:.82rem">Nenhuma turma cadastrada</div>`; return; }
      const { data: porTurma } = await baseQuery().in("turma_id", turmaIds);
      data = porTurma;
    }
  } else {
    const { data: turmasData } = await supabase
      .from("turmas").select("id").eq("instituicao_id", instId);
    const turmaIds = (turmasData ?? []).map(t => t.id);
    if (!turmaIds.length) {
      lista.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:.82rem">Nenhuma turma cadastrada</div>`;
      return;
    }
    const { data: porTurma } = await baseQuery().in("turma_id", turmaIds);
    data = porTurma;
  }

  painel.style.display = "flex";
  lista.innerHTML = "";

  if (!data?.length) {
    lista.innerHTML = `
      <div style="padding:32px 12px;text-align:center;color:var(--text-3)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="opacity:.25;margin-bottom:10px">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <p style="font-size:.82rem">Nenhuma chamada hoje ainda</p>
      </div>`;
    return;
  }

  data.forEach((c, i) => {
    const hora    = new Date(c.criado_em).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
    const dur     = c.duracao_seg ? fmtSeg(c.duracao_seg) : null;
    const aberta  = c.aberta;

    const row = document.createElement("div");
    row.style.cssText = `
      background:var(--surface);border:1px solid var(--border);border-radius:12px;
      padding:12px 13px;animation:dashUp .25s cubic-bezier(.22,1,.36,1) ${i*.06}s both;
    `;
    row.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="min-width:0;flex:1">
          <div style="font-size:.84rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${c.turmas?.nome ?? "Turma"}
          </div>
          <div style="font-size:.7rem;color:var(--text-3);margin-top:3px;display:flex;align-items:center;gap:6px">
            <span>${hora}</span>
            ${dur ? `<span>·</span><span>⏱ ${dur}</span>` : ""}
          </div>
        </div>
        <span style="flex-shrink:0;font-size:.6rem;font-weight:700;padding:3px 9px;border-radius:20px;
          ${aberta
            ? "background:#dcfce7;color:#14532d;border:1px solid #86efac"
            : "background:var(--surface-3);color:var(--text-3);border:1px solid var(--border)"
          }">
          ${aberta ? "Em andamento" : "Encerrada"}
        </span>
      </div>
      ${!aberta ? `
        <button data-id="${c.id}" data-turma="${c.turmas?.id}" data-nome="${c.turmas?.nome ?? ""}"
          class="btn-reabrir-hist"
          style="margin-top:8px;width:100%;padding:7px;border-radius:8px;
            background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);
            color:#d97706;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;
            transition:all .13s">
          ⏰ Reabrir para atrasados
        </button>` : ""}
    `;

    if (!aberta) {
      row.querySelector(".btn-reabrir-hist").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        reabrirChamada(btn.dataset.id, btn.dataset.turma, btn.dataset.nome);
      });
    }
    lista.appendChild(row);
  });

  // Atualiza badge do FAB mobile
  const badge = document.getElementById("hist-fab-badge");
  if (badge) badge.textContent = data.length;
}

// ─── Bottom sheet histórico (mobile) ─────────────────────────────────────────
function abrirHistorico() {
  document.getElementById("historico-hoje")?.classList.add("hist-aberto");
  const bd = document.getElementById("hist-backdrop");
  if (bd) { bd.style.display = "block"; requestAnimationFrame(() => bd.classList.add("visivel")); }
  document.getElementById("hist-fab")?.classList.add("oculto");
}
function fecharHistorico() {
  document.getElementById("historico-hoje")?.classList.remove("hist-aberto");
  const bd = document.getElementById("hist-backdrop");
  if (bd) {
    bd.classList.remove("visivel");
    setTimeout(() => { bd.style.display = "none"; }, 300);
  }
  document.getElementById("hist-fab")?.classList.remove("oculto");
}

document.getElementById("hist-fab")?.addEventListener("click", abrirHistorico);
document.getElementById("hist-fechar")?.addEventListener("click", fecharHistorico);
document.getElementById("hist-handle")?.addEventListener("click", fecharHistorico);
document.getElementById("hist-backdrop")?.addEventListener("click", fecharHistorico);

// ─── Timer ────────────────────────────────────────────────────────────────────
function fmtSeg(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function iniciarTimer() {
  _timerStart = Date.now();
  _timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _timerStart) / 1000);
    const el = document.getElementById("timer-display");
    if (el) el.textContent = fmtSeg(elapsed);
  }, 1000);
}

function pararTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
  _duracaoSeg = _timerStart ? Math.floor((Date.now() - _timerStart) / 1000) : 0;
  _timerStart = null;
}

async function carregarMediaChamadas(turmaId) {
  const { data } = await supabase
    .from("chamadas")
    .select("duracao_seg")
    .eq("turma_id", turmaId)
    .not("duracao_seg", "is", null)
    .order("criado_em", { ascending: false })
    .limit(10);
  if (!data?.length) return;
  const media = Math.round(data.reduce((s, c) => s + c.duracao_seg, 0) / data.length);
  const el = document.getElementById("timer-media");
  const wrap = document.getElementById("timer-media-wrap");
  if (el && wrap) { el.textContent = fmtSeg(media); wrap.style.display = "block"; }
}

// ─── Modal de observação pós-chamada ──────────────────────────────────────────
function abrirModalObservacao(durSeg, presentes, ausentes, onSalvar) {
  const ov = document.getElementById("modal-observacao");
  if (!ov) { onSalvar(""); return; }

  const el = (id) => document.getElementById(id);
  el("obs-duracao").textContent   = fmtSeg(durSeg);
  el("obs-presentes").textContent = presentes;
  el("obs-ausentes").textContent  = ausentes;
  el("obs-texto").value = "";
  ov.classList.add("open");

  const fechar = (texto) => {
    ov.classList.remove("open");
    onSalvar(texto || "");
  };

  el("obs-pular").onclick   = () => fechar("");
  el("obs-salvar").onclick  = () => fechar(el("obs-texto").value.trim());
}


async function reabrirChamada(cId, turmaId, nome) {
  chamadaId         = cId;
  turmaNome         = nome;
  chamadaData       = new Date().toISOString().split("T")[0];
  _modoReabertura   = true;
  _chamadaEncerrada = false;

  document.getElementById("topbar-titulo").textContent = nome;
  document.getElementById("topbar-sub").textContent    = "· Reabertura — atrasados";
  document.getElementById("topbar-horario").textContent = "";
  if (contentTopbar) contentTopbar.style.display = "";
  if (statusBadge)   statusBadge.style.display   = "";

  await carregarAlunos(turmaId);
  await carregarPresencasExistentes();
  renderList();
  updateStats();
  aplicarModoEncerrada();

  // Banner de reabertura
  const banner = document.createElement("div");
  banner.id = "banner-reabertura";
  banner.style.cssText = `
    background:linear-gradient(90deg,rgba(245,158,11,.12),rgba(245,158,11,.06));
    border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 14px;
    margin-bottom:14px;display:flex;align-items:center;gap:8px;
    font-size:.78rem;font-weight:600;color:#92400e;
  `;
  banner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    Modo reabertura — presenças registradas como <strong style="margin-left:4px">atrasado</strong>
  `;
  const container = viewChamada.querySelector(".container");
  if (container) container.insertBefore(banner, container.firstChild);

  iniciarTimer();
  mostrarViewChamada();
}

// ─── Navegação entre views ────────────────────────────────────────────────────
function mostrarViewChamada() {
  fecharHistorico(); // garante que backdrop e sheet fecham antes de mudar de view
  viewSelector.style.display = "none";
  viewChamada.style.display  = "block";
}

function mostrarViewSeletor() {
  viewChamada.style.display  = "none";
  viewSelector.style.display = "";
  fecharHistorico(); // reseta estado do sheet ao voltar
  btnIniciar.disabled = true;
  pararTimer();
  document.getElementById("banner-reabertura")?.remove();
  _modoReabertura = false;

  if (_isProfessor) {
    selTurma.value = "";
  } else {
    selTurma.innerHTML = '<option value="">Selecione a instituição</option>';
    selTurma.disabled  = true;
    selInst.value      = "";
  }

  // Atualiza histórico
  if (_instIdAtual) carregarHistoricoHoje(_instIdAtual);
}

// ─── Flash de confirmação de presença ────────────────────────────────────────
function showPresencaConfirmada(aluno) {
  const overlay  = document.getElementById("presenca-flash");
  const avatarEl = document.getElementById("pf-avatar");
  const nameEl   = document.getElementById("pf-name");
  const barFill  = document.getElementById("pf-bar-fill");
  if (!overlay) return;

  const initials = aluno.nome.split(" ").slice(0, 2).map(n => n[0]).join("");
  avatarEl.innerHTML = aluno.foto_url
    ? `<img src="${aluno.foto_url}" alt="${initials}" />`
    : initials;
  nameEl.textContent = aluno.nome;

  // Reinicia a barra de progresso
  barFill.style.animation = "none";
  barFill.offsetHeight; // reflow
  barFill.style.animation = "";

  overlay.classList.add("show");

  clearTimeout(showPresencaConfirmada._t);
  showPresencaConfirmada._t = setTimeout(() => {
    overlay.classList.remove("show");
  }, 2400);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// ─── Modal gerenciar ──────────────────────────────────────────────────────────
const btnGerenciar = document.getElementById("btn-gerenciar");
if (btnGerenciar) {
  btnGerenciar.addEventListener("click", () => {
    abrirModalGerenciar(async (tipo) => {
      if (tipo === "instituicao") await init();
    });
  });
}

iniciarModalGerenciar();
init();
