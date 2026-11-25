// Servidor local para testar SEM Vercel e SEM Supabase: node scripts/dev.mjs
// Se SUPABASE_URL não estiver definida, usa um Supabase falso em memória (os dados somem ao fechar).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

// ---------- Supabase falso, em memória (só o que o projeto usa: REST, Storage e Broadcast) ----------
function supabaseFalso() {
  const T = { mesas: [], cenas: [], tokens: [], jogadores: [], nevoa: [], rolagens: [], chat: [] };
  const ident = { nevoa: 0, rolagens: 0, chat: 0 }, arquivos = new Map(), ouvintes = new Map();
  const PK = { mesas: ['id'], cenas: ['mesa', 'id'], tokens: ['mesa', 'id'], jogadores: ['mesa', 'id'] };
  const RESERVADOS = ['select', 'order', 'limit', 'offset', 'on_conflict'];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const filtra = (rows, sp) => {
    for (const [k, v] of sp) {
      if (RESERVADOS.includes(k)) continue;
      const i = v.indexOf('.'), op = v.slice(0, i), val = v.slice(i + 1);
      rows = rows.filter((r) => op === 'eq' ? String(r[k]) === val : op === 'lte' ? Number(r[k]) <= Number(val) : false);
    }
    return rows;
  };
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(chunks), H = { ...cors };
      const fim = (c, d, tipo = 'application/json') => { res.writeHead(c, { ...H, 'Content-Type': tipo }); res.end(d); };
      if (req.method === 'OPTIONS') return fim(204, '');
      try {
        if (url.pathname === '/_sse') {
          res.writeHead(200, { ...H, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': ok\n\n');
          const t = url.searchParams.get('topic'); if (!ouvintes.has(t)) ouvintes.set(t, new Set()); ouvintes.get(t).add(res);
          return res.on('close', () => ouvintes.get(t).delete(res));
        }
        if (url.pathname === '/realtime/v1/api/broadcast') {
          for (const m of JSON.parse(corpo).messages) for (const r of ouvintes.get(m.topic) || []) r.write(`data: ${JSON.stringify(m)}\n\n`);
          return fim(202, '');
        }
        if (url.pathname.startsWith('/storage/v1/object/')) {
          const pub = url.pathname.startsWith('/storage/v1/object/public/');
          const caminho = url.pathname.replace(pub ? '/storage/v1/object/public/' : '/storage/v1/object/', '');
          if (req.method === 'POST' && caminho === 'list/mapas') { const pre = JSON.parse(corpo).prefix + '/'; return fim(200, JSON.stringify([...arquivos.keys()].filter((k) => k.startsWith('mapas/' + pre)).map((k) => ({ name: k.slice(6 + pre.length), id: 'x' })))); }
          if (req.method === 'DELETE' && caminho === 'mapas') { for (const p of JSON.parse(corpo).prefixes) arquivos.delete('mapas/' + p); return fim(200, '[]'); }
          if (req.method === 'POST') { arquivos.set(caminho, { buf: corpo, mime: req.headers['content-type'] }); return fim(200, '{"Key":"ok"}'); }
          if (req.method === 'DELETE') { arquivos.delete(caminho); return fim(200, '{}'); }
          const f = arquivos.get(caminho); if (!f) return fim(404, '{"error":"not found"}');
          return fim(200, f.buf, f.mime);
        }
        const mm = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
        if (!mm || !T[mm[1]]) return fim(404, '{"message":"rota desconhecida no Supabase falso"}');
        const tab = mm[1], sp = url.searchParams, prefer = req.headers.prefer || '';
        if (req.method === 'GET') {
          let rows = filtra(T[tab], sp);
          const ord = sp.get('order');
          if (ord) {
            const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')));
            const regras = ord.split(',').map((o) => o.split('.'));
            rows = [...rows].sort((a, b) => { for (const [c, d] of regras) { const r = cmp(a[c], b[c]) * (d === 'desc' ? -1 : 1); if (r) return r; } return 0; });
          }
          const off = Number(sp.get('offset') || 0), lim = sp.get('limit') ? Number(sp.get('limit')) : undefined;
          rows = rows.slice(off, lim === undefined ? undefined : off + lim);
          const sel = sp.get('select');
          if (sel && sel !== '*') { const cols = sel.split(','); rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))); }
          return fim(200, JSON.stringify(rows));
        }
        if (req.method === 'POST') {
          const novos = [].concat(JSON.parse(corpo)), conf = (sp.get('on_conflict') || '').split(',').filter(Boolean);
          for (const n of novos) {
            const chaves = conf.length ? conf : PK[tab];
            const ex = chaves ? T[tab].find((r) => chaves.every((c) => r[c] === n[c])) : null;
            if (ex && prefer.includes('merge-duplicates')) Object.assign(ex, n);
            else if (ex) return fim(409, '{"message":"duplicate key"}');
            else { if (tab in ident) n.id = ++ident[tab]; if (tab === 'mesas') n.usado = n.criado = new Date().toISOString(); T[tab].push({ ...n }); }
          }
          return fim(201, '');
        }
        if (req.method === 'PATCH') { const p = JSON.parse(corpo); filtra(T[tab], sp).forEach((r) => Object.assign(r, p)); return fim(204, ''); }
        if (req.method === 'DELETE') { const del = new Set(filtra(T[tab], sp)); T[tab] = T[tab].filter((r) => !del.has(r)); return fim(204, ''); }
        return fim(405, '{}');
      } catch (e) { return fim(500, JSON.stringify({ message: e.message })); }
    });
  });
}

if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  supabaseFalso().listen(PORT + 1, '127.0.0.1');
  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT + 1}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'dev';
  if (process.env.DEV_REALTIME) process.env.SUPABASE_ANON_KEY = 'dev'; // só para os testes automáticos
  console.log('Usando Supabase falso em memória (os dados somem ao fechar).');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const nome = url.pathname.replace('/api/', '').replace(/[^a-z0-9_]/gi, '');
      const arq = path.join(raiz, 'api', nome + '.js');
      if (nome.startsWith('_') || !fs.existsSync(arq)) { res.statusCode = 404; return res.end('{"erro":"não existe"}'); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString();
      req.query = Object.fromEntries(url.searchParams);
      req.body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : raw;
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      res.send = (d) => { res.end(d); return res; };
      const mod = await import(pathToFileURL(arq).href);
      return await mod.default(req, res);
    }
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const arq = path.join(raiz, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!arq.startsWith(raiz) || arq.includes(path.join(raiz, 'api')) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.statusCode = 404; return res.end('404'); }
    res.setHeader('Content-Type', MIME[path.extname(arq)] || 'application/octet-stream');
    res.end(fs.readFileSync(arq));
  } catch (e) { console.error(e); res.statusCode = 500; res.end('erro'); }
}).listen(PORT, () => console.log(`Mesa Leve em http://localhost:${PORT}`));
