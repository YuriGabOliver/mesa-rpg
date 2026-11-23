// Acesso ao Supabase por HTTP (PostgREST + Storage + Realtime), sem dependências.
// Aceita os nomes de variável da integração Vercel↔Supabase e os nomes "manuais".
const env = (...nomes) => { for (const n of nomes) if (process.env[n]) return process.env[n]; return ''; };
export const URL_ = () => env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const CHAVE = () => env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY');
export const CHAVE_PUBLICA = () => env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

function cab(extra = {}) {
  const k = CHAVE();
  const h = { apikey: k, ...extra };
  if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k; // chaves novas (sb_secret_...) só vão no apikey
  return h;
}
function confere() { if (!URL_() || !CHAVE()) throw new Error('SEM_BANCO'); }

async function chama(url, init, what) {
  let r;
  try { r = await fetch(url, init); } catch (e) { throw new Error(`Supabase fora do ar (${what}): ${e.message}`); }
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Supabase ${r.status} (${what}): ${t.slice(0, 200)}`); }
  return r;
}

// metodo: GET/POST/PATCH/DELETE; caminho: "tabela?filtros"; opts: { corpo, prefer }
export async function rest(metodo, caminho, { corpo, prefer } = {}) {
  confere();
  const r = await chama(`${URL_()}/rest/v1/${caminho}`, {
    method: metodo,
    headers: cab({ 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }, `${metodo} ${caminho.split('?')[0]}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Avisa quem está conectado na mesa (Realtime/Broadcast). Se falhar, o polling lento cobre.
export async function avisa(mesa, v) {
  try {
    confere();
    await fetch(`${URL_()}/realtime/v1/api/broadcast`, {
      method: 'POST', headers: cab({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messages: [{ topic: `mesa-${mesa}`, event: 'mudou', payload: { v }, private: false }] }),
    });
  } catch { /* sem aviso instantâneo, tudo bem */ }
}

export async function subirImagem(caminho, buffer, mime) {
  confere();
  await chama(`${URL_()}/storage/v1/object/mapas/${caminho}`, {
    method: 'POST', headers: cab({ 'Content-Type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }), body: buffer,
  }, 'subir imagem');
}
export async function apagarImagem(caminho) {
  try { confere(); await fetch(`${URL_()}/storage/v1/object/mapas/${caminho}`, { method: 'DELETE', headers: cab() }); } catch { /* ignora */ }
}
