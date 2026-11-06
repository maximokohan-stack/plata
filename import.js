'use strict';
/* Importar movimientos: desde un CSV (sin IA) o desde capturas / PDF (con la IA que elijas).
   Los dos caminos terminan en la misma vista previa: "Nuevos", "Posibles repetidos" (se muestra con qué se parece y decidís vos)
   y "Revisar" (datos dudosos: fecha incierta, importe ambiguo…). Se puede asignar la cuenta, hay un total de control y la importación se puede deshacer. */

// Solo se mandan a la IA las categorías de fábrica (no tus categorías propias); lo que no encaje se acomoda acá.
const IMPORT_PROMPT = () => `Sos un lector de resúmenes y capturas de movimientos de cuentas (Mercado Pago, bancos, tarjetas) de Argentina. Hoy es ${today()}. Respondé SOLO con un JSON (sin markdown ni texto extra) con esta forma:
{"movements":[{"date":"YYYY-MM-DD"|null,"description":string,"amount":number,"kind":"gasto"|"ingreso","category":string}]}
Reglas:
- Incluí solo movimientos ya realizados: pagos, compras, débitos, y también ingresos o cobros recibidos. Ignorá saldos, totales, límites, cuotas futuras, publicidad y movimientos pendientes.
- "amount" siempre positivo, en pesos, con punto decimal. Formato argentino: "1.234,50" significa 1234.5. "kind" es "gasto" si salió plata y "ingreso" si entró.
- Fechas: si falta el año, usá el más reciente que no sea futuro respecto de hoy. Si no hay fecha, null. No inventes fechas.
- "description": comercio o concepto, corto y legible (ej. "Subte", "Mercado Libre").
- "category": la más cercana de esta lista. Gastos: ${CATS.gasto.map(c => c[0]).join(', ')}. Ingresos: ${CATS.ingreso.map(c => c[0]).join(', ')}. Si ninguna encaja, "Otros" (gasto) u "Otros ingresos".
- No incluyas transferencias entre cuentas propias.
- Una fila por movimiento; si el mismo movimiento aparece en varias capturas, incluilo una sola vez.
- Si no hay movimientos, devolvé {"movements":[]}.`;

const catOpts = (kind, sel) => allCats(kind).map(c => `<option ${norm(c) === norm(sel) ? 'selected' : ''}>${esc(c)}</option>`).join('');
const fingerprint = Core.fingerprint;
let imp = { rows: [], source: '', hasHeader: true, csv: null };

// ---------- paso 1: elegir de dónde importar ----------
function openImport() {
  const cfg = typeof getCfg === 'function' ? getCfg() : null, who = cfg?.apiKey ? `${PROVIDERS[cfg.provider].name} (modelo ${esc(cfg.model)})` : 'tu proveedor de IA';
  sheet('Importar movimientos', `<div style="display:grid;gap:14px">
    <div class="card" style="margin:0;display:grid;gap:8px"><b>Desde un archivo CSV</b>
      <p class="muted" style="margin:0;font-size:14px">El que descargás del home banking o de la billetera. Funciona sin IA y el archivo no sale de tu celular.</p>
      <label class="btn sm" style="cursor:pointer;justify-self:start">Elegir un CSV<input type="file" id="csv-file" accept=".csv,.txt,text/csv,text/plain" hidden></label><span id="csv-status" class="muted" style="font-size:13px"></span></div>
    <div class="card ai-only" style="margin:0;display:grid;gap:8px"><b>Desde capturas o PDF (con IA)</b>
      <p class="muted" style="margin:0;font-size:14px">La IA lee los movimientos y te los muestra para que revises todo antes de importar.</p>
      <label class="btn sm" style="cursor:pointer;justify-self:start">Elegir capturas o PDF<input type="file" id="imp-file" accept="image/*,application/pdf" multiple hidden></label><span id="imp-status" class="muted" style="font-size:13px"></span>
      <p class="muted" style="margin:0;font-size:12.5px"><b>Qué se envía:</b> solo las imágenes o PDF que elijas, a ${who}, con tu API key. No se envían tus movimientos ni el resto de tus datos.</p></div>
    <div id="imp-wrap"></div></div>`);
}

// ---------- CSV: elegir columnas ----------
const colOpts = (header, sel, none) => `${none ? '<option value="-1">— no tiene —</option>' : ''}${header.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('')}`;
function csvStep(parsed) {
  const rows = parsed.rows, first = rows[0], guess = Core.guessColumns(first), looksHeader = guess.date >= 0 || guess.amount >= 0 || guess.debit >= 0;
  imp.csv = { rows, header: looksHeader ? first : first.map((_, i) => 'Columna ' + (i + 1)), hasHeader: looksHeader };
  const g = looksHeader ? guess : { date: 0, desc: 1, amount: 2, debit: -1, credit: -1 };
  const sample = rows.slice(0, 4).map(r => `<tr>${r.map(c => `<td>${esc(c).slice(0, 22)}</td>`).join('')}</tr>`).join('');
  $('#imp-wrap').innerHTML = `<h3>Elegí qué es cada columna</h3>
    <p class="muted" style="margin:0;font-size:13.5px">Separador reconocido: <b>${parsed.delimiter === '\t' ? 'tabulación' : '“' + parsed.delimiter + '”'}</b> · ${rows.length} filas. Así empieza el archivo:</p>
    <div style="overflow-x:auto"><table class="csvprev">${sample}</table></div>
    <label style="flex-direction:row;display:flex;gap:10px;align-items:center"><input type="checkbox" id="csv-hdr" ${looksHeader ? 'checked' : ''}><span>La primera fila son los títulos</span></label>
    <div class="grid2" style="margin:0"><label>Fecha<select id="csv-date">${colOpts(imp.csv.header, g.date)}</select></label><label>Descripción<select id="csv-desc">${colOpts(imp.csv.header, g.desc >= 0 ? g.desc : 0)}</select></label></div>
    <label>Importe (con signo: negativo = gasto)<select id="csv-amount">${colOpts(imp.csv.header, g.amount, true)}</select></label>
    <div class="grid2" style="margin:0"><label>…o Débito (gastos)<select id="csv-debit">${colOpts(imp.csv.header, g.debit, true)}</select></label><label>Crédito (ingresos)<select id="csv-credit">${colOpts(imp.csv.header, g.credit, true)}</select></label></div>
    <label>Formato de las fechas<select id="csv-order"><option value="dmy">día/mes/año (25/12/2026)</option><option value="mdy">mes/día/año (12/25/2026)</option></select></label>
    <button class="btn block" data-act="csvgo">Ver vista previa</button>`;
}
act.csvgo = () => {
  const c = imp.csv, hdr = $('#csv-hdr').checked, map = { date: +$('#csv-date').value, desc: +$('#csv-desc').value, amount: +$('#csv-amount').value, debit: +$('#csv-debit').value, credit: +$('#csv-credit').value };
  if (map.date < 0) return toast('Elegí la columna de la fecha');
  if (map.amount < 0 && map.debit < 0 && map.credit < 0) return toast('Elegí la columna del importe (o débito y crédito)');
  const { items } = Core.csvToMovements(hdr ? c.rows.slice(1) : c.rows, map, { dateOrder: $('#csv-order').value });
  startPreview(items.map(m => ({ date: m.date, amount: m.amount, kind: m.kind || 'gasto', description: m.description, category: '', issues: m.issues, unusable: m.unusable })), 'CSV');
};

// ---------- vista previa común ----------
function classify(rows) {
  rows.forEach(r => {
    r.dups = r.unusable || !(r.amount > 0) || !r.date ? [] : Core.findDuplicates({ kind: r.kind, amount: r.amount, date: r.date }, S.tx);
    r.group = r.dups.length ? 'dup' : r.issues.length || r.unusable ? 'review' : 'new';
  });
}
function startPreview(rows, source) {
  imp.rows = rows; imp.source = source; classify(rows);
  if (!rows.length) { $('#imp-wrap').innerHTML = '<p class="warn">No encontré movimientos en ese archivo.</p>'; return; }
  const gc = k => rows.filter(r => r.group === k).length;
  $('#imp-wrap').innerHTML = `<h3>Vista previa</h3>
    <p class="muted" style="margin:0;font-size:13.5px">${rows.length} movimientos leídos de ${esc(source)}: <b>${gc('new')} nuevos</b>, <b>${gc('dup')} posibles repetidos</b>, <b>${gc('review')} para revisar</b>. No se importa nada hasta que toques el botón de abajo.</p>
    ${accSelect('impacc', S.lastMethod || '', 'Sin cuenta', 'Cuenta para todos los movimientos', false)}
    ${['new', 'dup', 'review'].map(k => gc(k) ? `<h3>${k === 'new' ? 'Nuevos' : k === 'dup' ? 'Posibles repetidos: decidí cada uno' : 'Revisar antes de importar'}</h3><div class="prows">${rows.map((r, i) => r.group === k ? impRow(r, i) : '').join('')}</div>` : '').join('')}
    <div class="card" id="imp-ctl" style="margin:12px 0 0"></div>
    <button class="btn block" id="imp-go" data-act="impgo" style="margin-top:12px"></button>`;
  impUpdate();
}
const accOpts = sel => `<option value="">Sin cuenta</option>${allMethods().map(m => `<option value="${esc(m)}" ${norm(m) === norm(sel) ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
function impRow(r, i) {
  const cat = r.category || (r.kind === 'ingreso' ? 'Otros ingresos' : 'Otros');
  const sel = r.group === 'dup'
    ? `<div class="cmpdup">${r.dups.slice(0, 2).map(d => `<div class="warn" style="font-size:13px"><b>Se parece a uno ya cargado:</b> ${money(d.tx.amount)} · ${esc(d.tx.note || d.tx.cat)} · ${dayLabel(d.tx.date)}${d.tx.method ? ' · ' + esc(d.tx.method) : ''} (${d.days === 0 ? 'misma fecha y monto' : 'mismo monto, ' + d.days + (d.days === 1 ? ' día' : ' días') + ' de diferencia'})</div>`).join('')}
        <div class="seg" role="radiogroup" aria-label="Qué hacer con este movimiento"><label><input type="radio" name="dec${i}" value="import" class="m-dec"><span>Importar igual</span></label><label><input type="radio" name="dec${i}" value="skip" class="m-dec"><span>Es el mismo: omitir</span></label></div></div>`
    : `<label style="flex-direction:row;display:flex;gap:10px;align-items:center"><input type="checkbox" class="m-on" ${r.group === 'new' ? 'checked' : ''} ${r.unusable ? 'disabled' : ''}><span>${r.group === 'review' ? (r.unusable ? 'Corregí lo que falta para poder importarlo' : 'Importar (ya lo revisé)') : 'Importar'}</span></label>`;
  return `<div class="irow" data-i="${i}"><div class="imp-top"><input type="text" class="m-note" value="${esc(r.description)}" aria-label="Descripción">${MI(`<input type="text" class="m-amt" inputmode="decimal" value="${r.amount > 0 ? fmtIn(r.amount) : ''}" aria-label="Monto">`)}</div>
    <div class="imp-bot"><input type="date" class="m-date" value="${r.date || ''}" aria-label="Fecha"><select class="m-kind" aria-label="Tipo"><option value="gasto" ${r.kind === 'gasto' ? 'selected' : ''}>Gasto</option><option value="ingreso" ${r.kind === 'ingreso' ? 'selected' : ''}>Ingreso</option></select>
    <select class="m-cat" aria-label="Categoría">${catOpts(r.kind, cat)}</select></div>
    <select class="m-acc" aria-label="Cuenta de este movimiento">${accOpts(S.lastMethod || '')}</select>
    ${r.issues.length ? `<div class="warn" style="font-size:13px">⚠ ${r.issues.map(esc).join(' · ')}</div>` : ''}${sel}</div>`;
}
// lo que se va a importar según lo marcado y decidido, tal como está escrito en pantalla
function impSelected() {
  const out = [];
  document.querySelectorAll('#imp-wrap .irow').forEach(row => {
    const r = imp.rows[+row.dataset.i], on = r.group === 'dup' ? row.querySelector('.m-dec:checked')?.value === 'import' : row.querySelector('.m-on')?.checked;
    const amount = parseAmount(row.querySelector('.m-amt').value), date = row.querySelector('.m-date').value, kind = row.querySelector('.m-kind').value;
    out.push({ on: !!on, amount, date, kind, cat: row.querySelector('.m-cat').value, note: row.querySelector('.m-note').value.trim(), acc: row.querySelector('.m-acc').value, undecided: r.group === 'dup' && !row.querySelector('.m-dec:checked'), valid: amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) });
  });
  return out;
}
function impUpdate() {
  const sel = impSelected(), pick = sel.filter(x => x.on), bad = pick.filter(x => !x.valid).length, undec = sel.filter(x => x.undecided).length;
  const inc = Core.sumC(pick.filter(x => x.valid && x.kind === 'ingreso').map(x => Core.toCents(x.amount))), exp = Core.sumC(pick.filter(x => x.valid && x.kind === 'gasto').map(x => Core.toCents(x.amount)));
  const expect = parseAmount($('#imp-expect')?.value);
  $('#imp-ctl').innerHTML = `<div class="label">Total de control (lo que se va a importar)</div>
    <div class="cmp3" style="grid-template-columns:1fr auto"><span>Movimientos</span><span class="n">${pick.length}</span><span>Ingresos</span><span class="n pos">${money(inc / 100)}</span><span>Gastos</span><span class="n neg">${money(exp / 100)}</span><span>Neto</span><span class="n">${money((inc - exp) / 100)}</span></div>
    <label style="margin-top:8px">Total de gastos del resumen (opcional, para comparar)<span class="mi"><span class="cur" aria-hidden="true">$</span><input type="text" id="imp-expect" inputmode="decimal" placeholder="0" value="${$('#imp-expect')?.value || ''}"></span></label>
    ${isFinite(expect) ? (Math.abs(expect * 100 - exp) < 1 ? '<div class="pos" style="font-size:14px;margin-top:4px">✓ Coincide con los gastos que vas a importar.</div>' : `<div class="warn" style="font-size:14px;margin-top:4px">⚠ No coincide: el resumen dice ${money(expect)} y vas a importar ${money(exp / 100)} (diferencia ${money(Math.abs(expect * 100 - exp) / 100)}).</div>`) : ''}`;
  const b = $('#imp-go'); if (!b) return;
  b.disabled = !pick.length || bad > 0 || undec > 0;
  b.textContent = undec ? `Falta decidir ${undec} ${undec === 1 ? 'repetido' : 'repetidos'}` : bad ? `Corregí ${bad} ${bad === 1 ? 'movimiento' : 'movimientos'} (falta fecha o importe)` : pick.length ? `Importar ${pick.length} ${pick.length === 1 ? 'movimiento' : 'movimientos'}` : 'Elegí al menos uno';
}

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.name === 'impacc') { document.querySelectorAll('#imp-wrap .m-acc').forEach(s => { s.value = t.value; }); return; }
  if (t.matches?.('.m-kind')) { const r = t.closest('.irow'); r.querySelector('.m-cat').innerHTML = catOpts(t.value, ''); impUpdate(); return; }
  if (t.matches?.('#imp-wrap .m-on, #imp-wrap .m-dec, #imp-wrap .m-date, #imp-wrap .m-acc')) { impUpdate(); return; }
  if (t.id === 'csv-file') {
    const file = t.files[0]; t.value = ''; if (!file) return;
    const st = $('#csv-status'); if (file.size > 5e6) { st.className = 'warn'; st.textContent = 'El archivo es muy grande (máx. 5 MB).'; return; }
    const p = Core.parseCSV(await file.text());
    if (!p.ok || p.rows.length < 2) { st.className = 'warn'; st.textContent = p.error || 'El archivo no tiene filas para importar.'; return; }
    st.className = 'muted'; st.textContent = `${file.name}: ${p.rows.length} filas`; csvStep(p); return;
  }
  if (t.id !== 'imp-file') return;
  const files = [...t.files].slice(0, 6); t.value = ''; if (!files.length) return;
  const st = $('#imp-status');
  if (!getCfg().apiKey) { st.className = 'warn'; st.textContent = 'Falta tu API key. Cerrá esto, tocá ✨ arriba a la derecha, luego ⚙, pegala y guardá.'; return; }
  st.className = 'muted'; st.textContent = `Leyendo ${files.length === 1 ? 'el archivo' : files.length + ' archivos'}…`;
  try {
    const blocks = await Promise.all(files.map(fileToBlock));
    const out = parseJsonLoose(await askLLM(IMPORT_PROMPT(), [...blocks, { type: 'text', text: 'Extraé los movimientos.' }], 8000));
    const rows = (out.movements || []).map(m => {
      const issues = [], okDate = /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') && Core.parseDate(m.date).value, amount = Math.abs(Number(m.amount));
      if (!okDate) issues.push('la IA no encontró la fecha: revisala antes de importar');
      const kind = m.kind === 'ingreso' ? 'ingreso' : 'gasto', known = allCats(kind).find(c => norm(c) === norm(m.category));
      if (!known) issues.push('categoría sugerida no reconocida: puse “Otros”');
      return { date: okDate ? m.date : '', amount, kind, description: String(m.description || '').trim() || 'Movimiento', category: known || '', issues, unusable: !isFinite(amount) || !(amount > 0) || !okDate };
    }).filter(r => isFinite(r.amount) && r.amount > 0);
    if (!$('#imp-wrap')) return;
    st.textContent = ''; if (!rows.length) { st.className = 'warn'; st.textContent = 'No encontré movimientos. Probá con una captura más nítida o el PDF del resumen.'; return; }
    startPreview(rows, 'las capturas');
  } catch (err) { st.className = 'warn'; st.textContent = err.message || 'No se pudo leer el archivo.'; }
});
document.addEventListener('input', e => { if (e.target.closest?.('#imp-wrap .irow') || e.target.id === 'imp-expect') impUpdate(); });

act.importmov = openImport;
act.impgo = () => {
  const sel = impSelected().filter(x => x.on);
  if (!sel.length || sel.some(x => !x.valid)) return toast('Revisá los movimientos marcados');
  const id = uid(), items = [];
  for (const x of sel) {
    const t = { id: uid(), type: x.kind, amount: Core.round2(x.amount), cat: ensureCat(x.kind, x.cat), note: x.note, date: x.date, imp: id, ...(x.acc ? { method: ensureMethod(x.acc) } : {}) };
    S.tx.push(t); items.push({ id: t.id, fp: fingerprint(t) });
  }
  const sum2 = k => Core.sumC(sel.filter(x => x.kind === k).map(x => Core.toCents(x.amount))) / 100;
  (S.imports ||= []).push({ id, at: new Date().toISOString(), source: imp.source, n: sel.length, ingresos: sum2('ingreso'), gastos: sum2('gasto'), items });
  S.imports = S.imports.slice(-20); S.lastMethod = sel.find(x => x.acc)?.acc || S.lastMethod;
  const n = sel.length, summary = { n, ingresos: sum2('ingreso'), gastos: sum2('gasto') };
  commit().then(ok => {
    if (!ok) return;
    sheet('Importación lista', `<p style="margin:0">Se importaron <b>${n}</b> ${n === 1 ? 'movimiento' : 'movimientos'}: ingresos ${money(summary.ingresos)} · gastos ${money(summary.gastos)}.</p>
      <p class="muted" style="margin:0;font-size:13.5px">Si algo salió mal, podés deshacer esta importación ahora o más tarde desde Ajustes. Solo se quitan los movimientos que no cambiaste.</p>
      <button class="btn block" data-act="close">Listo</button><button class="btn ghost block" data-act="impundo" data-id="${id}">Deshacer esta importación</button>`);
  });
};
// deshacer: quita solo lo importado que sigue igual; lo que editaste se queda y se avisa
act.impundo = el => {
  const b = (S.imports || []).find(x => x.id === el.dataset.id); if (!b) return toast('No encontré esa importación');
  const st = it => { const t = S.tx.find(x => x.id === it.id); return !t ? 'gone' : fingerprint(t) === it.fp ? 'same' : 'changed'; };
  const same = b.items.filter(it => st(it) === 'same').length, changed = b.items.filter(it => st(it) === 'changed').length, gone = b.items.length - same - changed;
  if (!confirm(`¿Deshacer la importación de ${b.n} movimientos? Se van a quitar ${same}${changed ? ` (${changed} que editaste se quedan)` : ''}${gone ? ` (${gone} ya no estaban)` : ''}.`)) return;
  const r = Core.undoImport(S, b.id);
  commit().then(ok => { if (ok) { closeSheet(); toast(`Importación deshecha: se quitaron ${r.removed}`); } });
};
// lista en Ajustes
function importsHtml() {
  const l = (S.imports || []).slice(-5).reverse();
  return l.length ? `<h3>Importaciones recientes</h3><div class="list">${l.map(b => `<div class="item"><div class="grow"><div class="t">${b.n} movimientos · ${esc(b.source)}</div><div class="s">${niceDate(b.at)} · gastos ${money(b.gastos)} · ingresos ${money(b.ingresos)}</div></div><button class="btn ghost sm" data-act="impundo" data-id="${b.id}">Deshacer</button></div>`).join('')}</div>` : '';
}
