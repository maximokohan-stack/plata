'use strict';
/* Plata — control de gastos, deudas y plata prestada. Local-first: todo vive en el dispositivo. */

// ---------- versión y actualizaciones ----------
// La versión sale del nombre de la caché del service worker (plata-vN), así no se duplica en dos lugares.
async function showVersion() {
  const el = $('#app-ver'); if (!el) return;
  try {
    const n = (await caches.keys()).filter(k => k.startsWith('plata-v')).map(k => +k.slice(7)).filter(Boolean).sort((a, b) => b - a)[0];
    el.textContent = n ? 'Versión ' + n : 'Versión sin instalar';
  } catch { el.textContent = ''; }
}
if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#update').hidden = false; hadController = true; });
}

// ---------- instalación (Android / Chrome) ----------
let installEv = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; });
addEventListener('appinstalled', () => { installEv = null; });

// ---------- tema (claro / oscuro) ----------
// Mientras la persona no elija, se sigue el tema del teléfono; al elegir, queda fijo.
const THEME_BG = { light: '#f4f0e6', dark: '#15140f' };
const storedTheme = () => { try { const t = localStorage.getItem('plata.theme'); return t === 'light' || t === 'dark' ? t : null; } catch { return null; } };
const getTheme = () => storedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme(t) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  // "only light" es la forma oficial de prohibir que Android/Chrome oscurezcan la página por su cuenta (daría marrones)
  const cs = t === 'light' ? 'only light' : 'dark';
  root.style.colorScheme = cs;
  const meta = document.querySelector('meta[name=color-scheme]'); if (meta) meta.content = cs;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.dataset.orig ||= m.content; m.content = THEME_BG[t]; });
}
if (storedTheme()) applyTheme(storedTheme());

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
const parseAmount = v => {
  let s = String(v ?? '').trim().replace(/\s|\$/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s);
};
const monthLabel = m => { const s = new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' '); return s[0].toUpperCase() + s.slice(1); };
const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(y, mo - 1 + d, 1); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); };
const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

const CATS = {
  gasto: [['Comida', '🍽️'], ['Transporte', '🚌'], ['Hogar', '🏠'], ['Salud', '💊'], ['Ocio', '🎬'], ['Compras', '🛍️'], ['Servicios', '💡'], ['Educación', '📚'], ['Deudas', '💳'], ['Otros', '•']],
  ingreso: [['Sueldo', '💼'], ['Freelance', '🧾'], ['Otros ingresos', '＋']]
};
const catIcon = c => ([...CATS.gasto, ...CATS.ingreso].find(x => x[0] === c) || [0, '•'])[1];
const stamp = s => esc(String(s || '•').trim()[0]?.toUpperCase() || '•');
const METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];

// ---------- estado + persistencia (IndexedDB con respaldo a localStorage) ----------
let S = { tx: [], debts: [], loans: [], groups: [] };
const DB = 'plata', KEY = 'state';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function load() {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (v) S = { ...S, ...v };
  } catch { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S = { ...S, ...v }; } catch { } }
}
async function save() {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(JSON.stringify(S)), KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }
}
const commit = () => { save(); render(); };

// ---------- cálculos ----------
const loanPaid = l => sum(l.payments || [], p => p.amount);
const loanLeft = l => Math.max(0, l.amount - loanPaid(l));
const debtLeft = d => Math.max(0, (d.cuotas - d.cuotasPagas) * d.cuota);
const daysUntil = day => {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  let t = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  if (t < new Date(y, m, n.getDate())) t = new Date(y, m + 1, Math.min(day, new Date(y, m + 2, 0).getDate()));
  return Math.round((t - new Date(y, m, n.getDate())) / 864e5);
};
function peopleList() {
  const map = {};
  for (const l of S.loans) {
    const k = l.person.trim().toLowerCase(); const left = loanLeft(l);
    const p = map[k] ||= { key: k, name: l.person.trim(), net: 0, phone: '' };
    p.net += (l.dir === 'me-deben' ? 1 : -1) * left;
    if (l.phone) p.phone = l.phone;
  }
  return Object.values(map).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
// lo que le toca a cada uno de un gasto: partes iguales, o producto por producto si trae `items`
function expenseShares(e) {
  const out = {}, add = (n, v) => out[n] = (out[n] || 0) + v;
  if (e.items?.length) e.items.forEach(it => { if (it.split?.length) it.split.forEach(n => add(n, it.amount / it.split.length)); });
  else e.split.forEach(n => add(n, e.amount / e.split.length));
  return out;
}
function groupBalances(g) {
  const bal = Object.fromEntries(g.members.map(m => [m, 0]));
  for (const e of g.expenses) {
    bal[e.paidBy] = (bal[e.paidBy] || 0) + e.amount;
    for (const [m, v] of Object.entries(expenseShares(e))) bal[m] = (bal[m] || 0) - v;
  }
  return bal;
}
// consumo y aporte de cada integrante
function groupConsumption(g) {
  const c = Object.fromEntries(g.members.map(m => [m, { consumed: 0, paid: 0 }]));
  for (const e of g.expenses) {
    (c[e.paidBy] ||= { consumed: 0, paid: 0 }).paid += e.amount;
    for (const [m, v] of Object.entries(expenseShares(e))) (c[m] ||= { consumed: 0, paid: 0 }).consumed += v;
  }
  return c;
}
function settle(bal) {
  const c = [], d = [];
  for (const [n, v] of Object.entries(bal)) { if (v > 0.005) c.push([n, v]); else if (v < -0.005) d.push([n, -v]); }
  c.sort((a, b) => b[1] - a[1]); d.sort((a, b) => b[1] - a[1]);
  const out = []; let i = 0, j = 0;
  while (i < c.length && j < d.length) {
    const x = Math.min(c[i][1], d[j][1]);
    out.push({ from: d[j][0], to: c[i][0], amount: x });
    c[i][1] -= x; d[j][1] -= x;
    if (c[i][1] < 0.005) i++; if (d[j][1] < 0.005) j++;
  }
  return out;
}

// ---------- vistas ----------
let view = 'home', month = today().slice(0, 7), openGroup = null;
const TITLES = { home: 'Inicio', mov: 'Movimientos', split: 'Dividir', groups: 'Grupos', debts: 'Deudas y cobros' };
let debtsTab = 'people';   // 'people' (me deben / debo) | 'cards' (tarjetas, cuotas, préstamos)

const empty = (t, s) => `<div class="empty"><b>${t}</b>${s}</div>`;

function vHome() {
  const tx = S.tx.filter(t => t.date.startsWith(month));
  const inc = sum(tx.filter(t => t.type === 'ingreso'), t => t.amount);
  const exp = sum(tx.filter(t => t.type === 'gasto'), t => t.amount);
  const owedMe = sum(S.loans.filter(l => l.dir === 'me-deben'), loanLeft);
  const iOwe = sum(S.loans.filter(l => l.dir === 'debo'), loanLeft) + sum(S.debts, debtLeft);
  const byCat = {};
  tx.filter(t => t.type === 'gasto').forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const byMethod = {};
  tx.filter(t => t.type === 'gasto' && t.method).forEach(t => byMethod[t.method] = (byMethod[t.method] || 0) + t.amount);
  const methods = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  const due = S.debts.filter(d => d.cuotasPagas < d.cuotas && d.dueDay).map(d => ({ d, n: daysUntil(d.dueDay) })).filter(x => x.n <= 10).sort((a, b) => a.n - b.n);
  const net = owedMe - iOwe;
  return `
  ${monthNav()}
  <div class="card hero">
    <div class="label">Balance del mes</div>
    <div class="big ${inc - exp < 0 ? 'neg' : ''}">${money(inc - exp)}</div>
    <div class="split"><div><span class="label">Ingresos</span><b class="pos">${money(inc)}</b></div><div><span class="label">Gastos</span><b class="neg">${money(exp)}</b></div></div>
  </div>
  <div class="grid2">
    <button class="card" data-act="tab" data-v="debts" data-sub="people" style="text-align:left"><div class="label">Me deben</div><div class="stat pos">${money(owedMe)}</div></button>
    <button class="card" data-act="tab" data-v="debts" data-sub="cards" style="text-align:left"><div class="label">Debo</div><div class="stat neg">${money(iOwe)}</div></button>
  </div>
  <div class="card"><div class="row"><span class="label">Posición neta</span><b class="${net < 0 ? 'neg' : 'pos'}">${money(net)}</b></div>
    <div class="muted" style="font-size:13px;margin-top:4px">Lo que te deben menos lo que debés (deudas + personas).</div></div>
  ${due.length ? `<h3>Vencimientos cercanos</h3><div class="list">${due.map(({ d, n }) => `
    <button class="item" data-act="debt" data-id="${d.id}"><div class="dot">${stamp(d.name)}</div><div class="grow"><div class="t">${esc(d.name)}</div>
    <div class="s ${n <= 3 ? 'warn' : ''}">${n === 0 ? 'Vence hoy' : n === 1 ? 'Vence mañana' : 'Vence en ' + n + ' días'}</div></div><div class="amt neg">${money(d.cuota)}</div></button>`).join('')}</div>` : ''}
  <h3>Gastos por categoría</h3>
  <div class="card">${cats.length ? cats.map(([c, v]) => `<div class="catrow"><div class="row"><span>${esc(c)}</span><b>${money(v)}</b></div><div class="bar"><i style="width:${Math.round(v / exp * 100)}%"></i></div></div>`).join('')
      : '<div class="muted">Sin gastos este mes todavía.</div>'}</div>
  ${methods.length ? `<h3>Con qué pagaste</h3><div class="card">${methods.map(([m, v]) => `<div class="catrow"><div class="row"><span>${esc(m)}</span><b>${money(v)}</b></div><div class="bar"><i style="width:${Math.round(v / exp * 100)}%"></i></div></div>`).join('')}</div>` : ''}
  <h3>Últimos movimientos</h3>${txList(S.tx.slice().sort(byDate).slice(0, 5), true)}
  ${S.tx.length > 5 ? `<div class="btns" style="margin-top:0"><button class="btn ghost sm" data-act="tab" data-v="mov">Ver todos los movimientos (${S.tx.length}) ›</button></div>` : S.tx.length ? `<div class="btns" style="margin-top:0"><button class="btn ghost sm" data-act="tab" data-v="mov">Ver por mes ›</button></div>` : ''}`;
}
const byDate = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
const monthNav = () => `<div class="month"><button data-act="mprev" aria-label="Mes anterior">‹</button><b>${monthLabel(month)}</b><button data-act="mnext" aria-label="Mes siguiente">›</button></div>`;
const txList = (arr, compact) => !arr.length ? `<div class="list">${empty('Todavía no hay movimientos', 'Tocá + para cargar el primero.')}</div>` : `<div class="list">${arr.map(t => `
  <button class="item" data-act="tx" data-id="${t.id}"><div class="dot">${stamp(t.cat)}</div>
  <div class="grow"><div class="t">${esc(t.note || t.cat)}</div><div class="s">${esc(t.cat)}${t.method ? ' · ' + esc(t.method) : ''} · ${dayLabel(t.date)}</div></div>
  <div class="amt ${t.type === 'ingreso' ? 'pos' : 'neg'}">${t.type === 'ingreso' ? '+' : '−'}${money(t.amount)}</div></button>`).join('')}</div>`;

function vMov() {
  const tx = S.tx.filter(t => t.date.startsWith(month)).sort(byDate);
  return `<button class="back" data-act="tab" data-v="home">‹ Inicio</button>` + monthNav() + txList(tx)
    + `<div class="btns" style="margin-top:0"><button class="btn ghost sm ai-only" data-act="importmov">Importar desde captura o resumen</button></div>`;
}

// Deudas y cobros: una sola sección con dos vistas (personas / tarjetas y cuotas)
function vDeudas() {
  const seg = `<div class="seg" style="margin-bottom:14px">${[['people', 'Personas'], ['cards', 'Tarjetas y cuotas']].map(([v, n]) => `<label><input type="radio" name="dsub" value="${v}" ${debtsTab === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>`;
  const add = debtsTab === 'people' ? ['newloan', '+ Préstamo o deuda con alguien'] : ['newdebt', '+ Nueva deuda o cuota'];
  return seg + (debtsTab === 'people' ? vPeople() : vDebts()) + `<div class="btns"><button class="btn" data-act="${add[0]}">${add[1]}</button></div>`;
}

function vDebts() {
  if (!S.debts.length) return `<div class="list">${empty('Sin deudas cargadas', 'Tarjeta, cuotas, préstamos: cargalos con el botón de abajo y seguí cuánto falta.')}</div>`;
  const tot = sum(S.debts, debtLeft);
  return `<div class="card"><div class="label">Total pendiente</div><div class="big neg">${money(tot)}</div>
    <div class="muted">Cuotas del mes: <b>${money(sum(S.debts.filter(d => d.cuotasPagas < d.cuotas), d => d.cuota))}</b></div></div>
  <div class="list">${S.debts.map(d => {
    const pct = Math.round(d.cuotasPagas / d.cuotas * 100), fin = d.cuotasPagas >= d.cuotas;
    return `<button class="item" data-act="debt" data-id="${d.id}" style="display:block"><div class="row"><div class="t">${esc(d.name)}</div><div class="amt ${fin ? '' : 'neg'}">${fin ? '<span class="pill pos">Pagada</span>' : money(debtLeft(d))}</div></div>
      <div class="s">${d.cuotasPagas}/${d.cuotas} cuotas de ${money(d.cuota)}${d.dueDay && !fin ? ' · vence el ' + d.dueDay : ''}</div><div class="bar"><i style="width:${pct}%"></i></div></button>`;
  }).join('')}</div>`;
}

function vPeople() {
  const ppl = peopleList();
  if (!ppl.length) return `<div class="list">${empty('Nadie te debe (ni le debés a nadie)', 'Prestaste plata o te prestaron: cargalo con el botón de abajo y mandá recordatorios por WhatsApp.')}</div>`;
  const row = p => `<button class="item" data-act="person" data-k="${esc(p.key)}"><div class="dot">${esc(p.name[0].toUpperCase())}</div>
    <div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${p.net > 0 ? 'te debe' : p.net < 0 ? 'le debés' : 'en paz'}</div></div>
    <div class="amt ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : 'muted'}">${money(Math.abs(p.net))}</div></button>`;
  const a = ppl.filter(p => p.net > 0), b = ppl.filter(p => p.net < 0), c = ppl.filter(p => p.net === 0);
  return (a.length ? `<h3>Te deben · ${money(sum(a, p => p.net))}</h3><div class="list">${a.map(row).join('')}</div>` : '')
    + (b.length ? `<h3>Les debés · ${money(-sum(b, p => p.net))}</h3><div class="list">${b.map(row).join('')}</div>` : '')
    + (c.length ? `<h3>Saldados</h3><div class="list">${c.map(row).join('')}</div>` : '');
}

// Dividir: calculadoras para una cuenta puntual
function vSplit() {
  return `<p class="muted" style="margin:0 0 14px">Para una cuenta puntual. Si es algo que se va acumulando (un viaje, el depto), usá <button class="link" data-act="tab" data-v="groups">Grupos</button>.</p>
  <div class="grid2 tiles">${[
    ['eq', 'Partes iguales', 'Con propina y redondeo'], ['who', 'Quién puso cuánto', 'Cada uno puso distinto'],
    ['fair', 'Por consumo', 'Cada uno paga lo suyo'], ['inc', 'Según ingresos', 'Proporcional al sueldo']
  ].map(([m, t, d]) => `<button class="card" data-act="calcmode" data-m="${m}"><b class="tile-t">${t}</b><span class="muted">${d}</span></button>`).join('')}</div>`;
}

function vGroups() {
  if (openGroup) {
    const g = S.groups.find(x => x.id === openGroup);
    if (!g) { openGroup = null; return vGroups(); }
    const bal = groupBalances(g), st = settle(bal), cons = groupConsumption(g), total = sum(g.expenses, e => e.amount);
    return `<button class="back" data-act="gback">‹ Grupos</button>
    <div class="card hero"><div class="label">${esc(g.name)}</div><div class="big">${money(total)}</div><div class="muted">${g.members.map(esc).join(', ')}</div></div>
    <div class="btns" style="margin:0 0 4px"><button class="btn" data-act="newitems">Compra por producto</button><button class="btn ghost" data-act="newgexp">+ Gasto simple</button></div>
    <h3>Cómo saldar</h3><div class="list">${st.length ? st.map(s => `<div class="item"><div class="grow"><b>${esc(s.from)}</b> le paga a <b>${esc(s.to)}</b></div><div class="amt">${money(s.amount)}</div></div>`).join('') : `<div class="item muted">Todo saldado 🎉</div>`}</div>
    ${g.expenses.length ? `<h3>Quién consumió qué</h3><div class="list">${g.members.map(m => { const c = cons[m] || { consumed: 0, paid: 0 }, b = bal[m] || 0; return `<div class="item"><div class="grow"><b>${esc(m)}</b><div class="s">consumió ${money(c.consumed)} · puso ${money(c.paid)}</div></div><div class="amt ${b > 0.005 ? 'pos' : b < -0.005 ? 'neg' : 'muted'}">${b > 0.005 ? '+' : b < -0.005 ? '−' : ''}${money(Math.abs(b))}</div></div>`; }).join('')}</div>` : ''}
    <h3>Gastos</h3>${g.expenses.length ? `<div class="list">${g.expenses.slice().sort(byDate).map(e => `<button class="item" data-act="gexp" data-id="${e.id}"><div class="grow"><div class="t">${esc(e.desc)}</div><div class="s">Pagó ${esc(e.paidBy)} · ${dayLabel(e.date)} · ${e.items?.length ? e.items.length + (e.items.length === 1 ? ' producto' : ' productos') : e.split.length === g.members.length ? 'todos' : e.split.map(esc).join(', ')}</div></div><div class="amt">${money(e.amount)}</div></button>`).join('')}</div>` : `<div class="list">${empty('Sin gastos', 'Sumá el primero con el botón de arriba.')}</div>`}
    <div class="btns"><button class="btn danger sm" data-act="gdel">Eliminar grupo</button></div>`;
  }
  const newGroup = `<div class="btns"><button class="btn" data-act="newgroup">+ Nuevo grupo</button></div>`;
  if (!S.groups.length) return `<div class="list">${empty('Sin grupos', 'Armá uno para un viaje, el depto o una salida larga y llevá la cuenta entre todos.')}</div>` + newGroup;
  return `<div class="list">${S.groups.map(g => `<button class="item" data-act="group" data-id="${g.id}"><div class="dot">${stamp(g.name)}</div><div class="grow"><div class="t">${esc(g.name)}</div><div class="s">${g.members.length} personas · ${g.expenses.length} ${g.expenses.length === 1 ? 'gasto' : 'gastos'}</div></div><div class="amt">${money(sum(g.expenses, e => e.amount))}</div></button>`).join('')}</div>` + newGroup;
}

function render() {
  $('#title').textContent = openGroup && view === 'groups' ? 'Grupo' : TITLES[view];
  $('#sub').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#main').innerHTML = { home: vHome, mov: vMov, split: vSplit, groups: vGroups, debts: vDeudas }[view]();
  const tabOn = view === 'mov' ? 'home' : view;   // "Movimientos" cuelga de Inicio
  document.querySelectorAll('#tabs button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === tabOn));
  syncHistory();
}

// ---------- hoja modal ----------
function sheet(title, html) { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; $('#overlay').hidden = false; $('#sheet-body').closest('.sheet').scrollTop = 0; syncHistory(); }
function closeSheet() { $('#overlay').hidden = true; $('#sheet-body').innerHTML = ''; syncHistory(); }

// ---------- botón / gesto "atrás" de Android ----------
// Cada capa abierta (sección ≠ Inicio, detalle de grupo, chat, ventana) suma una entrada al historial,
// así "atrás" cierra la capa de arriba en vez de sacar al usuario de la app. Desde Inicio, "atrás" sale.
let histDepth = 0, ignorePops = 0, syncT = 0;
const uiDepth = () => (view !== 'home' ? 1 : 0) + (openGroup && view === 'groups' ? 1 : 0) + ($('#overlay').hidden ? 0 : 1) + ($('#chat').hidden ? 0 : 1);
function syncHistory() {
  clearTimeout(syncT);
  syncT = setTimeout(() => {                         // diferido: si se cierra y reabre algo en el mismo instante, no hay cambio
    const d = uiDepth();
    if (d > histDepth) while (histDepth < d) history.pushState({ plata: ++histDepth }, '');
    else if (d < histDepth) { const n = histDepth - d; histDepth = d; ignorePops++; history.go(-n); }
  }, 0);
}
addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  histDepth = Math.max(0, histDepth - 1);            // el usuario volvió una entrada
  if (!$('#overlay').hidden) closeSheet();
  else if (!$('#chat').hidden) $('#chat').hidden = true;
  else if (openGroup && view === 'groups') { openGroup = null; render(); }
  else if (view !== 'home') { view = 'home'; render(); }
  syncHistory();
});
try { history.scrollRestoration = 'manual'; } catch { }
// devuelve false para que `return toast('...')` en un formulario cuente como "no se guardó"
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); return false; }
const field = (label, input) => `<label>${label}${input}</label>`;
// categorías: las de fábrica + las que el usuario fue creando al escribirlas
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const allCats = type => [...CATS[type].map(c => c[0]), ...((S.customCats || {})[type] || [])];
const findCat = (type, name) => allCats(type).find(c => norm(c) === norm(name));
// devuelve la categoría existente o crea una nueva con el nombre dado
function ensureCat(type, raw) {
  raw = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!raw) return type === 'gasto' ? 'Otros' : 'Otros ingresos';
  let cat = findCat(type, raw);
  if (!cat) { cat = raw[0].toUpperCase() + raw.slice(1); ((S.customCats ||= { gasto: [], ingreso: [] })[type] ||= []).push(cat); }
  return cat;
}
function comboRender(input, showAll) {
  const ty = input.form.type.value, q = norm(input.value), cats = allCats(ty), exact = cats.some(c => norm(c) === q);
  const shown = showAll || exact || !q ? cats : cats.filter(c => norm(c).includes(q)).sort((a, b) => (norm(b).startsWith(q) - norm(a).startsWith(q)));
  const raw = input.value.trim(), list = input.parentElement.querySelector('.combo-list');
  list.innerHTML = shown.map(c => `<button type="button" class="combo-opt" data-act="combopick" data-v="${esc(c)}">${esc(c)}</button>`).join('')
    + (q && !exact ? `<button type="button" class="combo-opt new" data-act="combopick" data-v="${esc(raw)}">+ Crear “${esc(raw)}”</button>` : '');
  list.hidden = !list.innerHTML;
}

function formTx(t, presetType) {
  const type = t?.type || presetType || 'gasto';
  sheet(t ? 'Editar movimiento' : 'Nuevo movimiento', `<form data-form="tx" data-id="${t?.id || ''}">
    ${t ? '' : `<button type="button" class="link ai-only" data-act="importmov" style="justify-self:start;text-align:left">¿Se te olvidaron varios? Importalos desde una captura o resumen</button>`}
    <div class="seg"><label><input type="radio" name="type" value="gasto" ${type === 'gasto' ? 'checked' : ''}><span>Gasto</span></label><label><input type="radio" name="type" value="ingreso" ${type === 'ingreso' ? 'checked' : ''}><span>Ingreso</span></label></div>
    ${field('Monto', `<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" value="${t ? t.amount : ''}" required autofocus>`)}
    <label>Categoría<div class="combo"><input type="text" name="cat" autocomplete="off" maxlength="30" placeholder="Elegí o escribí una nueva" role="combobox" aria-expanded="false" required>
      <button type="button" class="combo-btn" data-act="combotoggle" aria-label="Ver categorías">▾</button><div class="combo-list" hidden></div></div></label>
    <label><span id="method-label">${type === 'gasto' ? 'Pagué con' : 'Me ingresó por'}</span><select name="method">${METHODS.map(m => `<option ${m === (t?.method || S.lastMethod || 'Efectivo') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    ${field('Nota (opcional)', `<input type="text" name="note" value="${esc(t?.note || '')}" placeholder="Ej: súper, nafta…">`)}
    ${field('Fecha', `<input type="date" name="date" value="${t?.date || today()}" required>`)}
    <button class="btn block">Guardar</button>
    ${t ? `<button type="button" class="btn danger block" data-act="txdel" data-id="${t.id}">Eliminar</button>` : ''}
  </form>`);
  const f = $('form[data-form=tx]');
  const fill = () => { const ty = f.type.value; f.cat.value = t && t.type === ty ? t.cat : allCats(ty)[0]; f.querySelector('.combo-list').hidden = true; $('#method-label').textContent = ty === 'gasto' ? 'Pagué con' : 'Me ingresó por'; };
  f.querySelectorAll('[name=type]').forEach(r => r.onchange = fill); fill();
}
function formDebt(d) {
  sheet(d ? 'Editar deuda' : 'Nueva deuda', `<form data-form="debt" data-id="${d?.id || ''}">
    ${field('Nombre', `<input type="text" name="name" value="${esc(d?.name || '')}" placeholder="Ej: Visa, préstamo auto" required autofocus>`)}
    ${field('Monto total', `<input class="money" name="total" type="text" inputmode="decimal" value="${d ? d.cuota * d.cuotas : ''}" required>`)}
    <div class="grid2" style="margin:0">${field('Cuotas', `<input type="number" name="cuotas" min="1" value="${d?.cuotas || 1}" required>`)}
    ${field('Ya pagadas', `<input type="number" name="paid" min="0" value="${d?.cuotasPagas || 0}">`)}</div>
    ${field('Día de vencimiento (opcional)', `<input type="number" name="dueDay" min="1" max="31" value="${d?.dueDay || ''}" placeholder="1–31">`)}
    <button class="btn block">Guardar</button></form>`);
}
function formLoan(dir = 'me-deben') {
  sheet('Plata con personas', `<form data-form="loan">
    <div class="seg"><label><input type="radio" name="dir" value="me-deben" ${dir === 'me-deben' ? 'checked' : ''}><span>Me debe</span></label><label><input type="radio" name="dir" value="debo" ${dir === 'debo' ? 'checked' : ''}><span>Le debo</span></label></div>
    ${field('Persona', `<input type="text" name="person" list="ppl" required autofocus placeholder="Nombre">`)}<datalist id="ppl">${peopleList().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    ${field('Monto', `<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" required>`)}
    ${field('Concepto (opcional)', `<input type="text" name="concept" placeholder="Ej: entradas, cena">`)}
    ${field('WhatsApp (opcional, con código de país)', `<input type="tel" name="phone" placeholder="5491122334455">`)}
    ${field('Fecha', `<input type="date" name="date" value="${today()}">`)}
    <button class="btn block">Guardar</button></form>`);
}
function formGroup() {
  sheet('Nuevo grupo', `<form data-form="group">
    ${field('Nombre', `<input type="text" name="name" placeholder="Ej: Viaje a Mar del Plata" required autofocus>`)}
    ${field('Integrantes (separados por coma)', `<input type="text" name="members" placeholder="Ana, Pedro, Lu" required>`)}
    <div class="muted" style="font-size:13px">Vos entrás automáticamente como “Yo”.</div>
    <button class="btn block">Crear grupo</button></form>`);
}
function formGexp(g, e) {
  sheet(e ? 'Editar gasto' : 'Gasto del grupo', `<form data-form="gexp" data-id="${e?.id || ''}">
    ${field('Qué fue', `<input type="text" name="desc" value="${esc(e?.desc || '')}" required autofocus placeholder="Ej: cena, nafta">`)}
    ${field('Monto', `<input class="money" name="amount" type="text" inputmode="decimal" value="${e?.amount || ''}" required>`)}
    ${field('Pagó', `<select name="paidBy">${g.members.map(m => `<option ${m === (e?.paidBy || 'Yo') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
    <label>Se divide entre<div class="checks">${g.members.map(m => `<label><input type="checkbox" name="split" value="${esc(m)}" ${!e || e.split.includes(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div></label>
    ${field('Fecha', `<input type="date" name="date" value="${e?.date || today()}">`)}
    <button class="btn block">Guardar</button>
    ${e ? `<button type="button" class="btn danger block" data-act="gexpdel" data-id="${e.id}">Eliminar</button>` : ''}</form>`);
}
function sheetDebt(d) {
  const fin = d.cuotasPagas >= d.cuotas;
  sheet(d.name, `<div class="card"><div class="label">Falta pagar</div><div class="big neg">${money(debtLeft(d))}</div>
    <div class="muted">${d.cuotasPagas}/${d.cuotas} cuotas de ${money(d.cuota)}</div><div class="bar"><i style="width:${Math.round(d.cuotasPagas / d.cuotas * 100)}%"></i></div></div>
    <div class="btns">${fin ? '' : `<button class="btn" data-act="payquota" data-id="${d.id}">Pagar cuota (${money(d.cuota)})</button>`}
    <button class="btn ghost" data-act="debtedit" data-id="${d.id}">Editar</button><button class="btn danger" data-act="debtdel" data-id="${d.id}">Eliminar</button></div>
    ${fin ? '' : '<p class="muted" style="font-size:13px">Al pagar una cuota se suma también como gasto en “Deudas”.</p>'}`);
}
function sheetPerson(k) {
  const loans = S.loans.filter(l => l.person.trim().toLowerCase() === k);
  if (!loans.length) return closeSheet();
  const p = peopleList().find(x => x.key === k), name = loans[0].person;
  const lines = loans.slice().sort((a, b) => b.date.localeCompare(a.date)).map(l => `
    <div class="item" style="display:block"><div class="row"><div class="t">${esc(l.concept || (l.dir === 'me-deben' ? 'Préstamo' : 'Deuda'))}</div><div class="amt ${l.dir === 'me-deben' ? 'pos' : 'neg'}">${money(loanLeft(l))}</div></div>
    <div class="s">${l.dir === 'me-deben' ? 'Te debe' : 'Le debés'} · ${dayLabel(l.date)} · total ${money(l.amount)}${(l.payments || []).length ? ' · pagado ' + money(loanPaid(l)) : ''}</div>
    <div class="btns">${loanLeft(l) > 0 ? `<button class="btn sm" data-act="loanpay" data-id="${l.id}">Registrar pago</button>` : '<span class="pill pos">Saldado</span>'}<button class="btn sm danger" data-act="loandel" data-id="${l.id}">Borrar</button></div></div>`).join('');
  sheet(name, `<div class="card"><div class="label">${p.net > 0 ? 'Te debe' : p.net < 0 ? 'Le debés' : 'Saldado'}</div><div class="big ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}">${money(Math.abs(p.net))}</div>
    ${p.net > 0 ? `<button class="btn" data-act="remind" data-k="${esc(k)}">Recordar por WhatsApp</button>` : ''}</div><div class="list">${lines}</div>`);
}

// ---------- acciones ----------
const act = {
  tab: el => { view = el.dataset.v; if (el.dataset.sub) debtsTab = el.dataset.sub; openGroup = null; render(); scrollTo(0, 0); },
  mprev: () => { month = shiftMonth(month, -1); render(); },
  mnext: () => { month = shiftMonth(month, 1); render(); },
  close: closeSheet,
  addtx: () => formTx(),
  newloan: () => formLoan(),
  newdebt: () => formDebt(),
  newgroup: () => formGroup(),
  newgexp: () => formGexp(S.groups.find(g => g.id === openGroup)),
  tx: el => formTx(S.tx.find(t => t.id === el.dataset.id)),
  txdel: el => { if (confirm('¿Eliminar este movimiento?')) { S.tx = S.tx.filter(t => t.id !== el.dataset.id); closeSheet(); commit(); } },
  debt: el => sheetDebt(S.debts.find(d => d.id === el.dataset.id)),
  debtedit: el => formDebt(S.debts.find(d => d.id === el.dataset.id)),
  debtdel: el => { if (confirm('¿Eliminar esta deuda?')) { S.debts = S.debts.filter(d => d.id !== el.dataset.id); closeSheet(); commit(); } },
  payquota: el => {
    const d = S.debts.find(x => x.id === el.dataset.id); if (!d || d.cuotasPagas >= d.cuotas) return;
    d.cuotasPagas++; S.tx.push({ id: uid(), type: 'gasto', amount: d.cuota, cat: 'Deudas', note: `${d.name} · cuota ${d.cuotasPagas}/${d.cuotas}`, date: today() });
    commit(); sheetDebt(d); toast('Cuota registrada');
  },
  person: el => sheetPerson(el.dataset.k),
  loanpay: el => {
    const l = S.loans.find(x => x.id === el.dataset.id);
    sheet('Registrar pago', `<form data-form="loanpay" data-id="${l.id}">${field(`Monto (resta ${money(loanLeft(l))})`, `<input class="money" name="amount" type="text" inputmode="decimal" value="${loanLeft(l)}" required autofocus>`)}
      ${field('Fecha', `<input type="date" name="date" value="${today()}">`)}<button class="btn block">Guardar</button></form>`);
  },
  loandel: el => { if (confirm('¿Borrar este registro?')) { const k = S.loans.find(l => l.id === el.dataset.id)?.person.trim().toLowerCase(); S.loans = S.loans.filter(l => l.id !== el.dataset.id); commit(); sheetPerson(k); } },
  remind: el => {
    const k = el.dataset.k, loans = S.loans.filter(l => l.person.trim().toLowerCase() === k && l.dir === 'me-deben' && loanLeft(l) > 0);
    const p = peopleList().find(x => x.key === k), total = sum(loans, loanLeft), first = p.name.split(' ')[0];
    const concept = loans.length === 1 && loans[0].concept ? ` de ${loans[0].concept}` : '';
    const msg = `Hola ${first}! Te escribo por los ${money(total)}${concept} que quedaron pendientes. Cuando puedas me avisás, gracias!`;
    window.open(`https://wa.me/${(p.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  },
  group: el => { openGroup = el.dataset.id; render(); scrollTo(0, 0); },
  gback: () => { openGroup = null; render(); },
  gdel: () => { if (confirm('¿Eliminar el grupo y todos sus gastos?')) { S.groups = S.groups.filter(g => g.id !== openGroup); openGroup = null; commit(); } },
  gexp: el => { const g = S.groups.find(x => x.id === openGroup), e = g.expenses.find(x => x.id === el.dataset.id); e.items ? formItems(g, e) : formGexp(g, e); },
  gexpdel: el => { const g = S.groups.find(x => x.id === openGroup); g.expenses = g.expenses.filter(e => e.id !== el.dataset.id); closeSheet(); commit(); },
  install: async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch { } installEv = null; closeSheet(); },
  reload: () => location.reload(),
  checkupdate: async () => {
    const el = $('#app-ver'); if (el) el.textContent = 'Buscando actualización…';
    try { const reg = await navigator.serviceWorker.getRegistration(); await reg?.update(); } catch { }
    setTimeout(showVersion, 1500);
  },
  settings: () => { sheet('Ajustes y backup', `
    ${installEv && !matchMedia('(display-mode: standalone)').matches ? '<button class="btn block" data-act="install">Instalar app en este teléfono</button>' : ''}
    <label>Tema<div class="seg">${[['light', 'Claro'], ['dark', 'Oscuro']].map(([v, n]) => `<label><input type="radio" name="theme" value="${v}" ${getTheme() === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></label>
    <button class="btn ghost block" data-act="cfg">Funciones con IA (opcional)</button>
    <p class="muted">Tus datos viven solo en este dispositivo. Hacé backups seguido, sobre todo antes de cambiar de celular.</p>
    <div class="btns"><button class="btn" data-act="export">Exportar backup</button>
    <label class="btn ghost" style="cursor:pointer">Importar backup<input type="file" accept="application/json" id="imp" hidden></label>
    <button class="btn danger" data-act="wipe">Borrar todo</button></div>
    <div class="row" style="margin-top:6px"><span id="app-ver" class="muted" style="font-size:13px"></span><button class="btn ghost sm" data-act="checkupdate">Buscar actualización</button></div>`); showVersion(); },
  export: () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `plata-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  },
  wipe: () => { if (confirm('Esto borra TODOS tus datos de este dispositivo. ¿Seguro?') && confirm('Última chance: ¿borrar todo?')) { S = { tx: [], debts: [], loans: [], groups: [] }; closeSheet(); commit(); } }
};

const forms = {
  tx(f, id) {
    const amount = parseAmount(f.amount.value); if (!(amount > 0)) return toast('Monto inválido');
    const type = f.type.value, raw = f.cat.value.trim().replace(/\s+/g, ' ');
    if (!raw) return toast('Elegí o escribí una categoría');
    let cat = findCat(type, raw);
    if (!cat) { cat = raw[0].toUpperCase() + raw.slice(1); ((S.customCats ||= { gasto: [], ingreso: [] })[type] ||= []).push(cat); }
    const o = { id: id || uid(), type, amount, cat, method: f.method.value, note: f.note.value.trim(), date: f.date.value };
    S.lastMethod = o.method;
    id ? S.tx[S.tx.findIndex(t => t.id === id)] = o : S.tx.push(o);
    month = o.date.slice(0, 7); view = view === 'home' ? 'home' : 'mov';
  },
  debt(f, id) {
    const total = parseAmount(f.total.value), cuotas = parseInt(f.cuotas.value), paid = Math.min(parseInt(f.paid.value) || 0, cuotas);
    if (!(total > 0) || !(cuotas > 0)) return toast('Revisá monto y cuotas');
    const o = { id: id || uid(), name: f.name.value.trim(), cuotas, cuotasPagas: paid, cuota: Math.round(total / cuotas * 100) / 100, dueDay: parseInt(f.dueDay.value) || 0 };
    id ? S.debts[S.debts.findIndex(d => d.id === id)] = o : S.debts.push(o);
  },
  loan(f) {
    const amount = parseAmount(f.amount.value); if (!(amount > 0)) return toast('Monto inválido');
    S.loans.push({ id: uid(), dir: f.dir.value, person: f.person.value.trim(), amount, concept: f.concept.value.trim(), phone: f.phone.value.trim(), date: f.date.value || today(), payments: [] });
  },
  loanpay(f, id) {
    const l = S.loans.find(x => x.id === id), a = parseAmount(f.amount.value); if (!(a > 0)) return toast('Monto inválido');
    (l.payments ||= []).push({ id: uid(), amount: Math.min(a, loanLeft(l)), date: f.date.value });
    commit(); closeSheet(); sheetPerson(l.person.trim().toLowerCase()); return 'done';
  },
  group(f) {
    const members = ['Yo', ...f.members.value.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'yo')];
    if (new Set(members.map(m => m.toLowerCase())).size !== members.length) return toast('Hay nombres repetidos');
    const g = { id: uid(), name: f.name.value.trim(), members, expenses: [] }; S.groups.push(g); openGroup = g.id;
  },
  gexp(f, id) {
    const g = S.groups.find(x => x.id === openGroup), amount = parseAmount(f.amount.value), split = [...f.querySelectorAll('[name=split]:checked')].map(c => c.value);
    if (!(amount > 0)) return toast('Monto inválido'); if (!split.length) return toast('Elegí con quién se divide');
    const o = { id: id || uid(), desc: f.desc.value.trim(), amount, paidBy: f.paidBy.value, split, date: f.date.value || today() };
    id ? g.expenses[g.expenses.findIndex(e => e.id === id)] = o : g.expenses.push(o);
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { act[el.dataset.act]?.(el); return; }
  if (e.target.id === 'overlay') closeSheet();
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const r = forms[f.dataset.form](f, f.dataset.id || null);
  if (r === 'done' || r === false) return;
  if (r === undefined) { closeSheet(); commit(); toast('Guardado'); }
});
document.addEventListener('change', e => {
  if (e.target.name === 'dsub') { debtsTab = e.target.value; render(); return; }
  if (e.target.name === 'theme') {
    try { localStorage.setItem('plata.theme', e.target.value); } catch { }
    applyTheme(e.target.value); return;
  }
  if (e.target.id !== 'imp') return;
  const file = e.target.files[0]; if (!file) return;
  file.text().then(t => {
    const v = JSON.parse(t);
    if (!Array.isArray(v.tx) || !Array.isArray(v.debts) || !Array.isArray(v.loans) || !Array.isArray(v.groups)) throw 0;
    if (confirm('Esto reemplaza tus datos actuales por los del backup. ¿Continuar?')) { S = v; closeSheet(); commit(); toast('Backup importado'); }
  }).catch(() => toast('Archivo inválido'));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
// campo de categoría: desplegable + escritura con filtro por coincidencia
act.combotoggle = el => { const i = el.parentElement.querySelector('input'), l = el.parentElement.querySelector('.combo-list'); if (l.hidden) { comboRender(i, true); i.focus({ preventScroll: true }); } else l.hidden = true; };
act.combopick = el => { const c = el.closest('.combo'); c.querySelector('input').value = el.dataset.v; c.querySelector('.combo-list').hidden = true; };
document.addEventListener('input', e => { if (e.target.matches('.combo input')) comboRender(e.target, false); });
document.addEventListener('focusin', e => { if (e.target.matches('.combo input')) { e.target.select(); comboRender(e.target, false); } });
document.addEventListener('click', e => { if (!e.target.closest('.combo')) document.querySelectorAll('.combo-list').forEach(l => l.hidden = true); });

// ---------- arranque ----------
(async () => {
  await load();
  render();
  // accesos directos (mantener apretado el ícono): ?add=gasto | ingreso | import
  const add = new URLSearchParams(location.search).get('add');
  if (add) { history.replaceState(null, '', location.pathname); add === 'import' ? act.importmov() : formTx(null, add === 'ingreso' ? 'ingreso' : 'gasto'); }
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
