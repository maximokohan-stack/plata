'use strict';
/* Importar movimientos desde capturas o PDF (Mercado Pago, banco, tarjeta):
   Claude lee los gastos/ingresos y la app muestra solo los que todavía no cargaste. */

const IMPORT_PROMPT = () => `Sos un lector de resúmenes y capturas de movimientos de cuentas (Mercado Pago, bancos, tarjetas) de Argentina. Hoy es ${today()}. Respondé SOLO con un JSON (sin markdown ni texto extra) con esta forma:
{"movements":[{"date":"YYYY-MM-DD"|null,"description":string,"amount":number,"kind":"gasto"|"ingreso","category":string}]}
Reglas:
- Incluí solo movimientos ya realizados: pagos, compras, débitos, y también ingresos o cobros recibidos. Ignorá saldos, totales, límites, cuotas futuras, publicidad y movimientos pendientes.
- "amount" siempre positivo, en pesos, con punto decimal. Formato argentino: "1.234,50" significa 1234.5. "kind" es "gasto" si salió plata y "ingreso" si entró.
- Fechas: si falta el año, usá el más reciente que no sea futuro respecto de hoy. Si no hay fecha, null.
- "description": comercio o concepto, corto y legible (ej. "Subte", "Mercado Libre").
- "category": la más cercana de esta lista. Gastos: ${allCats('gasto').join(', ')}. Ingresos: ${allCats('ingreso').join(', ')}. Si ninguna encaja, "Otros" (gasto) u "Otros ingresos".
- No incluyas transferencias entre cuentas propias.
- Una fila por movimiento; si el mismo movimiento aparece en varias capturas, incluilo una sola vez.
- Si no hay movimientos, devolvé {"movements":[]}.`;

// ¿ya está cargado? mismo tipo y monto, con fecha a ±1 día
const isDup = m => S.tx.some(t => t.type === m.kind && Math.abs(t.amount - m.amount) < 0.5 && Math.abs((new Date(t.date + 'T12:00') - new Date(m.date + 'T12:00')) / 864e5) <= 1);

const catOpts = (kind, sel) => allCats(kind).map(c => `<option ${norm(c) === norm(sel) ? 'selected' : ''}>${esc(c)}</option>`).join('');
const impRow = m => `<div class="irow"><div class="imp-top">
  <input type="checkbox" class="m-on" ${m.dup ? '' : 'checked'} aria-label="Importar este movimiento">
  <input type="text" class="m-note" value="${esc(m.description)}" aria-label="Descripción">${MI(`<input type="text" class="m-amt" inputmode="decimal" value="${fmtIn(m.amount)}" aria-label="Monto">`)}</div>
  <div class="imp-bot"><input type="date" class="m-date" value="${m.date}" aria-label="Fecha">
  <select class="m-kind" aria-label="Tipo"><option value="gasto" ${m.kind === 'gasto' ? 'selected' : ''}>Gasto</option><option value="ingreso" ${m.kind === 'ingreso' ? 'selected' : ''}>Ingreso</option></select>
  <select class="m-cat" aria-label="Categoría">${catOpts(m.kind, m.category)}</select></div>
  ${m.dup ? '<div class="warn" style="font-size:13px">Parece ya cargado (mismo monto, fecha cercana). Viene sin marcar.</div>' : ''}</div>`;

function openImport() {
  sheet('Importar movimientos', `<div style="display:grid;gap:14px">
    <p class="muted" style="margin:0;font-size:14px">Subí capturas de los movimientos de Mercado Pago, tu banco o la tarjeta, o el PDF del resumen. Te muestro lo que todavía no cargaste y elegís qué importar.</p>
    <div class="row" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
      <label class="btn sm" style="cursor:pointer">Elegir capturas o PDF<input type="file" id="imp-file" accept="image/*,application/pdf" multiple hidden></label>
      <span id="imp-status" class="muted" style="font-size:13px"></span></div>
    <div class="muted" style="font-size:12px">Los archivos se envían a tu proveedor de IA (el que elegiste en ⚙) con tu API key para leerlos.</div>
    <div id="imp-wrap" hidden>
      ${field('Medio de pago de estos movimientos', `<select id="imp-method">${allMethods().map(m => `<option ${m === (S.lastMethod || 'Efectivo') ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
      <div id="imp-list" class="prows" style="margin-top:14px"></div>
      <button class="btn block" id="imp-go" data-act="impgo" style="margin-top:14px"></button>
    </div></div>`);
}
const impCount = () => document.querySelectorAll('#imp-list .m-on:checked').length;
const impButton = () => { const n = impCount(), b = $('#imp-go'); if (b) { b.textContent = n ? `Importar ${n} ${n === 1 ? 'movimiento' : 'movimientos'}` : 'Elegí al menos uno'; b.disabled = !n; } };

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches?.('.m-kind')) { const r = t.closest('.irow'); r.querySelector('.m-cat').innerHTML = catOpts(t.value, ''); return; }
  if (t.matches?.('.m-on')) { impButton(); return; }
  if (t.id !== 'imp-file') return;
  const files = [...t.files].slice(0, 6); t.value = ''; if (!files.length) return;
  const st = $('#imp-status');
  if (!getCfg().apiKey) { st.textContent = 'Falta tu API key. Cerrá esto, tocá ✨ arriba a la derecha, luego ⚙, pegala y guardá.'; return; }
  st.textContent = `Leyendo ${files.length === 1 ? 'el archivo' : files.length + ' archivos'}…`;
  try {
    const blocks = await Promise.all(files.map(fileToBlock));
    const out = parseJsonLoose(await askLLM(IMPORT_PROMPT(), [...blocks, { type: 'text', text: 'Extraé los movimientos.' }], 8000));
    const moves = (out.movements || []).map(m => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? m.date : today(), description: String(m.description || '').trim() || 'Movimiento',
      amount: Math.abs(Number(m.amount)), kind: m.kind === 'ingreso' ? 'ingreso' : 'gasto', category: String(m.category || '')
    })).filter(m => isFinite(m.amount) && m.amount > 0);
    if (!$('#imp-list')) return;
    if (!moves.length) { st.textContent = 'No encontré movimientos. Probá con una captura más nítida o el PDF del resumen.'; return; }
    moves.forEach(m => m.dup = isDup(m));
    const fresh = moves.filter(m => !m.dup).length;
    $('#imp-list').innerHTML = moves.map(impRow).join(''); $('#imp-wrap').hidden = false; impButton();
    st.textContent = `${moves.length} movimientos leídos · ${fresh} nuevos${moves.length - fresh ? ' · ' + (moves.length - fresh) + ' parecen ya cargados' : ''}.`;
  } catch (err) { st.textContent = err.message || 'No se pudo leer el archivo.'; }
});

act.importmov = openImport;
act.impgo = () => {
  const method = $('#imp-method').value; let n = 0;
  document.querySelectorAll('#imp-list .irow').forEach(r => {
    if (!r.querySelector('.m-on').checked) return;
    const amount = parseAmount(r.querySelector('.m-amt').value); if (!(amount > 0)) return;
    const type = r.querySelector('.m-kind').value;
    S.tx.push({ id: uid(), type, amount: Math.round(amount * 100) / 100, cat: ensureCat(type, r.querySelector('.m-cat').value), method, note: r.querySelector('.m-note').value.trim(), date: r.querySelector('.m-date').value || today() });
    n++;
  });
  if (!n) return toast('No hay movimientos válidos para importar');
  S.lastMethod = method; closeSheet(); commit(); toast(`${n} ${n === 1 ? 'movimiento importado' : 'movimientos importados'}`);
};
