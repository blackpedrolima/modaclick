// ============================================================
//  Provador com IA GRATUITA pelo servidor (Vercel) — Hugging Face
//  Endereço: /api/provador-hf
//
//  Por que pelo servidor? Os espaços gratuitos (ZeroGPU) recusam chamadas
//  feitas direto do navegador de outro site ("Failed to fetch"). Aqui no
//  servidor essa regra não existe.
//
//  IAs usadas:
//    parte de cima           → yisol/IDM-VTON       (/tryon)
//    parte de baixo          → levihsu/OOTDiffusion (/process_dc, Lower-body)
//    vestido / macacão       → franciszzj/Leffa     (/leffa_predict_vt, DressCode + "dresses")
//                              Se o Leffa estiver fora do ar, usa o OOTDiffusion (Dress).
//    Por que o Leffa nas peças únicas? A máscara de vestido dele inclui as PERNAS,
//    então o vestido ou macacão pode cobrir o corpo todo. No OOTDiffusion as pernas
//    ficam de fora: o vestido só aparece onde a pessoa já tinha roupa.
//
//  Variável de ambiente (Vercel → Settings → Environments → Production):
//    HF_TOKEN  → token "Read" do Hugging Face (opcional, mas recomendado:
//                aumenta a cota grátis de GPU). Nunca coloque no código.
//
//  Como o site usa (um pedido por peça):
//    GET  /api/provador-hf?status=1  → { pronto, token }
//    POST /api/provador-hf  { consentimento: true, categoria: tops|bottoms|one-pieces,
//                             pessoa: dataURL | URL de resultado anterior,
//                             roupa: { url } | { imagem: dataURL }, nome, token? }
//                         → { imagem }   (dataURL da imagem gerada)
//  Privacidade: nada é salvo; as fotos vão só para o espaço de IA.
// ============================================================

// Cada tipo de peça tem uma lista de IAs: a primeira é a preferida; as outras são reserva.
const ESPACOS = {
  tops: ['yisol/IDM-VTON'],
  bottoms: ['levihsu/OOTDiffusion'],
  'one-pieces': ['franciszzj/Leffa', 'levihsu/OOTDiffusion']
};
const HOSTS_ROUPA = ['images.unsplash.com'];                 // fotos do catálogo
const HOST_HF = /(^|\.)hf\.space$|(^|\.)huggingface\.co$/i;  // resultados de etapas anteriores
const TAMANHO_MAX = 8 * 1024 * 1024;
const TEMPO_LIMITE = 285000;                                 // a Vercel grátis permite até 300 s

class ErroAmigavel extends Error {
  constructor(msg, status = 502) { super(msg); this.status = status; }
}

function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return null;
  const extras = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const host = req.headers.host;
  if (host && (origem === `https://${host}` || origem === `http://${host}`)) return origem;
  if (extras.includes(origem)) return origem;
  return false;
}

// Duas versões da biblioteca oficial do Gradio: a nova e a anterior (para espaços mais antigos)
async function bibliotecas() {
  // Os nomes precisam estar escritos por extenso: a Vercel só inclui no servidor
  // as bibliotecas que ela consegue "ler" no código.
  const libs = [], falhas = [];
  try { libs.push({ nome: '2.1.0', lib: await import('gradio-v2') }); }
  catch (e) { falhas.push('gradio-v2: ' + (e && e.message)); }
  try { libs.push({ nome: '1.x', lib: await import('gradio-v1') }); }
  catch (e) { falhas.push('gradio-v1: ' + (e && e.message)); }
  if (falhas.length) console.log('Biblioteca não carregou:', falhas.join(' | '));
  if (!libs.length) throw new ErroAmigavel('O servidor não encontrou a biblioteca do Hugging Face. Detalhe: ' + falhas.join(' | ').slice(0, 400), 500);
  return libs;
}

async function conectar(espaco, token) {
  const motivos = [];
  for (const { nome, lib } of await bibliotecas()) {
    for (const t of token ? [token, null] : [null]) {
      try {
        const opcoes = {};
        if (t) { opcoes.token = t; opcoes.hf_token = t; }   // "token" na versão 2, "hf_token" na versão 1
        const app = await lib.Client.connect(espaco, opcoes);
        return { app, handle_file: lib.handle_file, semToken: !!token && !t };
      } catch (e) {
        motivos.push(`v${nome} ${t ? 'com token' : 'sem token'}: ${String((e && e.message) || e).slice(0, 100)}`);
      }
    }
  }
  throw new ErroAmigavel(`Não foi possível conectar ao espaço gratuito de IA (${espaco}). Ele pode estar fora do ar, dormindo ou com fila cheia. Tente de novo em alguns minutos. Detalhe técnico: ${motivos.join(' | ')}`);
}

function entrada(handle_file, valor, hostsPermitidos, oQue) {
  const s = String(valor || '');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (m) {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > TAMANHO_MAX) throw new ErroAmigavel(`A foto da ${oQue} é grande demais.`, 413);
    return handle_file(new Blob([buf], { type: m[1] }));
  }
  let u;
  try { u = new URL(s); } catch { throw new ErroAmigavel(`Foto da ${oQue} inválida.`, 400); }
  const ok = u.protocol === 'https:' && (hostsPermitidos.includes(u.hostname) || HOST_HF.test(u.hostname));
  if (!ok) throw new ErroAmigavel(`Endereço da foto da ${oQue} não permitido.`, 400);
  return handle_file(u.toString());
}

function extrairUrl(saida) {
  if (!saida) return null;
  if (Array.isArray(saida)) return extrairUrl(saida[0]);
  if (typeof saida === 'string') return saida;
  if (saida.image) return extrairUrl(saida.image);
  return saida.url || null;
}

function traduzir(texto) {
  const t = String(texto || '').toLowerCase();
  if (t.includes('quota') || t.includes('gpu')) return 'A cota gratuita de GPU do Hugging Face acabou por agora. Espere alguns minutos ou configure um token (HF_TOKEN) na Vercel.';
  if (t.includes('sleep') || t.includes('paused') || t.includes('building')) return 'O espaço gratuito de IA está dormindo ou reiniciando. Tente de novo em alguns minutos.';
  return 'A IA gratuita não conseguiu gerar a imagem agora' + (texto ? ` (${String(texto).slice(0, 140)})` : '') + '. Tente de novo ou use outra foto.';
}

// Como chamar cada IA (nomes dos parâmetros iguais aos dos espaços)
function pedidoDaIA(espaco, app, categoria, fotoPessoa, fotoRoupa, nome) {
  if (espaco === 'yisol/IDM-VTON') {
    return app.predict('/tryon', {
      dict: { background: fotoPessoa, layers: [], composite: null },
      garm_img: fotoRoupa,
      garment_des: String(nome || 'roupa').slice(0, 80),
      is_checked: true,          // máscara automática: troca só tronco e braços
      is_checked_crop: false,
      denoise_steps: 30,
      seed: 42
    });
  }
  if (espaco === 'franciszzj/Leffa') {
    return app.predict('/leffa_predict_vt', {
      src_image_path: fotoPessoa,
      ref_image_path: fotoRoupa,
      ref_acceleration: false,
      step: 30,
      scale: 2.5,
      seed: 42,
      vt_model_type: 'dress_code',   // modelo treinado com vestidos e peças inteiras
      vt_garment_type: categoria === 'bottoms' ? 'lower_body' : 'dresses',   // máscara inclui as pernas
      vt_repaint: false
    });
  }
  return app.predict('/process_dc', {
    vton_img: fotoPessoa,
    garm_img: fotoRoupa,
    category: categoria === 'bottoms' ? 'Lower-body' : 'Dress',
    n_samples: 1,
    n_steps: 20,
    image_scale: 2,
    seed: -1
  });
}

async function gerarCom(espaco, { categoria, pessoa, roupa, nome, token, prazo }) {
  const { app, handle_file, semToken } = await conectar(espaco, token);
  const fotoPessoa = entrada(handle_file, pessoa, [], 'pessoa');
  const fotoRoupa = roupa.url ? entrada(handle_file, roupa.url, HOSTS_ROUPA, 'roupa') : entrada(handle_file, roupa.imagem, [], 'roupa');
  const pedido = pedidoDaIA(espaco, app, categoria, fotoPessoa, fotoRoupa, nome);

  let resposta, relogio;
  try {
    resposta = await Promise.race([
      pedido,
      new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error('tempo esgotado')), Math.max(1000, prazo - Date.now())); })
    ]);
  } catch (e) {
    const msg = (e && (e.message || (e.original_msg) || (e.title))) || String(e);
    if (/tempo esgotado/.test(msg)) throw new ErroAmigavel('A IA gratuita demorou demais (fila cheia). Tente de novo em alguns minutos.', 504);
    throw new ErroAmigavel(traduzir(msg));
  } finally {
    clearTimeout(relogio);
  }
  const url = extrairUrl(resposta && resposta.data && resposta.data[0]);
  if (!url) throw new ErroAmigavel('A IA gratuita terminou, mas não devolveu a imagem.');

  // Devolve a imagem pronta (dataURL), para o site mostrar e salvar sem depender do link do espaço
  try {
    const r = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length <= 3 * 1024 * 1024) {
        const tipo = (r.headers.get('content-type') || 'image/png').split(';')[0];
        return { imagem: `data:${tipo};base64,${buf.toString('base64')}`, semToken };
      }
    }
  } catch { /* se não der, devolve o link */ }
  return { imagem: url, semToken };
}

// Tenta a IA preferida; se ela estiver fora do ar ou der erro, tenta a reserva.
// Cota de GPU esgotada não muda de uma IA para outra (a cota é da conta), então aí não adianta tentar a reserva.
async function gerar(dados) {
  dados = { ...dados, prazo: Date.now() + TEMPO_LIMITE };   // o tempo total (todas as tentativas) cabe no limite da Vercel
  // Teste pedido pelo site: calças no Leffa (com a OOTDiffusion de reserva)
  const lista = dados.categoria === 'bottoms' && dados.preferencia === 'leffa'
    ? ['franciszzj/Leffa', 'levihsu/OOTDiffusion']
    : ESPACOS[dados.categoria];
  const erros = [];
  for (const espaco of lista) {
    try {
      const r = await gerarCom(espaco, dados);
      return { ...r, ia: espaco, ...(erros.length ? { aviso: `A IA preferida não respondeu; usamos ${espaco}.` } : {}) };
    } catch (e) {
      if (!(e instanceof ErroAmigavel)) throw e;
      erros.push(e);
      const semSaida = /cota|demorou demais|grande demais|inválid|não permitido/i.test(e.message);
      if (semSaida || espaco === lista[lista.length - 1] || dados.prazo - Date.now() < 60000) break;
      console.log(`IA ${espaco} falhou, tentando a reserva:`, e.message.slice(0, 200));
    }
  }
  const ultimo = erros[erros.length - 1];
  if (erros.length > 1) ultimo.message += ` (A IA preferida também falhou: ${erros[0].message.slice(0, 160)})`;
  throw ultimo;
}

module.exports = async function handler(req, res) {
  const origem = origemPermitida(req);
  if (origem) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(origem === false ? 403 : 204).end();
  if (origem === false) return res.status(403).json({ erro: 'Origem não permitida.' });

  const params = new URL(req.url, 'http://x').searchParams;
  try {
    if (req.method === 'GET' && params.has('status')) {
      return res.status(200).json({ pronto: true, token: !!process.env.HF_TOKEN });
    }
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

    let corpo = req.body;
    if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
    if (!corpo) throw new ErroAmigavel('Pedido vazio.', 400);
    if (corpo.consentimento !== true) throw new ErroAmigavel('É preciso autorizar o processamento das fotos antes de gerar o look.', 400);
    if (!ESPACOS[corpo.categoria]) throw new ErroAmigavel('Tipo de peça inválido.', 400);
    if (!corpo.pessoa || !corpo.roupa || (!corpo.roupa.url && !corpo.roupa.imagem)) throw new ErroAmigavel('Faltam as fotos.', 400);

    // Token: o da Vercel (HF_TOKEN) tem prioridade; senão, o que a pessoa colou no site (não é guardado)
    const tokenSite = typeof corpo.token === 'string' && /^hf_[A-Za-z0-9]{10,}$/.test(corpo.token) ? corpo.token : null;
    const token = process.env.HF_TOKEN || tokenSite;

    const r = await gerar({ categoria: corpo.categoria, pessoa: corpo.pessoa, roupa: corpo.roupa, nome: corpo.nome, token, preferencia: corpo.preferencia === 'leffa' ? 'leffa' : null });
    return res.status(200).json(r);
  } catch (e) {
    if (e instanceof ErroAmigavel) return res.status(e.status).json({ erro: e.message });
    console.error('Falha no provador HF:', e && e.message);
    return res.status(502).json({ erro: 'Não foi possível falar com a IA gratuita agora.' });
  }
};
