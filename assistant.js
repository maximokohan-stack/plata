'use strict';
/* Asistente de Plata: chat con un modelo de IA (Anthropic, OpenAI, Gemini u OpenRouter, según lo que elija cada persona)
   que lee y registra datos mediante herramientas. La configuración y la API key viven en llm.js. */

const TOOLS = [
  { name: 'get_snapshot', description: 'Resumen de las finanzas del usuario: ingresos, gastos y gasto por categoría del mes, quién le debe y a quién le debe, deudas con cuotas y grupos de gastos compartidos. Usalo antes de responder cualquier pregunta sobre sus números.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'Mes en formato YYYY-MM. Por defecto el mes actual.' } } } },
  { name: 'list_transactions', description: 'Lista movimientos (gastos e ingresos) de un mes, opcionalmente filtrados por categoría. Más recientes primero.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, category: { type: 'string' }, limit: { type: 'integer', description: 'Máximo de resultados (default 30)' } } } },
  { name: 'add_transaction', description: 'Registra un gasto o un ingreso. Categorías de gasto de fábrica: ' + CATS.gasto.map(c => c[0]).join(', ') + '; de ingreso: ' + CATS.ingreso.map(c => c[0]).join(', ') + '. El usuario también tiene categorías propias (ver "categories" en get_snapshot): usá una existente si encaja; si ninguna encaja, podés crear una nueva con un nombre corto.',
    input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['gasto', 'ingreso'] }, amount: { type: 'number', description: 'Monto en pesos, positivo' }, category: { type: 'string' }, method: { type: 'string', enum: METHODS, description: 'Método de pago (gasto) o por el que ingresó (ingreso). Si el usuario no lo dice, omitilo.' }, note: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, por defecto hoy' } }, required: ['type', 'amount', 'category'] } },
  { name: 'add_loan', description: 'Registra plata prestada: direction "me-deben" si el usuario le prestó a alguien, "debo" si le prestaron a él.',
    input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['me-deben', 'debo'] }, person: { type: 'string' }, amount: { type: 'number' }, concept: { type: 'string' } }, required: ['direction', 'person', 'amount'] } },
  { name: 'register_payment', description: 'Registra un pago (total o parcial) sobre lo que una persona le debe al usuario o lo que él le debe a ella. Se aplica a los préstamos más viejos primero.',
    input_schema: { type: 'object', properties: { person: { type: 'string' }, direction: { type: 'string', enum: ['me-deben', 'debo'] }, amount: { type: 'number' } }, required: ['person', 'direction', 'amount'] } },
  { name: 'pay_installment', description: 'Marca como paga la próxima cuota de una deuda (tarjeta, préstamo) y la registra como gasto.',
    input_schema: { type: 'object', properties: { debt_name: { type: 'string' } }, required: ['debt_name'] } }
];

const r2 = n => Math.round(n * 100) / 100;
const findDebt = n => S.debts.find(d => d.name.toLowerCase() === n.toLowerCase()) || S.debts.find(d => d.name.toLowerCase().includes(n.toLowerCase()));

const runTool = {
  get_snapshot({ month: m } = {}) {
    m = /^\d{4}-\d{2}$/.test(m || '') ? m : today().slice(0, 7);
    const tx = S.tx.filter(t => t.date.startsWith(m)), byCat = {};
    tx.filter(t => t.type === 'gasto').forEach(t => byCat[t.cat] = r2((byCat[t.cat] || 0) + t.amount));
    return {
      today: today(), month: m, currency: 'ARS', categories: { gasto: allCats('gasto'), ingreso: allCats('ingreso') },
      income: r2(sum(tx.filter(t => t.type === 'ingreso'), t => t.amount)), expenses: r2(sum(tx.filter(t => t.type === 'gasto'), t => t.amount)), expensesByCategory: byCat,
      expensesByPaymentMethod: tx.filter(t => t.type === 'gasto' && t.method).reduce((o, t) => (o[t.method] = r2((o[t.method] || 0) + t.amount), o), {}),
      people: peopleList().map(p => ({ name: p.name, net: r2(p.net), meaning: p.net > 0 ? 'te debe' : p.net < 0 ? 'le debés' : 'saldado' })),
      debts: S.debts.map(d => ({ name: d.name, installmentsPaid: d.cuotasPagas, installmentsTotal: d.cuotas, installmentAmount: d.cuota, remaining: r2(debtLeft(d)), dueDay: d.dueDay || null })),
      groups: S.groups.map(g => ({ name: g.name, total: r2(sum(g.expenses, e => e.amount)), toSettle: settle(groupBalances(g)).map(s => ({ from: s.from, to: s.to, amount: r2(s.amount) })) }))
    };
  },
  list_transactions({ month: m, category, limit } = {}) {
    m = /^\d{4}-\d{2}$/.test(m || '') ? m : today().slice(0, 7);
    return S.tx.filter(t => t.date.startsWith(m) && (!category || t.cat.toLowerCase() === category.toLowerCase())).sort(byDate).slice(0, Math.min(limit || 30, 100))
      .map(t => ({ date: t.date, type: t.type, amount: t.amount, category: t.cat, method: t.method || null, note: t.note }));
  },
  add_transaction({ type, amount, category, method, note, date }) {
    if (!(amount > 0) || !isFinite(amount) || !['gasto', 'ingreso'].includes(type)) throw new Error('Datos inválidos');
    amount = r2(amount);
    const raw = String(category || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!raw) throw new Error('Falta la categoría');
    let cat = findCat(type, raw);
    if (!cat) { cat = raw[0].toUpperCase() + raw.slice(1); ((S.customCats ||= { gasto: [], ingreso: [] })[type] ||= []).push(cat); }
    const m = method ? findMethod(method) : undefined;
    const t = { id: uid(), type, amount, cat, method: m, note: note || '', date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today() };
    S.tx.push(t); commit(); return { ok: true, saved: { type, amount, category: cat, method: m, date: t.date } };
  },
  add_loan({ direction, person, amount, concept }) {
    if (!(amount > 0) || !isFinite(amount) || !String(person || '').trim() || !['me-deben', 'debo'].includes(direction)) throw new Error('Datos inválidos');
    S.loans.push({ id: uid(), dir: direction, person: String(person).trim(), amount, concept: concept || '', phone: '', date: today(), payments: [] });
    commit(); return { ok: true };
  },
  register_payment({ person, direction, amount }) {
    const k = String(person || '').trim().toLowerCase();
    if (!(amount > 0) || !isFinite(amount)) throw new Error('Datos inválidos');
    const loans = S.loans.filter(l => personKey(l) === k && l.dir === direction && loanLeft(l) > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!loans.length) throw new Error('No hay deuda pendiente con esa persona en esa dirección');
    let rest = amount;
    for (const l of loans) { if (rest <= 0) break; const a = Math.min(rest, loanLeft(l)); (l.payments ||= []).push({ id: uid(), amount: a, date: today() }); rest -= a; }
    commit(); return { ok: true, applied: r2(amount - rest), unapplied: r2(rest) };
  },
  pay_installment({ debt_name }) {
    const d = findDebt(debt_name); if (!d) throw new Error('No encontré esa deuda');
    if (d.cuotasPagas >= d.cuotas) throw new Error('Esa deuda ya está paga');
    d.cuotasPagas++; S.tx.push({ id: uid(), type: 'gasto', amount: d.cuota, cat: 'Deudas', note: `${d.name} · cuota ${d.cuotasPagas}/${d.cuotas}`, date: today() });
    commit(); return { ok: true, paid: `${d.cuotasPagas}/${d.cuotas}`, remaining: r2(debtLeft(d)) };
  }
};
const RECEIPT = {
  add_transaction: r => `Registrado: ${r.saved.type} de ${money(r.saved.amount)} en ${r.saved.category}`,
  add_loan: () => 'Préstamo registrado', register_payment: r => `Pago registrado: ${money(r.applied)}`, pay_installment: r => `Cuota pagada (${r.paid})`
};

// ---------- chat ----------
const chat = { msgs: [], ui: [], busy: false };
const SYSTEM = () => `Sos el asistente de "Plata", una app personal de finanzas. Hablás en español rioplatense, claro y breve (esto se lee en un celular). Hoy es ${today()}; la moneda es el peso argentino (ARS).
Tenés herramientas para leer los datos del usuario y para registrar cosas. Reglas:
- Para cualquier pregunta sobre sus números, consultá primero con get_snapshot o list_transactions; nunca inventes cifras.
- Cuando el usuario cuente un gasto, ingreso, préstamo o pago, registralo con la herramienta correspondiente. Si falta un dato imprescindible (monto, o quién es la persona), preguntalo antes de registrar. No borrás nada.
- Después de registrar, confirmá en una línea lo que anotaste.
- Podés dar ideas generales de ahorro y organización, pero no sos asesor financiero ni recomendás inversiones.`;

const callApi = () => llm({ system: SYSTEM(), tools: TOOLS, messages: chat.msgs, maxTokens: 4000, effort: 'low' });

async function send(text) {
  const cfg = getCfg();
  if (!cfg.apiKey) { chat.ui.push({ r: 'err', t: 'Para usar el asistente cargá tu API key (tocá ⚙ arriba).' }); drawChat(); openCfg(); return; }
  chat.busy = true; chat.ui.push({ r: 'user', t: text }); chat.msgs.push({ role: 'user', content: text }); drawChat();
  try {
    for (let i = 0; i < 8; i++) {
      const data = await callApi();
      chat.msgs.push({ role: 'assistant', content: data.content });          // se devuelve tal cual (incluye bloques de thinking)
      const txt = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (txt) chat.ui.push({ r: 'bot', t: txt });
      if (data.stop === 'refusal') { chat.ui.push({ r: 'err', t: 'No pude responder eso. Probá reformularlo.' }); break; }
      if (data.stop === 'max_tokens') { chat.ui.push({ r: 'err', t: 'La respuesta se cortó. Pedime algo más puntual.' }); break; }
      if (data.stop !== 'tool_use') break;
      const results = [];
      for (const b of data.content.filter(b => b.type === 'tool_use')) {
        try {
          const out = runTool[b.name](b.input || {});
          if (RECEIPT[b.name]) chat.ui.push({ r: 'note', t: '✓ ' + RECEIPT[b.name](out) });
          results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
        } catch (e) { results.push({ type: 'tool_result', tool_use_id: b.id, content: String(e.message || e), is_error: true }); }
      }
      chat.msgs.push({ role: 'user', content: results });
      drawChat();
    }
  } catch (e) {
    chat.ui.push({ r: 'err', t: e.message || 'No se pudo conectar. ¿Tenés internet?' });
    // sacamos el turno fallido para que el historial siga siendo válido
    while (chat.msgs.length && !(chat.msgs.at(-1).role === 'user' && typeof chat.msgs.at(-1).content === 'string')) chat.msgs.pop();
    chat.msgs.pop();
  }
  chat.busy = false; drawChat();
}

const fmtMsg = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
function drawChat() {
  const box = $('#chat-log'); if (!box) return;
  const hints = ['¿Cuánto gasté este mes?', '¿Quién me debe plata?', 'Gasté 8500 en el súper', '¿En qué gasto de más?'];
  box.innerHTML = (chat.ui.length ? '' : `<div class="empty"><b>Preguntame lo que quieras</b>Puedo leer tus gastos, deudas y préstamos, y anotar cosas por vos.</div><div class="chips">${hints.map(h => `<button data-act="hint" data-t="${esc(h)}">${esc(h)}</button>`).join('')}</div>`)
    + chat.ui.map(m => `<div class="msg ${m.r}">${fmtMsg(m.t)}</div>`).join('') + (chat.busy ? '<div class="msg bot typing"><i></i><i></i><i></i></div>' : '');
  box.scrollTop = box.scrollHeight;
  $('#chat-send').disabled = chat.busy;
}
function openChat() { $('#chat').hidden = false; drawChat(); syncHistory(); if (!getCfg().apiKey) openCfg(); }
function openCfg(provider) {
  const c = getCfg(typeof provider === 'string' ? provider : undefined), P = PROVIDERS[c.provider];
  const sug = Object.entries(P.models).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  sheet('Funciones con IA (opcional)', `<form data-form="cfg">
    <p class="muted" style="margin:0">La app funciona completa sin esto. Con una API key se suman: el <b>asistente</b> (preguntale o decile "gasté 8500 en el súper"), <b>escanear tickets y facturas</b> y <b>importar movimientos</b> desde capturas. <b>Cada persona usa su propia cuenta y paga su propio uso.</b></p>
    ${field('Proveedor', `<select name="provider" id="cfg-provider">${Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}" ${id === c.provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}
    <p class="muted" style="margin:0;font-size:14px">Conseguí tu key en <b>${P.keyUrl}</b>. ${esc(P.note)} La key queda solo en este dispositivo y se envía directo a ${esc(P.name)}, junto con lo que el asistente o el lector necesiten consultar.</p>
    ${field('API key', `<input type="password" name="apiKey" autocomplete="off" placeholder="${esc(P.keyHint)}" value="${esc(c.apiKey || '')}">`)}
    ${field('Modelo', `<input type="text" name="model" id="cfg-model" list="cfg-models" autocomplete="off" value="${esc(c.model)}"><datalist id="cfg-models">${sug}</datalist>`)}
    <div class="row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap"><button type="button" class="btn ghost sm" data-act="listmodels">Ver modelos disponibles</button><span id="cfg-status" class="muted" style="font-size:13px"></span></div>
    <div class="muted" style="font-size:13px">Para leer tickets el modelo tiene que aceptar imágenes, y para el asistente, herramientas. Los modelos gratuitos o chicos se equivocan más con precios y fotos borrosas. Creá una key dedicada, con tope de gasto si el proveedor lo permite.</div>
    <button class="btn block">Guardar</button>
    ${c.apiKey ? '<button type="button" class="btn danger block" data-act="cfgdel">Quitar API key de este proveedor</button>' : ''}</form>`);
}

forms.cfg = f => {
  const prev = getCfg(), provider = f.provider.value, model = f.model.value.trim() || PROVIDERS[provider].def;
  if (!f.apiKey.value.trim()) return toast('Pegá tu API key');
  setCfg({ provider, apiKey: f.apiKey.value.trim(), model });
  if (prev.active !== provider || prev.model !== model) { chat.msgs = []; chat.ui = []; drawChat(); }   // el historial no se comparte entre modelos
};
syncAi();
act.chat = openChat;
act.cfg = () => openCfg();
act.cfgdel = () => {   // borra la key del proveedor que se está viendo (no necesariamente el activo)
  clearKey($('#cfg-provider')?.value || getCfg().provider); chat.msgs = []; chat.ui = []; closeSheet();
  if (!getCfg().apiKey) { $('#chat').hidden = true; syncHistory(); }
  toast('API key eliminada');
};
act.listmodels = async () => {
  const st = $('#cfg-status'), prov = $('#cfg-provider').value, key = $('form[data-form=cfg]').apiKey.value.trim();
  st.textContent = 'Buscando modelos…';
  try {
    const ms = await listModels(prov, key);
    if (!$('#cfg-models')) return;
    $('#cfg-models').innerHTML = ms.slice(0, 400).map(m => `<option value="${esc(m.id)}">${esc(m.free ? '🆓 ' : '')}${esc(m.name)}</option>`).join('');
    const free = ms.filter(m => m.free).length;
    st.textContent = `${ms.length} modelos${prov === 'openrouter' ? ' con imágenes y herramientas' : prov === 'openai' ? ' de chat (elegí uno con imágenes, p. ej. GPT-5 o mini)' : ''}${free ? ` · ${free} gratuitos (🆓)` : ''}. Tocá el campo Modelo para elegir; si lo vaciás aparecen todos.`;
    const inp = $('#cfg-model'); inp.value = ''; inp.focus();
  } catch (e) { st.textContent = e.message; }
};
document.addEventListener('change', e => { if (e.target.id === 'cfg-provider') openCfg(e.target.value); });
act.chatclose = () => { $('#chat').hidden = true; syncHistory(); };
act.chatclear = () => { chat.msgs = []; chat.ui = []; drawChat(); };
act.hint = el => { if (!chat.busy) send(el.dataset.t); };
document.addEventListener('submit', e => {
  if (e.target.id !== 'chat-form') return;
  e.preventDefault();
  const inp = $('#chat-input'), t = inp.value.trim();
  if (!t || chat.busy) return;
  inp.value = ''; send(t);
});
