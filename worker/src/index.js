// ============================================================
//  ModaClick · Provador com IA — Cloudflare Worker (backend seguro)
//
//  Protege a chave da WeShop AI e conversa com a API oficial:
//    https://open.weshop.ai/skill/weshop-openapi-skill
//    Agente: virtualtryon v1.0 · generateVersion weshopFlash ·
//    descriptionType auto · batchCount 1
//
//  Configuração (veja worker/LEIA-ME-WORKER.md):
//    Segredo   WESHOP_API_KEY   → cadastrado com "wrangler secret put" ou no painel
//    Variável  ALLOWED_ORIGINS  → sites que podem chamar este Worker, separados por vírgula
//                                 ex.: "https://modaclick.pages.dev,http://localhost:3000"
//    (opcional) RATE_LIMITER    → binding de Rate Limiting da Cloudflare (wrangler.toml)
//
//  Rotas usadas pelo site:
//    POST /tryon        { consentimento: true, pessoa: dataURL, roupa: { url } | { imagem: dataURL } }
//                       → { id }
//    GET  /tryon/:id    → { status: processando|pronto|erro, etapa, imagens[], erro? }
//    GET  /imagem?u=URL → devolve a imagem gerada (só domínios da WeShop), para o botão "Salvar"
//    GET  /status       → { ok: true }
//
//  Privacidade: o Worker não guarda fotos nem registra imagens em log.
// ============================================================

const WESHOP = 'https://openapi.weshop.ai';
const MAX_BYTES = 10 * 1024 * 1024;                 // limite da WeShop: 10 MB por imagem
const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp'];
// Só aceitamos baixar fotos de catálogo destes domínios (evita o Worker virar um "proxy aberto")
const HOSTS_CATALOGO = ['images.unsplash.com'];
// Só deixamos baixar resultados vindos da WeShop
const HOST_RESULTADO = /(^|\.)weshop\.(ai|com)$/i;

class ErroAmigavel extends Error {
  constructor(mensagem, status = 502) { super(mensagem); this.status = status; }
}

/* ---------------- CORS (sem acesso irrestrito) ---------------- */
function origensPermitidas(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function cabecalhosCors(req, env) {
  const origem = req.headers.get('Origin');
  const lista = origensPermitidas(env);
  if (origem && lista.includes(origem)) {
    return {
      'Access-Control-Allow-Origin': origem,         // ecoa SÓ origens da lista (nunca "*")
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
  }
  return null;
}
function json(dados, status, cors) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cors || {}) }
  });
}

/* ---------------- Imagens ---------------- */
function dataUrlParaBlob(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErroAmigavel('Foto inválida. Envie uma imagem JPG, PNG ou WEBP.', 400);
  const binario = atob(m[2]);
  if (binario.length > MAX_BYTES) throw new ErroAmigavel('A foto passa de 10 MB.', 413);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

async function baixarFotoCatalogo(url) {
  let u;
  try { u = new URL(url); } catch { throw new ErroAmigavel('Endereço da roupa inválido.', 400); }
  if (u.protocol !== 'https:' || !HOSTS_CATALOGO.includes(u.hostname)) {
    throw new ErroAmigavel('Essa foto de roupa não vem do catálogo permitido.', 400);
  }
  const r = await fetch(u.toString());
  const tipo = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !TIPOS_OK.includes(tipo)) throw new ErroAmigavel('Não foi possível baixar a foto da roupa do catálogo.');
  const blob = await r.blob();
  if (blob.size > MAX_BYTES) throw new ErroAmigavel('A foto da roupa passa de 10 MB.', 413);
  return blob;
}

/* ---------------- API da WeShop ---------------- */
async function weshop(env, caminho, opcoes = {}) {
  let resp;
  try {
    resp = await fetch(WESHOP + caminho, {
      ...opcoes,
      // A WeShop pede a chave pura no Authorization, SEM "Bearer"
      headers: { Authorization: env.WESHOP_API_KEY, ...(opcoes.headers || {}) }
    });
  } catch {
    throw new ErroAmigavel('Não foi possível falar com a WeShop agora.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || dados.success === false) {
    const codigo = dados?.error?.code || resp.status;
    console.log('WeShop erro', caminho, resp.status, codigo);   // sem dados pessoais
    if (resp.status === 401 || resp.status === 403) throw new ErroAmigavel('A chave da WeShop é inválida ou não tem permissão.', 500);
    if (resp.status === 402 || /credit|point|balance/i.test(String(dados?.error?.message || ''))) throw new ErroAmigavel('A conta da WeShop está sem créditos.', 402);
    if (resp.status === 429) throw new ErroAmigavel('Muitos pedidos ao mesmo tempo. Espere um minuto e tente de novo.', 429);
    if (resp.status === 400) throw new ErroAmigavel('A WeShop recusou a foto' + (dados?.error?.message ? `: ${String(dados.error.message).slice(0, 140)}` : '. Use uma foto JPG/PNG com mais de 512 px e proporção menor que 2:1.'), 400);
    throw new ErroAmigavel('A WeShop não conseguiu processar o pedido agora.');
  }
  return dados;
}

// 1) Upload oficial: POST /openapi/agent/assets/images (multipart, campo "image") → data.image
async function enviarImagem(env, blob, nome) {
  const form = new FormData();
  const extensao = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  form.append('image', blob, `${nome}.${extensao}`);
  const dados = await weshop(env, '/openapi/agent/assets/images', { method: 'POST', body: form });
  const url = dados?.data?.image;
  if (!url) throw new ErroAmigavel('A WeShop não devolveu o endereço da foto enviada.');
  return url;
}

// 2) Execução oficial: POST /openapi/agent/runs → meta.executionId
async function criarProva(env, urlRoupa, urlPessoa) {
  const dados = await weshop(env, '/openapi/agent/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent: { name: 'virtualtryon', version: 'v1.0' },
      input: {
        taskName: 'modaclick-provador',
        originalImage: urlRoupa,        // a roupa
        fashionModelImage: urlPessoa    // a pessoa (a modelo gerada vai se parecer com ela)
      },
      params: {
        generateVersion: 'weshopFlash',
        descriptionType: 'auto',
        batchCount: 1
      }
    })
  });
  const id = dados?.meta?.executionId || dados?.data?.executionId;
  if (!id) throw new ErroAmigavel('A WeShop não devolveu o número da tarefa.');
  return String(id);
}

// 3) Consulta oficial: GET /openapi/agent/runs/{executionId} → data.executions[*].result[*].image
async function consultarProva(env, id) {
  const dados = await weshop(env, `/openapi/agent/runs/${encodeURIComponent(id)}`);
  const execucoes = dados?.data?.executions || [];
  const e = execucoes.find(x => String(x.executionId) === id) || execucoes[0] || {};
  const status = String(e.status || 'Pending');
  const imagens = (e.result || []).filter(r => r && r.image && String(r.status).toLowerCase() !== 'failed').map(r => r.image);
  const s = status.toLowerCase();
  if (s === 'success') {
    return imagens.length ? { status: 'pronto', etapa: status, imagens } : { status: 'erro', etapa: status, erro: 'A IA terminou, mas não gerou imagem. Tente outra foto.' };
  }
  if (s === 'failed') return { status: 'erro', etapa: status, erro: 'A WeShop não conseguiu gerar a imagem. Tente outra foto, de frente e com boa luz.' };
  return { status: 'processando', etapa: status };   // Pending | Segmenting | Running
}

/* ---------------- Worker ---------------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = cabecalhosCors(req, env);
    const temOrigem = req.headers.has('Origin');

    // Navegadores sempre mandam "Origin" em pedidos de outro site.
    // Origem fora da lista = bloqueado.
    if (temOrigem && !cors) return json({ erro: 'Origem não permitida.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });

    try {
      if (url.pathname === '/status' && req.method === 'GET') {
        return json({ ok: true, configurado: !!env.WESHOP_API_KEY }, 200, cors);
      }
      if (!env.WESHOP_API_KEY) throw new ErroAmigavel('O segredo WESHOP_API_KEY não foi cadastrado no Worker.', 500);

      // Limite de pedidos por IP (se o binding RATE_LIMITER estiver configurado)
      if (env.RATE_LIMITER && req.method === 'POST') {
        const ip = req.headers.get('CF-Connecting-IP') || 'sem-ip';
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) throw new ErroAmigavel('Você fez muitas provas seguidas. Espere um minuto.', 429);
      }

      // ---- Criar prova ----
      if (url.pathname === '/tryon' && req.method === 'POST') {
        if (Number(req.headers.get('Content-Length') || 0) > 25 * 1024 * 1024) throw new ErroAmigavel('Pedido grande demais.', 413);
        const corpo = await req.json().catch(() => null);
        if (!corpo) throw new ErroAmigavel('Pedido inválido.', 400);
        if (corpo.consentimento !== true) throw new ErroAmigavel('É preciso autorizar o uso da foto antes de gerar o look.', 400);

        const fotoPessoa = dataUrlParaBlob(corpo.pessoa);
        let fotoRoupa;
        if (corpo.roupa && corpo.roupa.url) fotoRoupa = await baixarFotoCatalogo(corpo.roupa.url);
        else if (corpo.roupa && corpo.roupa.imagem) fotoRoupa = dataUrlParaBlob(corpo.roupa.imagem);
        else throw new ErroAmigavel('Falta a foto da roupa.', 400);

        const [urlRoupa, urlPessoa] = await Promise.all([
          enviarImagem(env, fotoRoupa, 'roupa'),
          enviarImagem(env, fotoPessoa, 'pessoa')
        ]);
        const id = await criarProva(env, urlRoupa, urlPessoa);
        return json({ id }, 200, cors);
      }

      // ---- Consultar prova ----
      const m = /^\/tryon\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
      if (m && req.method === 'GET') {
        return json(await consultarProva(env, m[1]), 200, cors);
      }

      // ---- Baixar imagem gerada (para "Salvar imagem") ----
      if (url.pathname === '/imagem' && req.method === 'GET') {
        let alvo;
        try { alvo = new URL(url.searchParams.get('u') || ''); } catch { throw new ErroAmigavel('Endereço inválido.', 400); }
        if (alvo.protocol !== 'https:' || !HOST_RESULTADO.test(alvo.hostname)) throw new ErroAmigavel('Só imagens geradas pela WeShop.', 400);
        const r = await fetch(alvo.toString());
        if (!r.ok) throw new ErroAmigavel('Não foi possível baixar a imagem gerada.');
        return new Response(r.body, {
          status: 200,
          headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'no-store', ...(cors || {}) }
        });
      }

      return json({ erro: 'Rota não encontrada.' }, 404, cors);
    } catch (e) {
      if (e instanceof ErroAmigavel) return json({ erro: e.message }, e.status, cors);
      console.log('Falha inesperada:', e && e.message);
      return json({ erro: 'Erro inesperado no servidor do provador.' }, 500, cors);
    }
  }
};
