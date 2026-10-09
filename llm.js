'use strict';
/* Capa de proveedores de IA. Cada persona usa SU key y SU cuenta: Anthropic, OpenAI (ChatGPT), Google Gemini u OpenRouter.
   Internamente todo se habla en formato "bloques" (text / image / document / tool_use / tool_result)
   y cada adaptador lo traduce al formato de su API. La key vive solo en este dispositivo. */

const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', keyUrl: 'console.anthropic.com', keyHint: 'sk-ant-…', def: 'claude-opus-5-5',
    note: 'Se paga por uso con crédito prepago.',
    models: { 'claude-opus-5-5': 'Opus 5.5 · el más capaz', 'claude-sonnet-5-5': 'Sonnet 5.5 · equilibrado', 'claude-haiku-5-5': 'Haiku 5.5 · el más barato' } },
  openai: { name: 'OpenAI (ChatGPT)', keyUrl: 'platform.openai.com/api-keys', keyHint: 'sk-…', def: 'gpt-5-mini',
    note: 'La API se paga aparte de la suscripción a ChatGPT: hace falta cargar crédito en platform.openai.com.',
    models: { 'gpt-5-mini': 'GPT-5 mini · equilibrado y barato', 'gpt-5': 'GPT-5 · el más capaz' } },
  gemini: { name: 'Google Gemini', keyUrl: 'aistudio.google.com/apikey', keyHint: 'AIza…', def: 'gemini-3.7-flash',
    note: 'Suele tener un plan gratuito con límites; mirá los vigentes en su sitio.', models: {} },
  openrouter: { name: 'OpenRouter (muchos modelos)', keyUrl: 'openrouter.ai/keys', keyHint: 'sk-or-…', def: 'google/gemma-4-31b-it:free',
    note: 'Un solo acceso a cientos de modelos; algunos son gratuitos (con límites).', models: {} }
};

// ---------- configuración (por proveedor) ----------
const CFG_KEY = 'plata.cfg';
function readCfgRaw() {
  let c = {}; try { c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch { }
  if (c.apiKey && !c.keys) c = { provider: 'anthropic', keys: { anthropic: c.apiKey }, models: { anthropic: c.model || PROVIDERS.anthropic.def } };   // formato viejo
  return { provider: PROVIDERS[c.provider] ? c.provider : 'anthropic', keys: c.keys || {}, models: c.models || {} };
}
function getCfg(provider) {
  const c = readCfgRaw(), p = provider || c.provider;
  return { provider: p, apiKey: c.keys[p] || '', model: c.models[p] || PROVIDERS[p].def, active: c.provider };
}
// setCfg({provider?, apiKey?, model?}) — se aplica al proveedor indicado (o al activo)
function setCfg(p) {
  const c = readCfgRaw(); if (p.provider && PROVIDERS[p.provider]) c.provider = p.provider;
  if ('apiKey' in p) c.keys[c.provider] = p.apiKey;
  if (p.model) c.models[c.provider] = p.model;
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { }
  syncAi();
}
function clearKey(provider) {
  const c = readCfgRaw(); delete c.keys[provider];
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { }
  syncAi();
}
// las funciones de IA solo aparecen si hay una API key cargada
function syncAi() { document.body.classList.toggle('has-ai', !!getCfg().apiKey); }

// ---------- llamada unificada ----------
const rawErr = (res, data, cfg) => {
  const m = data?.error?.message || data?.error?.type || res.statusText;
  if (res.status === 401 || res.status === 403) return new Error('La API key no es válida o no tiene permiso. Revisala en ⚙.');
  if (res.status === 429) return new Error('Demasiados pedidos o sin crédito/cuota. Probá en un rato.');
  if (res.status === 404 || (res.status === 400 && /model/i.test(String(m)) && /(not found|not exist|invalid|unknown|no endpoints)/i.test(String(m))))
    return new Error(`El modelo "${cfg.model}" no está disponible en ${PROVIDERS[cfg.provider].name}. Elegí otro en ⚙ con "Ver modelos disponibles".`);
  return new Error(`Error ${res.status}: ${m}`);
};
const postJson = async (url, headers, body, cfg) => {
  let res; try { res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
  catch { throw new Error('No se pudo conectar. ¿Tenés internet?'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw rawErr(res, data, cfg);
  return data;
};

// req: { system, messages, tools?, maxTokens, effort? }  ->  { content: bloques, stop: 'end_turn'|'tool_use'|'max_tokens'|'refusal' }
async function llm(req) {
  const cfg = getCfg();
  if (!cfg.apiKey) throw new Error('Falta tu API key (⚙).');
  return ({ anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini, openrouter: callOpenRouter }[cfg.provider])(cfg, req);
}

async function callAnthropic(cfg, req) {
  const data = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    { model: cfg.model, max_tokens: req.maxTokens || 4000, system: req.system, ...(req.tools?.length ? { tools: req.tools } : {}), messages: req.messages, output_config: { effort: req.effort || 'medium' } }, cfg);
  return { content: data.content || [], stop: data.stop_reason === 'tool_use' ? 'tool_use' : data.stop_reason === 'max_tokens' ? 'max_tokens' : data.stop_reason === 'refusal' ? 'refusal' : 'end_turn' };
}

// Formato "chat completions": lo hablan OpenAI y OpenRouter (cambian la dirección y el nombre del tope de tokens)
const callOpenAI = (cfg, req) => callChat(cfg, req, 'https://api.openai.com/v1/chat/completions', { max_completion_tokens: (req.maxTokens || 4000) * 2 + 4000 });   // los modelos que razonan gastan parte del tope pensando
const callOpenRouter = (cfg, req) => callChat(cfg, req, 'https://openrouter.ai/api/v1/chat/completions', { max_tokens: req.maxTokens || 4000 });
async function callChat(cfg, req, url, limit) {
  const part = b => b.type === 'text' ? { type: 'text', text: b.text }
    : b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
    : { type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b.source.data}` } };
  const msgs = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (typeof m.content === 'string') { msgs.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join(''), calls = m.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      msgs.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      m.content.filter(b => b.type === 'tool_result').forEach(b => msgs.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) }));
      const rest = m.content.filter(b => b.type !== 'tool_result'); if (rest.length) msgs.push({ role: 'user', content: rest.map(part) });
    }
  }
  const data = await postJson(url, { authorization: 'Bearer ' + cfg.apiKey },
    { model: cfg.model, ...limit, messages: msgs, ...(req.tools?.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}) }, cfg);
  if (data.error) throw new Error(data.error.message || 'Error del proveedor');
  const ch = data.choices?.[0], msg = ch?.message || {}, out = [];
  const text = Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : (msg.content || '');
  if (text) out.push({ type: 'text', text });
  for (const c of msg.tool_calls || []) { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch { } out.push({ type: 'tool_use', id: c.id, name: c.function.name, input }); }
  return { content: out, stop: out.some(b => b.type === 'tool_use') ? 'tool_use' : ch?.finish_reason === 'length' ? 'max_tokens' : ch?.finish_reason === 'content_filter' ? 'refusal' : 'end_turn' };
}

// Google Gemini
async function callGemini(cfg, req) {
  const names = {}, contents = [];
  for (const m of req.messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') { contents.push({ role, parts: [{ text: m.content }] }); continue; }
    const parts = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'image') parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      else if (b.type === 'document') parts.push({ inlineData: { mimeType: 'application/pdf', data: b.source.data } });
      else if (b.type === 'tool_use') { names[b.id] = b.name; parts.push(b._gem || { functionCall: { name: b.name, args: b.input || {} } }); }
      else if (b.type === 'tool_result') parts.push({ functionResponse: { name: names[b.tool_use_id] || 'tool', response: b.is_error ? { error: String(b.content) } : { output: String(b.content) } } });
    }
    if (parts.length) contents.push({ role, parts });
  }
  const data = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { 'x-goog-api-key': cfg.apiKey },
    { contents, systemInstruction: { parts: [{ text: req.system }] }, generationConfig: { maxOutputTokens: req.maxTokens || 4000 },
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }] } : {}) }, cfg);
  if (data.promptFeedback?.blockReason) return { content: [], stop: 'refusal' };
  const cand = data.candidates?.[0], out = [];
  for (const p of cand?.content?.parts || []) {
    if (p.functionCall) out.push({ type: 'tool_use', id: uid(), name: p.functionCall.name, input: p.functionCall.args || {}, _gem: p });
    else if (p.text && !p.thought) out.push({ type: 'text', text: p.text });
  }
  const fr = cand?.finishReason;
  return { content: out, stop: out.some(b => b.type === 'tool_use') ? 'tool_use' : fr === 'MAX_TOKENS' ? 'max_tokens' : ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(fr) ? 'refusal' : 'end_turn' };
}

// texto plano a partir de una respuesta (para lectura de tickets / movimientos)
async function askLLM(system, content, maxTokens = 4000) {
  const r = await llm({ system, messages: [{ role: 'user', content }], maxTokens, effort: 'medium' });
  if (r.stop === 'refusal') throw new Error('El modelo no pudo procesar ese archivo.');
  if (r.stop === 'max_tokens') throw new Error('El documento es muy largo. Probá con una parte.');
  return r.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ---------- modelos disponibles (en vivo) ----------
async function listModels(provider, apiKey) {
  const get = async (url, headers = {}) => { let r; try { r = await fetch(url, { headers }); } catch { throw new Error('No se pudo conectar. ¿Tenés internet?'); } const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(r.status === 400 || r.status === 401 || r.status === 403 ? 'La API key no es válida.' : `Error ${r.status}`); return d; };
  if (provider === 'openrouter') {
    const d = await get('https://openrouter.ai/api/v1/models');
    return d.data.filter(m => (m.architecture?.input_modalities || []).includes('image') && (m.supported_parameters || []).includes('tools'))
      .map(m => ({ id: m.id, free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0, name: m.name || m.id }))
      .sort((a, b) => b.free - a.free || a.id.localeCompare(b.id));
  }
  if (provider === 'openai') {
    if (!apiKey) throw new Error('Pegá tu API key primero para ver los modelos.');
    const d = await get('https://api.openai.com/v1/models', { authorization: 'Bearer ' + apiKey });
    return (d.data || []).filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|whisper|dall|codex|computer|deep-research)/.test(m.id))
      .map(m => ({ id: m.id, free: false, name: m.id })).sort((a, b) => b.id.localeCompare(a.id));
  }
  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Pegá tu API key primero para ver los modelos.');
    const d = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': apiKey });
    return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
      .map(m => ({ id: m.name.replace(/^models\//, ''), free: false, name: m.displayName || m.name })).sort((a, b) => b.id.localeCompare(a.id));
  }
  if (!apiKey) throw new Error('Pegá tu API key primero para ver los modelos.');
  const d = await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  return (d.data || []).map(m => ({ id: m.id, free: false, name: m.display_name || m.id }));
}
