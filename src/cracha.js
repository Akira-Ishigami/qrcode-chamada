import QRCode from "qrcode";

// ── Dimensões ────────────────────────────────────────────────────────────────
const CW     = 460;
const CH     = 310;
const BANNER = 50;
const CR     = 12;
const ACCENT = 6;   // listra lateral colorida

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

// Ajusta texto para caber em maxW com font/size variável
function fitLine(ctx, text, maxW, maxSz, minSz, font) {
  if (!text) return { text: "—", size: maxSz };
  let sz = maxSz;
  ctx.font = `bold ${sz}px ${font}`;
  while (ctx.measureText(text).width > maxW && sz > minSz) {
    sz--;
    ctx.font = `bold ${sz}px ${font}`;
  }
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -1);
  if (t !== text) t += "…";
  return { text: t, size: sz };
}

// Quebra texto em até 2 linhas
function wrapText(ctx, text, maxW, sz, font) {
  ctx.font = `bold ${sz}px ${font}`;
  if (!text) return ["—"];
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(" ");
  let l1 = "", l2 = "";
  for (const w of words) {
    const t = l1 ? l1 + " " + w : w;
    if (!l2 && ctx.measureText(t).width <= maxW) l1 = t;
    else l2 = l2 ? l2 + " " + w : w;
  }
  while (l2 && ctx.measureText(l2).width > maxW && l2.length > 2) l2 = l2.slice(0, -1);
  if (l2 && !text.endsWith(l2.replace("…", ""))) l2 += "…";
  return l2 ? [l1, l2] : [l1];
}

function fmtNasc(s) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("pt-BR");
}

function truncate(s, ctx, maxW, font, sz) {
  if (!s) return "—";
  ctx.font = `bold ${sz}px ${font}`;
  let t = s;
  while (ctx.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -1);
  if (t !== s) t += "…";
  return t;
}

// ── Base do card ──────────────────────────────────────────────────────────────
function drawBase(ctx, ox, oy, cor1) {
  // Fundo branco
  ctx.fillStyle = "#ffffff";
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.fill();

  // Micro-grid de pontos (muito sutil)
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillStyle = cor1 + "0d";
  for (let dx = 16; dx < CW; dx += 20) {
    for (let dy = BANNER + 8; dy < CH - 12; dy += 20) {
      ctx.beginPath();
      ctx.arc(ox + dx, oy + dy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Listra vertical esquerda (institution color)
  ctx.fillStyle = cor1;
  ctx.fillRect(ox, oy, ACCENT, CH);

  // Borda sutil
  ctx.restore();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.stroke();

  // Barra inferior (cor1)
  ctx.fillStyle = cor1;
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, oy + CH - 5, CW, 5);
  ctx.restore();
}

// ── Banner superior ───────────────────────────────────────────────────────────
function drawBanner(ctx, ox, oy, cor1, cor2, instNome, logoImg, reversed = false) {
  const c1 = reversed ? cor2 : cor1;
  const c2 = reversed ? cor1 : cor2;
  const g = ctx.createLinearGradient(ox, 0, ox + CW, 0);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, oy, CW, BANNER);
  ctx.restore();

  // Institution name
  const maxTxtW = logoImg ? CW - 110 : CW - 32;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 13px Georgia, serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let txt = instNome || "Chamada QR";
  while (ctx.measureText(txt).width > maxTxtW && txt.length > 4) txt = txt.slice(0, -1);
  if (txt !== (instNome || "Chamada QR")) txt += "…";
  ctx.fillText(txt, ox + ACCENT + 14, oy + BANNER / 2);

  // Logo
  if (logoImg) {
    const lh = 32, lw = Math.round(logoImg.width * (lh / logoImg.height));
    ctx.drawImage(logoImg, ox + CW - lw - 12, oy + (BANNER - lh) / 2, lw, lh);
  }
  ctx.textBaseline = "alphabetic";
}

// ── FRENTE ────────────────────────────────────────────────────────────────────
async function drawFrente(ctx, ox, oy, aluno, cor1, cor2, instNome, fotoImg, logoImg) {
  drawBase(ctx, ox, oy, cor1);
  drawBanner(ctx, ox, oy, cor1, cor2, instNome, logoImg);

  // ── Foto ──
  const px = ox + ACCENT + 84;
  const py = oy + BANNER + Math.round((CH - BANNER - 90) / 2) + 16;
  const pr = 58;

  // Anel externo difuso
  ctx.strokeStyle = cor1 + "25";
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(px, py, pr + 12, 0, Math.PI * 2); ctx.stroke();

  // Anel sólido
  ctx.strokeStyle = cor1;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px, py, pr + 4, 0, Math.PI * 2); ctx.stroke();

  // Clip foto
  ctx.save();
  ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
  if (fotoImg) {
    const iw = fotoImg.width, ih = fotoImg.height;
    const size = pr * 2;
    const scale = Math.max(size / iw, size / ih);
    const sw = size / scale, sh = size / scale;
    ctx.drawImage(fotoImg, (iw - sw) / 2, (ih - sh) / 2, sw, sh, px - pr, py - pr, size, size);
  } else {
    ctx.fillStyle = cor1 + "18";
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.fillStyle = cor1;
    ctx.font = `bold ${Math.round(pr * 0.8)}px Georgia, serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((aluno.nome || "?").charAt(0).toUpperCase(), px, py + 2);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // ── Coluna de informações ──
  const tx = ox + ACCENT + 170;
  const infoW = CW - (tx - ox) - 14;
  let cy = oy + BANNER + 16;

  // Separador vertical entre foto e info
  ctx.strokeStyle = cor1 + "20";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx - 10, oy + BANNER + 10);
  ctx.lineTo(tx - 10, oy + CH - 90);
  ctx.stroke();

  const drawField = (label, value, font, sz, color = "#0f172a", isLast = false) => {
    // Label monospace
    ctx.fillStyle = cor1;
    ctx.font = `700 7.5px 'Courier New', monospace`;
    ctx.textAlign = "left";
    ctx.letterSpacing = "0.08em";
    ctx.fillText(label, tx, cy);
    ctx.letterSpacing = "";

    cy += 13;
    ctx.fillStyle = color;
    const lines = wrapText(ctx, value, infoW, sz, font);
    lines.forEach(line => {
      ctx.font = `bold ${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 2;
    });

    if (!isLast) {
      cy += 5;
      ctx.strokeStyle = cor1 + "22";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, cy);
      ctx.lineTo(ox + CW - 12, cy);
      ctx.stroke();
      cy += 8;
    }
  };

  drawField("NOME",      aluno.nome || "—",                          "Georgia, serif",      16, "#0f172a");
  drawField("TURMA",     aluno.turma?.nome || aluno.turma_nome || "—", "Arial, sans-serif", 10, "#1e3a5f");
  drawField("MATRÍCULA", aluno.matricula || "—",                     "'Courier New', monospace", 13, "#0f172a", true);

  // ── Seção inferior com dashed separator ──────────────────────────────────
  const sepY = oy + CH - 82;
  ctx.strokeStyle = cor1 + "40";
  ctx.lineWidth = 1;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(ox + ACCENT + 6, sepY);
  ctx.lineTo(ox + CW - 10, sepY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const extra = [
    { label: "NASC.",       value: fmtNasc(aluno.data_nascimento) },
    { label: "TELEFONE",    value: aluno.telefone || "—" },
    { label: "ID ESTADUAL", value: aluno.id_estadual || "—" },
    { label: "ENDEREÇO",    value: aluno.endereco   || "—" },
  ];

  const colW = (CW - ACCENT - 14) / 2;
  extra.forEach((f, i) => {
    const ex = ox + ACCENT + 8 + (i % 2) * (colW + 4);
    const ey = sepY + 12 + Math.floor(i / 2) * 30;
    const maxW = colW - 8;

    ctx.fillStyle = cor1;
    ctx.font = `700 7px 'Courier New', monospace`;
    ctx.textAlign = "left";
    ctx.fillText(f.label, ex, ey);

    ctx.fillStyle = "#1e293b";
    const val = truncate(f.value, ctx, maxW, "Arial, sans-serif", 9);
    ctx.font = `bold 9px Arial, sans-serif`;
    ctx.fillText(val, ex, ey + 12);
  });
}

// ── VERSO ─────────────────────────────────────────────────────────────────────
function drawVerso(ctx, ox, oy, aluno, cor1, cor2, instNome, qrImg, logoImg) {
  drawBase(ctx, ox, oy, cor1);
  drawBanner(ctx, ox, oy, cor1, cor2, "IDENTIFICAÇÃO", logoImg, true);

  // Faixa lateral cor2 no verso
  ctx.fillStyle = cor2;
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, oy, ACCENT, CH);
  ctx.restore();

  // QR centralizado
  const qrS = 155;
  const qrX = ox + Math.round((CW - qrS) / 2);
  const qrY = oy + BANNER + 12;

  if (qrImg) {
    // Fundo branco com sombra suave
    ctx.shadowColor = "rgba(0,0,0,.1)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(qrX - 7, qrY - 7, qrS + 14, qrS + 14);
    ctx.shadowBlur = 0;
    ctx.drawImage(qrImg, qrX, qrY, qrS, qrS);
  }

  // Linha separadora
  ctx.strokeStyle = cor1 + "25";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + ACCENT + 20, oy + CH - 52);
  ctx.lineTo(ox + CW - 16, oy + CH - 52);
  ctx.stroke();

  // Instituição
  ctx.fillStyle = "#64748b";
  ctx.font = "700 8px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText((instNome || "").toUpperCase(), ox + CW / 2, oy + CH - 36);

  // Matrícula
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.fillText(aluno.matricula || "—", ox + CW / 2, oy + CH - 16);
}

// ── Export principal ──────────────────────────────────────────────────────────
export async function gerarCracha(aluno, config, instNome) {
  const GAP = 28, PAD = 22;

  const canvas = document.createElement("canvas");
  canvas.width  = CW * 2 + GAP + PAD * 2;
  canvas.height = CH + PAD * 2;
  const ctx = canvas.getContext("2d");

  // Fundo neutro
  ctx.fillStyle = "#edf2f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cor1 = config?.cor_principal  || "#2563eb";
  const cor2 = config?.cor_secundaria || "#1e40af";

  const qrDataUrl = await QRCode.toDataURL(aluno.matricula || aluno.id || "—", {
    width: 200, margin: 0,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const [fotoImg, logoImg, qrImg] = await Promise.all([
    loadImg(aluno.foto_url),
    loadImg(config?.logo_url || null),
    loadImg(qrDataUrl),
  ]);

  await drawFrente(ctx, PAD, PAD, aluno, cor1, cor2, instNome, fotoImg, logoImg);
  drawVerso(ctx, PAD + CW + GAP, PAD, aluno, cor1, cor2, instNome, qrImg, logoImg);

  return canvas.toDataURL("image/png");
}

export function downloadCracha(dataUrl, nomeAluno) {
  const a = document.createElement("a");
  a.href = dataUrl;
  const safe = (nomeAluno || "aluno")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
  a.download = `Cracha_${safe}.png`;
  a.click();
}

export async function buscarCrachaConfig(supabaseAdmin, instId) {
  const { data } = await supabaseAdmin
    .from("cracha_config")
    .select("cor_principal, cor_secundaria, logo_url")
    .eq("instituicao_id", instId)
    .maybeSingle();
  return data;
}
