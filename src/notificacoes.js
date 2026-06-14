/**
 * notificacoes.js — Bell no sidebar + Supabase Realtime + Web Push + som AudioContext.
 * Inclua em qualquer página com #notif-bell-slot no sidebar.
 */

import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

// ── Injetar CSS do bell (independente de qual CSS a página carrega) ────────────
(function injetarEstilos() {
  if (document.getElementById("notif-styles")) return;
  const s = document.createElement("style");
  s.id = "notif-styles";
  s.textContent = `
.notif-wrap{position:relative}
.notif-bell-btn{display:flex;align-items:center;gap:10px;width:100%;padding:8px 16px;
  border-radius:8px;border:none;background:none;cursor:pointer;
  color:rgba(255,255,255,.45);font-size:.84rem;font-family:inherit;
  transition:background .12s,color .12s;text-align:left}
.notif-bell-btn:hover{background:rgba(255,255,255,.06);color:rgba(255,255,255,.85)}
.notif-bell-icon{position:relative;flex-shrink:0}
.notif-badge{position:absolute;top:-5px;right:-6px;min-width:16px;height:16px;
  border-radius:8px;background:#ef4444;color:#fff;font-size:.55rem;font-weight:800;
  display:none;align-items:center;justify-content:center;padding:0 3px;
  border:2px solid var(--sidebar-bg,#1a2035)}
@keyframes notifBadgePop{from{transform:scale(.5)}to{transform:scale(1)}}
.notif-badge.visible{display:flex;animation:notifBadgePop .2s cubic-bezier(.22,1,.36,1)}
.notif-dropdown{background:#fff;border:1px solid #e5e7eb;border-radius:14px;
  box-shadow:0 16px 48px rgba(0,0,0,.22);overflow:hidden;max-height:360px;
  overflow-y:auto;display:none;min-width:280px}
.notif-dropdown.open{display:block;animation:notifSlideUp .18s cubic-bezier(.22,1,.36,1)}
@keyframes notifSlideUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.notif-dd-header{padding:11px 16px;border-bottom:1px solid #e5e7eb;font-size:.68rem;
  font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;
  display:flex;justify-content:space-between;align-items:center;
  position:sticky;top:0;background:#fff;z-index:1}
.notif-clear-btn{font-size:.72rem;color:#2563eb;cursor:pointer;font-weight:700;
  background:none;border:none;padding:0;font-family:inherit;transition:opacity .12s}
.notif-clear-btn:hover{opacity:.75}
.notif-item{padding:11px 16px;border-bottom:1px solid #f3f4f6;cursor:pointer;transition:background .1s}
.notif-item:last-child{border-bottom:none}
.notif-item:hover{background:#f9fafb}
.notif-item.unread{background:#eff6ff}
.notif-item-title{font-size:.83rem;font-weight:700;color:#111827}
.notif-item-meta{font-size:.72rem;color:#6b7280;margin-top:3px}
.notif-empty-dd{padding:30px 14px;text-align:center;font-size:.83rem;color:#9ca3af}
`;
  document.head.appendChild(s);
})();

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

let _userId   = null;
let _instId   = null;
let _role     = null;
let _notifs   = [];
let _channel  = null;
let _audioCtx = null;

// ── Desbloquear AudioContext no primeiro toque (obrigatório no iOS/Android) ───
function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

["click", "touchstart", "keydown"].forEach(ev =>
  document.addEventListener(ev, () => _getAudioCtx(), { once: false, passive: true })
);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function initNotificacoes() {
  const slot = document.getElementById("notif-bell-slot");
  if (!slot) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();
    if (!profile) return;

    _userId = session.user.id;
    _instId = profile.instituicao_id;
    _role   = profile.role;

    if (_role !== "professor") return;

    renderBell(slot);
    await carregarNotificacoes();
    atualizarBadge();
    iniciarRealtime();

    if ("serviceWorker" in navigator && "PushManager" in window && VAPID_PUBLIC_KEY) {
      registrarPush();
    }
  } catch (e) {
    console.warn("Notificações init error:", e);
  }
}

// ── Render bell ───────────────────────────────────────────────────────────────
function renderBell(slot) {
  slot.innerHTML = `
    <div class="notif-wrap">
      <button class="notif-bell-btn" id="notif-bell-btn" title="Notificações">
        <div class="notif-bell-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-badge" id="notif-badge"></span>
        </div>
        Notificações
      </button>
    </div>
  `;

  // Portal: dropdown vive no body para escapar overflow-x:hidden do sidebar
  let dropdown = document.getElementById("notif-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "notif-dropdown";
    dropdown.id = "notif-dropdown";
    dropdown.innerHTML = `
      <div class="notif-dd-header">
        Notificações
        <button class="notif-clear-btn" id="notif-clear-btn">Marcar todas como lidas</button>
      </div>
      <div id="notif-list"></div>
    `;
    document.body.appendChild(dropdown);
  }

  const btn = document.getElementById("notif-bell-btn");

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle("open");
    if (isOpen) {
      _posicionarDropdown(btn, dropdown);
      renderNotifList();
    }
  });

  document.getElementById("notif-clear-btn").addEventListener("click", async e => {
    e.stopPropagation();
    await marcarTodasLidas();
  });

  document.addEventListener("click", () => dropdown.classList.remove("open"));
}

function _posicionarDropdown(btn, dropdown) {
  const btnRect     = btn.getBoundingClientRect();
  const sidebar     = document.querySelector(".sidebar");
  const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : { right: 268 };
  const isMobile    = window.innerWidth <= 768;

  dropdown.style.position = "fixed";
  dropdown.style.zIndex   = "9999";

  if (isMobile) {
    // Abre acima do botão, dentro da área visível
    dropdown.style.left   = "8px";
    dropdown.style.right  = "8px";
    dropdown.style.width  = "auto";
    dropdown.style.bottom = (window.innerHeight - btnRect.top + 8) + "px";
    dropdown.style.top    = "auto";
  } else {
    // Abre à direita do sidebar
    const ddWidth = 300;
    dropdown.style.left   = (sidebarRect.right + 8) + "px";
    dropdown.style.width  = ddWidth + "px";
    dropdown.style.right  = "auto";
    // Alinha verticalmente com o botão
    const desiredBottom = window.innerHeight - btnRect.bottom + btnRect.height / 2;
    dropdown.style.bottom = Math.max(8, desiredBottom) + "px";
    dropdown.style.top    = "auto";
  }
}

// ── Realtime ─────────────────────────────────────────────────────────────────
function iniciarRealtime() {
  if (_channel) supabase.removeChannel(_channel);

  _channel = supabase
    .channel(`notif-${_userId}`)
    .on(
      "postgres_changes",
      {
        event:  "INSERT",
        schema: "public",
        table:  "notificacoes",
        filter: `usuario_id=eq.${_userId}`,
      },
      async (payload) => {
        playNotifSound();
        await carregarNotificacoes();
        atualizarBadge();
        // re-render dropdown se aberto
        const dd = document.getElementById("notif-dropdown");
        if (dd?.classList.contains("open")) renderNotifList();
      }
    )
    .subscribe();
}

// ── Som de notificação — dois tons "iim" estilo WhatsApp ─────────────────────
function playNotifSound() {
  try {
    const ctx = _getAudioCtx();

    const play = () => {
      function tom(freq, t0, dur, vol) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.start(t0);
        osc.stop(t0 + dur);
      }
      // "iim": tom grave curto → tom agudo mais longo
      tom(830,  ctx.currentTime,        0.14, 0.14);
      tom(1220, ctx.currentTime + 0.09, 0.22, 0.11);
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch (e) {
    // AudioContext pode falhar sem interação prévia — silencioso
  }
}

// ── Carregar notificações ─────────────────────────────────────────────────────
async function carregarNotificacoes() {
  const { data, error } = await supabaseAdmin
    .from("notificacoes")
    .select("id, lida, created_at, eventos_calendario(titulo, data_inicio, tipo)")
    .eq("usuario_id", _userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) { console.warn("Notificações load error:", error); return; }
  _notifs = data ?? [];
}

function atualizarBadge() {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  const n = _notifs.filter(x => !x.lida).length;
  badge.textContent = n > 9 ? "9+" : n;
  badge.classList.toggle("visible", n > 0);
}

// ── Render lista no dropdown ──────────────────────────────────────────────────
function renderNotifList() {
  const list = document.getElementById("notif-list");
  if (!list) return;

  if (_notifs.length === 0) {
    list.innerHTML = `<div class="notif-empty-dd">Nenhuma notificação</div>`;
    return;
  }

  const MS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const TL = { feriado:"Feriado", prova:"Prova", reuniao:"Reunião", recesso:"Recesso", evento:"Evento" };
  const TE = { feriado:"🚩", prova:"🎓", reuniao:"📋", recesso:"🏖️", evento:"📅" };

  list.innerHTML = _notifs.map(n => {
    const ev = n.eventos_calendario;
    if (!ev) return "";
    const d   = new Date(ev.data_inicio + "T00:00:00");
    const tipo = TL[ev.tipo] ?? ev.tipo;
    const emoji = TE[ev.tipo] ?? "📅";
    return `
      <div class="notif-item${n.lida ? "" : " unread"}" data-notif-id="${n.id}">
        <div class="notif-item-title">${emoji} ${ev.titulo}</div>
        <div class="notif-item-meta">${tipo} · ${d.getDate()} ${MS[d.getMonth()]} · <a href="/calendario.html" style="color:var(--acc);font-weight:600;">Ver calendário →</a></div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", () => marcarLida(el.dataset.notifId));
  });
}

async function marcarLida(notifId) {
  const notif = _notifs.find(n => n.id === notifId);
  if (!notif || notif.lida) return;
  notif.lida = true;
  atualizarBadge();
  renderNotifList();
  await supabaseAdmin.from("notificacoes").update({ lida: true }).eq("id", notifId);
}

async function marcarTodasLidas() {
  _notifs.forEach(n => n.lida = true);
  atualizarBadge();
  renderNotifList();
  await supabaseAdmin.from("notificacoes").update({ lida: true })
    .eq("usuario_id", _userId).eq("lida", false);
}

// ── Web Push ──────────────────────────────────────────────────────────────────
async function registrarPush() {
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const j = sub.toJSON();
    await supabaseAdmin.from("push_subscriptions").upsert(
      { usuario_id: _userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "usuario_id,endpoint" }
    );
  } catch (e) {
    console.warn("Push registration failed:", e);
  }
}

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

initNotificacoes();
