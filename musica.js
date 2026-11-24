// Música sincronizada da Mesa Leve (mesma ideia do Tracks do Owlbear, escrita do zero para esta mesa).
// O mestre escolhe uma faixa (link público de áudio); o servidor carimba a hora; cada navegador toca o mesmo ponto do arquivo, em loop.
// Leve: um único <audio>, sem animação, sem timer fora da aba Música.

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};
const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- link do áudio ---------- */
// Só https. Dropbox vira link direto. Google Drive não funciona como áudio embutido.
export function limpaUrl(txt) {
  let u;
  try { u = new URL(String(txt || '').trim()); } catch { return { erro: 'Link inválido' }; }
  if (u.protocol !== 'https:') return { erro: 'O link precisa começar com https://' };
  if (u.hostname === 'drive.google.com') return { erro: 'Links do Google Drive não funcionam. Use Dropbox ou outro link direto.' };
  if (u.hostname === 'dropbox.com' || u.hostname.endsWith('.dropbox.com')) { u.searchParams.set('dl', '1'); u.hostname = 'dl.dropboxusercontent.com'; }
  return { url: u.href };
}

/* ---------- CSV (colunas title/titulo, url, tags separadas por |; compatível com os CSV do Tracks) ---------- */
export function leCsv(texto) {
  const linhas = []; let campo = '', linha = [], aspas = false;
  const t = String(texto).replace(/^﻿/, '');
  const fechaLinha = () => { linha.push(campo); campo = ''; if (linha.some((x) => x.trim())) linhas.push(linha); linha = []; };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fechaLinha(); }
    else campo += c;
  }
  fechaLinha();
  return linhas;
}
const csvCampo = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const geraCsv = (lib) => 'title,url,tags\n' + lib.map((f) => [f.titulo, f.url, f.tags.join('|')].map(csvCampo).join(',')).join('\n') + '\n';

function faixaDe(titulo, url, tags) {
  titulo = String(titulo || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  const u = limpaUrl(url);
  if (!titulo) return { erro: 'Escreva um título' };
  if (u.erro) return { erro: u.erro };
  const lista = (Array.isArray(tags) ? tags : String(tags || '').split(/[|,]/)).map((x) => String(x).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24)).filter(Boolean).slice(0, 12);
  return { f: { titulo, url: u.url, tags: lista } };
}

/* ---------- player + biblioteca + aba ---------- */
// deps: { toast, agir(acao, dados), souMestre(), onMudou() }
export function criaMusica(deps) {
  const audio = new Audio();
  audio.loop = true; audio.preload = 'none';
  let msg = null, skew = 0, melhorRtt = Infinity, pronto = false, bloqueado = false, timer = null, urlLista = null;
  let vol = Math.min(1, Math.max(0, Number(ls.get('ml.vol', 0.6)) || 0)), mudo = !!ls.get('ml.mudo', false);
  let lib = (ls.get('ml.faixas', []) || []).filter((f) => f && f.url && f.titulo);
  audio.volume = vol; audio.muted = mudo;

  const agora = () => Date.now() + skew; // hora do servidor, estimada
  const durDe = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : msg.dur);
  const posDe = () => (msg.a === 'p' ? (msg.off + (agora() - msg.t) / 1000) % durDe() : msg.off % durDe());
  const salvaLib = () => ls.set('ml.faixas', lib);

  /* relógio: guarda a medição com menor ida-e-volta (a mais confiável) */
  function relogio(servidor, t0, t1) {
    const rtt = t1 - t0;
    melhorRtt *= 1.05; // deixa medições novas entrarem aos poucos
    if (rtt <= melhorRtt) { melhorRtt = rtt; skew = servidor + rtt / 2 - t1; }
  }

  /* tocar o que o servidor mandou */
  function executa() {
    if (!msg) return;
    if (!pronto) return; // quando os metadados chegarem, executa() roda de novo
    const alvo = posDe();
    if (msg.a === 'p') {
      const d = durDe(), dif = Math.abs(audio.currentTime - alvo);
      if (audio.paused || Math.min(dif, d - dif) > 0.4) { try { audio.currentTime = alvo; } catch { /* sem seek ainda */ } }
      if (audio.paused) {
        audio.play().then(() => { if (bloqueado) { bloqueado = false; deps.onMudou(); } }).catch((e) => {
          if (e && e.name === 'AbortError') return; // trocou de faixa no meio
          if (!bloqueado) { bloqueado = true; deps.onMudou(); }
        });
      }
    } else {
      if (!audio.paused) audio.pause();
      try { audio.currentTime = alvo; } catch { /* ok */ }
      if (bloqueado) { bloqueado = false; deps.onMudou(); }
    }
  }
  audio.addEventListener('loadedmetadata', () => { pronto = true; executa(); });
  audio.addEventListener('error', () => { if (msg) deps.toast('Não consegui tocar a música da mesa (link fora do ar?)'); });

  // chamado a cada estado novo do servidor; só reage quando a mensagem mudou (mover token não mexe no som)
  function estado(m) {
    if ((m && m.id) === (msg && msg.id)) return;
    if (!m) { msg = null; pronto = false; bloqueado = false; audio.pause(); audio.removeAttribute('src'); audio.load(); audio.preload = 'none'; return deps.onMudou(); }
    const outraFaixa = !msg || msg.url !== m.url;
    msg = m;
    if (outraFaixa) { pronto = false; audio.preload = 'auto'; audio.src = m.url; } else executa();
    deps.onMudou();
  }

  // navegadores só liberam som depois de um toque do usuário; qualquer toque na tela tenta de novo
  document.addEventListener('pointerdown', () => { if (bloqueado) executa(); }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && msg) executa(); });

  /* ---------- ações do mestre ---------- */
  function tocar(f) {
    const a = new Audio(); let ok = false;
    a.preload = 'metadata';
    const falha = () => { if (!ok) { ok = true; deps.toast('Não consegui abrir esse áudio. O link é público e direto?'); } };
    a.onloadedmetadata = () => {
      if (ok) return; ok = true;
      if (!Number.isFinite(a.duration) || a.duration < 1) return deps.toast('Esse áudio não informa a duração (transmissão ao vivo?).');
      deps.agir('musicaTocar', { url: f.url, titulo: f.titulo, dur: a.duration });
    };
    a.onerror = falha;
    setTimeout(falha, 15000);
    a.src = f.url;
  }

  /* ---------- aba "Música" ---------- */
  function html(mestre) {
    return `
    <div class="sec"><h3>Tocando agora</h3>
      <div id="mu-agora" class="mu-agora"></div>
      <div class="mu-vol"><button class="b mini" data-mu="mudo" id="mu-mudo" title="Silenciar só para você"></button><input type="range" id="mu-vol" min="0" max="100" aria-label="Volume"></div>
      <p class="dica" id="mu-dica"></p>
    </div>
    ${mestre ? `<div class="sec"><h3>Biblioteca</h3>
      <input id="mu-busca" placeholder="Buscar por título ou tag" autocomplete="off" style="width:100%">
      <ul id="mu-lista"></ul>
      <div class="f-add"><button class="b" data-mu="novo">Adicionar faixa</button><button class="b" data-mu="imp">Importar CSV</button><button class="b" data-mu="exp">Exportar CSV</button>
        <input type="file" id="mu-csv" accept=".csv,text/csv" hidden></div>
      <div id="mu-form" hidden>
        <input id="mu-f-tit" maxlength="60" placeholder="Título (ex.: Taverna animada)">
        <input id="mu-f-url" placeholder="Link público do áudio (https://…)" autocomplete="off">
        <input id="mu-f-tags" placeholder="Tags separadas por vírgula (ex.: taverna, alegre)">
        <button class="b prim" data-mu="salvar">Salvar na biblioteca</button>
      </div>
      <p class="dica">Os áudios ficam no seu Dropbox (ou outro link direto e público); a mesa só guarda o link. A biblioteca fica neste navegador: use Exportar CSV para guardar uma cópia. O CSV é o mesmo formato do Tracks (title,url,tags com | entre as tags).</p>
    </div>` : ''}`;
  }

  function lista() {
    const ul = $('#mu-lista'); if (!ul) return;
    urlLista = msg ? msg.url : null;
    const termos = (($('#mu-busca') || {}).value || '').toLowerCase().split(/\s+/).filter(Boolean);
    const itens = lib.map((f, i) => ({ f, i })).filter(({ f }) => { const alvo = (f.titulo + ' ' + f.tags.join(' ')).toLowerCase(); return termos.every((t) => alvo.includes(t)); });
    ul.innerHTML = itens.map(({ f, i }) => `<li data-i="${i}" class="${msg && msg.url === f.url ? 'tocando' : ''}"><button class="b mini" data-mu="tocar" title="Tocar para todos">▶</button><span class="mu-tit"><b>${esc(f.titulo)}</b><small>${esc(f.tags.join(', '))}</small></span><button class="b mini" data-mu="del" title="Remover da biblioteca">✕</button></li>`).join('')
      || `<li class="dica">${lib.length ? 'Nada encontrado.' : 'Biblioteca vazia. Adicione uma faixa ou importe um CSV.'}</li>`;
  }

  function atualiza(mestre) {
    const el = $('#mu-agora'); if (!el) return;
    if (!msg) el.innerHTML = '<span class="dica" style="margin:0">Nada tocando.</span>';
    else {
      const ctl = mestre ? `<div class="mu-ctl">${msg.a === 'p' ? '<button class="b" data-mu="pausar">⏸ Pausar</button>' : '<button class="b prim" data-mu="retomar">▶ Retomar</button>'}<button class="b" data-mu="parar">⏹ Parar</button></div>` : '';
      el.innerHTML = `<b>${esc(msg.titulo)}</b><div class="mu-tempo" id="mu-t"></div>${ctl}`;
      tick();
    }
    $('#mu-mudo').textContent = mudo ? '🔇' : '🔊';
    const sl = $('#mu-vol'); if (sl && document.activeElement !== sl) sl.value = Math.round(vol * 100);
    $('#mu-dica').textContent = bloqueado ? 'O navegador bloqueou o som. Toque na tela para ativar.' : '';
    if (mestre && (msg ? msg.url : null) !== urlLista) lista();
  }
  function tick() {
    const t = $('#mu-t'); if (!t || !msg) return;
    const d = durDe();
    t.textContent = `${msg.a === 'p' ? '' : '⏸ '}${mmss(posDe())} / ${mmss(d)}`;
  }
  function abre(mestre) { fecha(); atualiza(mestre); if (mestre) lista(); timer = setInterval(() => { if (!document.hidden) tick(); }, 1000); }
  function fecha() { clearInterval(timer); timer = null; }

  function clique(e) {
    const b = e.target.closest('button[data-mu]'); if (!b) return;
    const ac = b.dataset.mu, li = b.closest('li[data-i]'), f = li ? lib[+li.dataset.i] : null;
    if (ac === 'mudo') { mudo = !mudo; audio.muted = mudo; ls.set('ml.mudo', mudo); b.textContent = mudo ? '🔇' : '🔊'; deps.onMudou(); return; }
    if (!deps.souMestre()) return;
    if (ac === 'tocar' && f) return tocar(f);
    if (ac === 'pausar') return deps.agir('musicaPausar');
    if (ac === 'retomar') return deps.agir('musicaRetomar');
    if (ac === 'parar') return deps.agir('musicaParar');
    if (ac === 'del' && f && confirm(`Remover “${f.titulo}” da biblioteca?`)) { lib.splice(+li.dataset.i, 1); salvaLib(); return lista(); }
    if (ac === 'novo') { const fm = $('#mu-form'); fm.hidden = !fm.hidden; if (!fm.hidden) $('#mu-f-tit').focus(); return; }
    if (ac === 'salvar') {
      const r = faixaDe($('#mu-f-tit').value, $('#mu-f-url').value, $('#mu-f-tags').value);
      if (r.erro) return deps.toast(r.erro);
      mescla([r.f]); ['#mu-f-tit', '#mu-f-url', '#mu-f-tags'].forEach((s) => { $(s).value = ''; }); $('#mu-form').hidden = true; lista(); return deps.toast('Faixa salva');
    }
    if (ac === 'imp') return $('#mu-csv').click();
    if (ac === 'exp') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([geraCsv(lib)], { type: 'text/csv;charset=utf-8' })); a.download = 'faixas.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  }
  // junta na biblioteca: o mesmo link atualiza título e tags da faixa que já existe
  function mescla(novas) {
    for (const f of novas) { const ex = lib.find((x) => x.url === f.url); if (ex) { ex.titulo = f.titulo; ex.tags = f.tags; } else lib.unshift(f); }
    lib = lib.slice(0, 1000); salvaLib();
  }
  function muda(e) {
    if (e.target.id !== 'mu-csv') return;
    const arq = e.target.files[0]; e.target.value = ''; if (!arq) return;
    arq.text().then((txt) => {
      let linhas = leCsv(txt), ci = { t: 0, u: 1, g: 2 };
      const cab = (linhas[0] || []).map((x) => x.trim().toLowerCase());
      if (cab.includes('url')) { ci = { t: Math.max(cab.indexOf('title'), cab.indexOf('titulo'), 0), u: cab.indexOf('url'), g: cab.indexOf('tags') }; linhas = linhas.slice(1); }
      const boas = []; let ruins = 0;
      for (const l of linhas) { const r = faixaDe(l[ci.t], l[ci.u], ci.g >= 0 ? (l[ci.g] || '').split('|') : []); if (r.f) boas.push(r.f); else ruins++; }
      mescla(boas); lista();
      deps.toast(`${boas.length} faixa(s) importada(s)` + (ruins ? `, ${ruins} ignorada(s) por erro` : ''));
    }).catch(() => deps.toast('Não consegui ler esse arquivo'));
  }
  function entrada(e) {
    if (e.target.id === 'mu-vol') { vol = e.target.value / 100; audio.volume = vol; ls.set('ml.vol', vol); }
    else if (e.target.id === 'mu-busca') lista();
  }

  return {
    relogio, estado, html, abre, fecha, atualiza, clique, muda, entrada,
    desbloquear: executa,
    resumo: () => ({ ativa: !!msg, tocando: !!msg && msg.a === 'p', bloqueado, mudo }),
  };
}
