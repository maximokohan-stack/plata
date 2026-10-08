'use strict';
/* Compra por producto: cada ítem del ticket lo "financian" solo quienes lo consumieron.
   Se puede cargar a mano o sacarle una foto al ticket y que Claude lea productos y precios. */

let itemsGroup = null, scannedTotal = null;

const ITEMS_PROMPT = `Sos un lector de tickets y facturas de Argentina (supermercado, restaurante, servicios como internet, luz o celular, etc.). Respondé SOLO con un JSON (sin markdown ni texto extra) con esta forma:
{"store": string|null, "items": [{"name": string, "amount": number}], "total": number|null}
Reglas:
- Cada ítem es una línea de producto con el precio TOTAL de esa línea. Si dice "2 x $1500", usá 3000 y poné la cantidad en el nombre ("Leche x2").
- "amount" es un número en pesos con punto decimal (1234.5), sin símbolos. Los precios argentinos usan punto de miles y coma decimal: "1.234,50" significa 1234.5.
- Si hay un descuento sobre un producto, incluilo como ítem aparte llamado "Descuento <producto>" con amount negativo.
- NO incluyas subtotal, total, IVA, redondeo, medios de pago, vuelto ni propina como ítems.
- "total" es el total final a pagar impreso en el documento.
- En facturas de servicios, un ítem por cada concepto facturado (ej. "Abono mensual internet", "Cargo por equipo").
- Si los importes de línea no incluyen IVA o impuestos y el total sí, agregá un ítem "IVA e impuestos" con la diferencia, para que la suma de ítems dé el total.
- Nombres legibles en español; expandí abreviaturas obvias (LECHE ENT 1L -> "Leche entera 1 L").
- Si el documento no tiene importes, devolvé {"store":null,"items":[],"total":null}.`;

// ---------- utilidades compartidas con la importación de movimientos ----------
const parseJsonLoose = txt => {
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No entendí la respuesta. Probá con otra foto.');
  try { return JSON.parse(txt.slice(a, b + 1)); } catch { throw new Error('No entendí la respuesta. Probá con otra foto.'); }
};
// imagen -> bloque image reducido; PDF -> bloque document
async function fileToBlock(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 20e6) throw new Error('El PDF pesa demasiado (máx. 20 MB).');
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('No pude leer el PDF')); r.readAsDataURL(file); });
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  }
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await prepImage(file) } };
}

const itemRow = (g, it = {}) => `<div class="irow"><div class="irow-top">
  <input type="text" class="i-name" placeholder="Producto" value="${esc(it.name || '')}" aria-label="Producto">
  ${MI(`<input type="text" class="i-amt" inputmode="decimal" placeholder="0" value="${fmtIn(it.amount)}" aria-label="Precio">`)}
  <button type="button" class="icon-btn" data-act="itemrm" aria-label="Quitar producto">✕</button></div>
  <div class="checks">${g.members.map(m => `<label><input type="checkbox" class="i-m" value="${esc(m)}" ${!it.split || it.split.includes(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div></div>`;

function formItems(g, e) {
  itemsGroup = g; scannedTotal = null;
  const rows = e?.items?.length ? e.items.map(it => itemRow(g, it)).join('') : itemRow(g);
  sheet(e ? 'Editar compra' : 'Compra por producto', `<form data-form="items" data-id="${e?.id || ''}">
    <p class="muted" style="margin:0;font-size:14px">Marcá quién consumió cada producto: cada uno paga solo lo suyo.</p>
    <div class="row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
      <label class="btn ghost sm ai-only" style="cursor:pointer;flex-direction:row;color:var(--ink);font-size:14px"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Escanear ticket<input type="file" id="scan-file" accept="image/*,application/pdf" hidden></label>
      <span id="scan-status" class="muted" style="font-size:13px"></span></div>
    ${field('Dónde (opcional)', `<input type="text" name="desc" value="${esc(e?.desc || '')}" placeholder="Ej: Supermercado">`)}
    <div class="grid2" style="margin:0">${field('Pagó', `<select name="paidBy">${g.members.map(m => `<option ${m === (e?.paidBy || 'Yo') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
      ${field('Fecha', `<input type="date" name="date" value="${e?.date || today()}">`)}</div>
    <div id="i-rows" class="prows">${rows}</div>
    <div class="row"><button type="button" class="btn ghost sm" data-act="itemadd">+ Producto</button><b id="i-total" style="font:600 20px var(--display)"></b></div>
    <div id="i-warn" class="warn" style="font-size:14px" hidden></div>
    <button class="btn block">Guardar compra</button>
    ${e ? `<button type="button" class="btn danger block" data-act="gexpdel" data-id="${e.id}">Eliminar</button>` : ''}</form>`);
  itemsDraw();
}

function readItems() {
  return [...document.querySelectorAll('#i-rows .irow')].map(r => ({
    name: r.querySelector('.i-name').value.trim(), amount: parseAmount(r.querySelector('.i-amt').value),
    split: [...r.querySelectorAll('.i-m:checked')].map(c => c.value)
  }));
}
function itemsDraw() {
  const tot = sum(readItems().filter(i => !isNaN(i.amount)), i => i.amount), w = $('#i-warn');
  $('#i-total').textContent = 'Total ' + money(tot);
  const off = scannedTotal != null && Math.abs(tot - scannedTotal) > 1;
  w.hidden = !off;
  if (off) w.textContent = `⚠ La suma (${money(tot)}) no coincide con el total del ticket (${money(scannedTotal)}). Revisá los productos.`;
}

forms.items = (f, id) => {
  const g = itemsGroup, items = readItems().filter(i => i.name || !isNaN(i.amount));
  if (!items.length) return toast('Agregá al menos un producto');
  for (const [i, it] of items.entries()) {
    if (isNaN(it.amount) || it.amount === 0) return toast(`Falta el precio de "${it.name || 'producto ' + (i + 1)}"`);
    if (!it.split.length) return toast(`Marcá quién consumió "${it.name || 'producto ' + (i + 1)}"`);
  }
  const clean = items.map(it => ({ name: it.name || 'Producto', amount: Math.round(it.amount * 100) / 100, split: it.split }));
  const amount = Math.round(sum(clean, i => i.amount) * 100) / 100;
  if (!(amount > 0)) return toast('El total tiene que ser mayor a cero');
  const o = { id: id || uid(), desc: f.desc.value.trim() || 'Compra', amount, paidBy: f.paidBy.value, split: [...new Set(clean.flatMap(i => i.split))], items: clean, date: f.date.value || today() };
  id ? g.expenses[g.expenses.findIndex(e => e.id === id)] = o : g.expenses.push(o);
};

// ---------- leer el ticket con Claude ----------
const prepImage = file => new Promise((res, rej) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const s = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    res(c.toDataURL('image/jpeg', .85).split(',')[1]);
  };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No pude abrir la imagen')); };
  img.src = url;
});

async function readReceipt(file) {
  const out = parseJsonLoose(await askLLM(ITEMS_PROMPT, [await fileToBlock(file), { type: 'text', text: 'Extraé los productos o conceptos de este documento.' }]));
  const items = (out.items || []).map(i => ({ name: String(i.name || '').trim(), amount: Number(i.amount) })).filter(i => i.name && isFinite(i.amount) && i.amount !== 0);
  return { store: out.store || '', items, total: isFinite(Number(out.total)) && out.total != null ? Number(out.total) : null };
}

document.addEventListener('change', async e => {
  if (e.target.id !== 'scan-file') return;
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const st = $('#scan-status');
  if (!getCfg().apiKey) { st.textContent = 'Falta tu API key. Cerrá esto, tocá ✨ arriba a la derecha, luego ⚙, pegala y guardá.'; return; }
  st.textContent = 'Leyendo el ticket…';
  try {
    const r = await readReceipt(file);
    if (!r.items.length) { st.textContent = 'No encontré importes en ese archivo. Probá con una foto más nítida, de frente y bien iluminada, o con el PDF.'; return; }
    const box = $('#i-rows');
    if (box && itemsGroup) {
      const rows = [...box.querySelectorAll('.irow')];
      if (rows.length === 1 && !rows[0].querySelector('.i-name').value.trim() && !rows[0].querySelector('.i-amt').value.trim()) rows[0].remove();
      box.insertAdjacentHTML('beforeend', r.items.map(i => itemRow(itemsGroup, { name: i.name, amount: i.amount })).join(''));
      const d = $('form[data-form=items] [name=desc]'); if (r.store && d && !d.value.trim()) d.value = r.store;
      scannedTotal = r.total; itemsDraw();
      st.textContent = `${r.items.length} productos leídos. Revisalos y marcá quién consumió cada uno.`;
    }
  } catch (err) { st.textContent = err.message || 'No se pudo leer el ticket.'; }
});

act.newitems = () => formItems(S.groups.find(g => g.id === openGroup));
act.itemadd = () => { $('#i-rows').insertAdjacentHTML('beforeend', itemRow(itemsGroup)); itemsDraw(); };
act.itemrm = el => { const box = $('#i-rows'); if (box.children.length <= 1) { el.closest('.irow').querySelectorAll('input[type=text]').forEach(i => i.value = ''); } else el.closest('.irow').remove(); itemsDraw(); };
document.addEventListener('input', e => { if (e.target.closest('#i-rows')) itemsDraw(); });
