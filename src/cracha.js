import QRCode from "qrcode";

// ── Dimensões do crachá ───────────────────────────────────────────────────────
const CW     = 450;  // largura de cada lado
const CH     = 280;  // altura
const BANNER = 52;   // altura do banner superior
const CR     = 14;   // raio dos cantos

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadImg(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function gradient(ctx, x, w, cor1, cor2) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, cor1);
  g.addColorStop(1, cor2);
  return g;
}

function drawCardBase(ctx, x, y, cor1) {
  // Fundo branco com borda
  ctx.fillStyle = "#ffffff";
  rr(ctx, x, y, CW, CH, CR);
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1.5;
  rr(ctx, x, y, CW, CH, CR);
  ctx.stroke();

  // Barra inferior colorida
  ctx.fillStyle = cor1;
  ctx.save();
  rr(ctx, x, y, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(x, y + CH - 6, CW, 6);
  ctx.restore();
}

function drawBanner(ctx, x, y, cor1, cor2, texto, logoImg) {
  // Gradiente do banner
  ctx.fillStyle = gradient(ctx, x, CW, cor1, cor2);
  ctx.save();
  rr(ctx, x, y, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(x, y, CW, BANNER);
  ctx.restore();

  // Texto do banner (esquerda)
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Trunca o nome da instituição se muito longo
  const maxW = logoImg ? CW - 80 : CW - 24;
  let txt = texto || "Chamada QR";
  while (ctx.measureText(txt).width > maxW && txt.length > 4)
    txt = txt.slice(0, -1);
  if (txt !== (texto || "Chamada QR")) txt += "…";
  ctx.fillText(txt, x + 14, y + BANNER / 2);

  // Logo (direita, se houver)
  if (logoImg) {
    const lh = 32;
    const lw = Math.round(logoImg.width * (lh / logoImg.height));
    ctx.drawImage(logoImg, x + CW - lw - 10, y + (BANNER - lh) / 2, lw, lh);
  }

  ctx.textBaseline = "alphabetic";
}

// ── FRENTE ────────────────────────────────────────────────────────────────────
async function drawFrente(ctx, ox, oy, aluno, cor1, cor2, instNome, fotoImg, logoImg) {
  drawCardBase(ctx, ox, oy, cor1);
  drawBanner(ctx, ox, oy, cor1, cor2, instNome, logoImg);

  // Foto circular — centro: x=ox+115, y=centro vertical abaixo do banner
  const px = ox + 118;
  const py = oy + BANNER + Math.round((CH - BANNER - 10) / 2);
  const pr = 68;

  // Anel externo colorido
  ctx.strokeStyle = cor1;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, pr + 4, 0, Math.PI * 2);
  ctx.stroke();

  // Clip circular para a foto
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.clip();

  if (fotoImg) {
    ctx.drawImage(fotoImg, px - pr, py - pr, pr * 2, pr * 2);
  } else {
    // Fundo + inicial
    ctx.fillStyle = cor1 + "18";
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.fillStyle = cor1;
    ctx.font = `bold ${Math.round(pr * 0.85)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((aluno.nome || "?").charAt(0).toUpperCase(), px, py + 2);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // Coluna de informações (lado direito)
  const tx = ox + 220;
  const fields = [
    { label: "NOME",       value: aluno.nome        || "—", big: true },
    { label: "TURMA",      value: aluno.turma?.nome || aluno.turma_nome || "—" },
    { label: "MATRÍCULA",  value: aluno.matricula   || "—" },
  ];

  let ty = oy + BANNER + 22;
  const rowH = 52;

  fields.forEach((f, i) => {
    const y = ty + i * rowH;

    // Label cinza
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(f.label, tx, y);

    // Valor
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${f.big ? 15 : 12}px Arial, sans-serif`;
    // Trunca se necessário
    let val = f.value;
    const maxValW = CW - (tx - ox) - 14;
    while (ctx.measureText(val).width > maxValW && val.length > 2) val = val.slice(0, -1);
    if (val !== f.value) val += "…";
    ctx.fillText(val, tx, y + (f.big ? 17 : 15));

    // Linha separadora
    if (i < fields.length - 1) {
      ctx.strokeStyle = "#f1f5f9";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, y + (f.big ? 17 : 15) + 12);
      ctx.lineTo(ox + CW - 14, y + (f.big ? 17 : 15) + 12);
      ctx.stroke();
    }
  });
}

// ── VERSO ─────────────────────────────────────────────────────────────────────
function drawVerso(ctx, ox, oy, aluno, cor1, cor2, instNome, qrImg, logoImg) {
  drawCardBase(ctx, ox, oy, cor1);
  drawBanner(ctx, ox, oy, cor2, cor1, "IDENTIFICAÇÃO", logoImg);

  // QR Code centralizado
  const qrS = 150;
  const qrX = ox + Math.round((CW - qrS) / 2);
  const qrY = oy + BANNER + 10;

  if (qrImg) {
    // Fundo branco ao redor do QR
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(qrX - 5, qrY - 5, qrS + 10, qrS + 10);
    ctx.drawImage(qrImg, qrX, qrY, qrS, qrS);
  }

  // Nome da instituição (rodapé)
  ctx.fillStyle = "#64748b";
  ctx.font = "9px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText((instNome || "").toUpperCase(), ox + CW / 2, oy + CH - 26);

  // Matrícula
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText(aluno.matricula || "—", ox + CW / 2, oy + CH - 11);
}

// ── Export principal ──────────────────────────────────────────────────────────
/**
 * Gera o crachá (frente + verso) como PNG base64.
 * @param {object} aluno     - { nome, matricula, foto_url, turma: { nome } }
 * @param {object|null} config - { cor_principal, cor_secundaria, logo_url }
 * @param {string} instNome  - nome da instituição
 * @returns {Promise<string>} data URL PNG
 */
export async function gerarCracha(aluno, config, instNome) {
  const GAP = 24;
  const PAD = 20;

  const canvas = document.createElement("canvas");
  canvas.width  = CW * 2 + GAP + PAD * 2;
  canvas.height = CH + PAD * 2;
  const ctx = canvas.getContext("2d");

  // Fundo cinza claro (área de corte)
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cor1 = config?.cor_principal  || "#2563eb";
  const cor2 = config?.cor_secundaria || "#1e40af";

  // Gera QR com a matrícula do aluno (mesma lógica do app.js)
  const qrDataUrl = await QRCode.toDataURL(aluno.matricula || aluno.id || "—", {
    width: 200, margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });

  // Carrega todas as imagens em paralelo
  const [fotoImg, logoImg, qrImg] = await Promise.all([
    loadImg(aluno.foto_url),
    loadImg(config?.logo_url || null),
    loadImg(qrDataUrl),
  ]);

  // Desenha frente e verso
  await drawFrente(ctx, PAD, PAD, aluno, cor1, cor2, instNome, fotoImg, logoImg);
  drawVerso(ctx, PAD + CW + GAP, PAD, aluno, cor1, cor2, instNome, qrImg, logoImg);

  // Labels "Frente" / "Verso" abaixo de cada card (para impressão)
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Arial, sans-serif";
  ctx.textAlign = "center";

  return canvas.toDataURL("image/png");
}

/** Dispara download do PNG gerado. */
export function downloadCracha(dataUrl, nomeAluno) {
  const a = document.createElement("a");
  a.href = dataUrl;
  const safe = (nomeAluno || "aluno")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
  a.download = `Cracha_${safe}.png`;
  a.click();
}

/** Retorna a config do crachá para uma instituição (usa supabaseAdmin). */
export async function buscarCrachaConfig(supabaseAdmin, instId) {
  const { data } = await supabaseAdmin
    .from("cracha_config")
    .select("cor_principal, cor_secundaria, logo_url")
    .eq("instituicao_id", instId)
    .maybeSingle();
  return data; // null se não configurado ainda (usa defaults)
}
