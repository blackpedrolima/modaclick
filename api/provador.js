// ============================================================
//  Provador Virtual com IA — backend (função serverless da Vercel)
//  Endereço: /api/provador
//
//  Opcional e PAGO: faz a prova virtual com a API da FASHN
//    https://docs.fashn.ai (modelo tryon-v1.6).
//  O site funciona sem isto, usando a IA gratuita do Hugging Face no navegador.
//
//  As chaves ficam SOMENTE aqui, como variáveis de ambiente da Vercel
//  (Settings → Environment Variables):
//      FASHN_API_KEY      -> chave da FASHN
//  Opcional:
//      FASHN_MODE         -> performance | balanced (padrão) | quality
//      ALLOWED_ORIGINS    -> outros sites que podem chamar esta API ("null" para srcdoc)
//
//  Privacidade: este arquivo NÃO salva fotos em lugar nenhum e não as registra
//  em log. As fotos só seguem para a API de IA depois do consentimento.
//
//  Como o site usa:
//    GET  /api/provador?status=1   -> { pronto, provedor }
//    POST /api/provador            { consentimento: true, pessoa: dataURL,
//                                    roupa: { url } | { imagem: dataURL },
//                                    categoria: auto|tops|bottoms|one-pieces }
//                                  -> { id }
//    GET  /api/provador?id=ID      -> { status: processando|pronto|erro, imagem?, erro? }
// ============================================================

const TAMANHO_MAX_IMAGEM = 4 * 1024 * 1024; // por foto (o site reduz antes de enviar)
const CATEGORIAS = ['auto', 'tops', 'bottoms', 'one-pieces'];

class ErroAmigavel extends Error {
  constructor(msg, status = 502) { super(msg); this.status = status; }
}

function provedorAtivo() {
  return process.env.FASHN_API_KEY ? 'fashn' : null;
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

function validarDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErroAmigavel('Foto inválida. Envie uma imagem JPG, PNG ou WEBP.', 400);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > TAMANHO_MAX_IMAGEM) throw new ErroAmigavel('Foto grande demais (máximo 4 MB).', 413);
  return { tipo: m[1], bytes };
}

function validarUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') throw new Error();
    return x.toString();
  } catch {
    throw new ErroAmigavel('Endereço da foto da roupa inválido.', 400);
  }
}

/* ============================ FASHN ============================ */
const FASHN = 'https://api.fashn.ai/v1';

const ERROS_FASHN = {
  PoseError: 'Não conseguimos reconhecer o corpo na foto. Use uma foto de corpo inteiro (ou da cintura para cima), de frente e com boa luz.',
  ImageLoadError: 'Não foi possível abrir uma das fotos. Tente outra imagem.',
  NSFWError: 'Uma das fotos foi bloqueada pelo filtro de conteúdo. Use outra foto.',
  ContentModerationError: 'Uma das fotos foi bloqueada pelo filtro de conteúdo. Use outra foto.',
  PhotoTypeError: 'Não entendemos a foto da roupa. Use a peça sozinha (estendida ou no cabide) ou vestida em alguém.',
  InputValidationError: 'Alguma foto não está no formato aceito. Tente outra imagem.',
  PipelineError: 'A IA teve um problema ao gerar a imagem. Tente de novo.',
  RequestError: 'Pedido inválido para a IA. Tente de novo com outras fotos.'
};

async function fashnFetch(caminho, opcoes = {}) {
  const resp = await fetch(FASHN + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${process.env.FASHN_API_KEY}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) }
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('FASHN', caminho, resp.status, dados && dados.error ? (dados.error.name || dados.error) : '');
    if (resp.status === 401 || resp.status === 403) throw new ErroAmigavel('A chave da FASHN é inválida.', 500);
    if (resp.status === 402) throw new ErroAmigavel('A conta da FASHN está sem créditos.', 402);
    if (resp.status === 429) throw new ErroAmigavel('Muitas provas ao mesmo tempo. Espere um minutinho e tente de novo.', 429);
    throw new ErroAmigavel('O serviço de prova virtual não respondeu como esperado.');
  }
  return dados;
}

const fashn = {
  async criar({ pessoa, roupa, categoria }) {
    const dados = await fashnFetch('/run', {
      method: 'POST',
      body: JSON.stringify({
        model_name: 'tryon-v1.6',
        inputs: {
          model_image: pessoa,                   // a pessoa (dataURL)
          garment_image: roupa,                  // a roupa (URL pública ou dataURL)
          category: categoria,                   // auto | tops | bottoms | one-pieces
          mode: process.env.FASHN_MODE || 'balanced',
          garment_photo_type: 'auto',            // peça sozinha ou vestida em alguém
          segmentation_free: true,               // mantém melhor o corpo e o que não é roupa
          moderation_level: 'conservative',      // site usado por estudantes
          output_format: 'jpeg',
          return_base64: true,                   // resultado fica só 60 min na FASHN (em vez de 3 dias)
          num_samples: 1
        }
      })
    });
    if (dados.error) throw new ErroAmigavel(ERROS_FASHN[dados.error.name] || 'Não foi possível iniciar a prova virtual.', 400);
    if (!dados.id) throw new ErroAmigavel('O serviço não devolveu o número da prova.');
    return dados.id;
  },

  async consultar(id) {
    const d = await fashnFetch(`/status/${encodeURIComponent(id)}`);
    if (d.status === 'completed') {
      const imagem = Array.isArray(d.output) ? d.output[0] : null;
      if (!imagem) return { status: 'erro', erro: 'A IA terminou, mas não devolveu a imagem. Tente de novo.' };
      return { status: 'pronto', imagem };
    }
    if (d.status === 'failed' || d.status === 'canceled') {
      const nome = d.error && d.error.name;
      console.error('FASHN falhou:', nome || d.status);
      return { status: 'erro', erro: ERROS_FASHN[nome] || 'A IA não conseguiu gerar a imagem. Tente outra foto.' };
    }
    return { status: 'processando' }; // starting | in_queue | processing
  }
};

const PROVEDORES = { fashn };

/* ============================ HANDLER ============================ */
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

  const nomeProvedor = provedorAtivo();
  const params = new URL(req.url, 'http://x').searchParams;

  try {
    if (req.method === 'GET' && params.has('status')) {
      return res.status(200).json({ pronto: !!nomeProvedor, provedor: nomeProvedor });
    }
    if (!nomeProvedor) {
      return res.status(503).json({ erro: 'A IA pelo servidor não foi configurada: falta a chave FASHN_API_KEY na Vercel. Use a IA gratuita.' });
    }

    // ---------- Consultar ----------
    if (req.method === 'GET') {
      const id = String(params.get('id') || '');
      const m = /^(fashn):([A-Za-z0-9_-]{1,128})$/.exec(id);
      if (!m || !PROVEDORES[m[1]]) return res.status(400).json({ erro: 'Número da prova inválido.' });
      const resultado = await PROVEDORES[m[1]].consultar(m[2]);
      return res.status(200).json(resultado);
    }

    // ---------- Criar ----------
    if (req.method === 'POST') {
      let corpo = req.body;
      if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
      if (!corpo) return res.status(400).json({ erro: 'Pedido vazio.' });
      if (corpo.consentimento !== true) {
        return res.status(400).json({ erro: 'É preciso autorizar o processamento das fotos antes de gerar o look.' });
      }
      validarDataUrl(corpo.pessoa);
      let roupa;
      if (corpo.roupa && corpo.roupa.url) roupa = validarUrl(corpo.roupa.url);
      else if (corpo.roupa && corpo.roupa.imagem) { validarDataUrl(corpo.roupa.imagem); roupa = corpo.roupa.imagem; }
      else return res.status(400).json({ erro: 'Envie a foto da roupa.' });
      const categoria = CATEGORIAS.includes(corpo.categoria) ? corpo.categoria : 'auto';

      const id = await PROVEDORES[nomeProvedor].criar({ pessoa: corpo.pessoa, roupa, categoria });
      return res.status(200).json({ id: `${nomeProvedor}:${id}` });
    }

    return res.status(405).json({ erro: 'Use GET ou POST.' });
  } catch (e) {
    if (e instanceof ErroAmigavel) return res.status(e.status).json({ erro: e.message });
    console.error('Falha no provador:', e && e.message);
    return res.status(502).json({ erro: 'Não foi possível falar com o serviço de prova virtual agora.' });
  }
};
