import { supabase } from "./supabase.js";
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

  const { data: profile } = await supabase
    .from("profiles").select("role, nome, instituicao_id").eq("id", session.user.id).single();

  if (!profile) { window.location.href = "/login.html"; return; }

  if (profile.role === "professor" && profile.instituicao_id) {
    _isProfessor = true;
    // Esconde o grupo de instituição
    const instGroup = selInst.closest(".sel-group");
    if (instGroup) instGroup.style.display = "none";
    // Carrega turmas direto da instituição do professor
    await carregarTurmasDeInst(profile.instituicao_id);
  } else {
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
  selTurma.disabled  = true;
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

  // Verifica chamada aberta hoje
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
      .insert({ turma_id: turmaId, data: chamadaData })
      .select("id").single();

    if (error) {
      selFeedback.textContent = "Erro ao criar chamada: " + error.message;
      btnIniciar.disabled    = false;
      btnIniciar.textContent = "Iniciar Chamada";
      return;
    }
    chamadaId = novaChamada.id;
  }

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

  await supabase
    .from("chamadas").update({ aberta: false }).eq("id", chamadaId);

  chamadaId   = null;
  ALUNOS      = [];
  turmaNome   = "";
  chamadaData = "";

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
    .insert({ chamada_id: chamadaId, aluno_id: aluno.id });

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

// ─── Navegação entre views ────────────────────────────────────────────────────
function mostrarViewChamada() {
  viewSelector.style.display = "none";
  viewChamada.style.display  = "block";
}

function mostrarViewSeletor() {
  viewChamada.style.display  = "none";
  viewSelector.style.display = "block";
  btnIniciar.disabled = true;

  if (_isProfessor) {
    selTurma.value = "";
  } else {
    selTurma.innerHTML = '<option value="">Selecione a instituição</option>';
    selTurma.disabled  = true;
    selInst.value      = "";
  }
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
