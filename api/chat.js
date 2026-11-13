// ============================================================
//  Moda Click IA — backend (função serverless da Vercel)
//  Endereço: /api/chat
//
//  A chave do Gemini NUNCA fica no site. Ela fica guardada na
//  Vercel como variável de ambiente (secret) chamada:
//      GEMINI_API_KEY
//  Opcional:
//      GEMINI_MODEL     -> modelo usado (padrão: gemini-3.8-flash)
//      ALLOWED_ORIGINS  -> sites extras que podem chamar esta API,
//                          separados por vírgula (ex.: "null" para
//                          usar dentro de um iframe com srcdoc)
//
//  O que a IA sabe de moda está em  api/_conhecimento-moda.js
//  (é lá que vocês "treinam" a Moda Click IA).
// ============================================================

const K = require('./_conhecimento-moda.js');

const MODELO_PADRAO = 'gemini-3.8-flash';
const MAX_MENSAGENS = 20;        // histórico máximo enviado à IA
const MAX_CARACTERES = 1500;     // tamanho máximo de cada mensagem
const MAX_PECAS_CATALOGO = 200;  // proteção contra pedidos gigantes
const MAX_LOOKS = 3;

// Em que lugar do look cada categoria entra (igual ao Provador Virtual)
const ESPACO = {
  Camisetas: 'cima', Blusas: 'cima', Jaquetas: 'cima',
  Calças: 'baixo', Saias: 'baixo',
  Vestidos: 'unica', Conjuntos: 'unica',
  Acessórios: 'acessorio'
};
const NOME_ESPACO = { cima: 'parte de cima', baixo: 'parte de baixo', unica: 'peça única', acessorio: 'acessório' };

const FORMATO = `
FORMATO DA RESPOSTA (JSON):
- "resposta": texto curto para a pessoa (pode usar **negrito** e listas com "- ").
- "looks": lista de 0 a 3 looks. Cada look tem:
    "nome" (curto e divertido), "porque" (uma frase),
    "cima", "baixo", "unica", "terceira" (ID do catálogo ou "" se não tiver),
    "acessorios" (lista de até 2 IDs de Acessórios).
  Use "cima"+"baixo" OU "unica" (nunca os três). "terceira" é só para Jaquetas por cima.
- "pecas": até 4 IDs soltos, quando a pergunta não pede um look completo (ex.: dúvidas de cor). Senão, lista vazia.
- "sugestoes": 2 ou 3 próximos pedidos curtos (até 30 letras cada) que a pessoa pode clicar.
`;

function textoExemplos() {
  return K.EXEMPLOS.map((e, i) =>
    `Exemplo ${i + 1}\nPessoa: ${e.pedido}\nVocê (JSON): ${JSON.stringify(e.resposta)}`
  ).join('\n\n');
}

function montarInstrucoes(catalogo, textoLook) {
  const linhas = catalogo.map(p =>
    `${p.id} | ${p.nome} | ${p.categoria} (${NOME_ESPACO[ESPACO[p.categoria]] || 'outro'}) | cores: ${p.cores.join(', ')} | estilo: ${p.estilo}${p.descricao ? ' | ' + p.descricao : ''}`
  ).join('\n');
  return [
    K.PERSONALIDADE,
    'ESTILOS DO CATÁLOGO:' + K.ESTILOS,
    'OCASIÕES:' + K.OCASIOES,
    'COMO COMBINAR CORES:' + K.CORES,
    'COMO MONTAR UM LOOK:' + K.MONTAGEM,
    'REGRAS (nunca quebre):' + K.REGRAS,
    'COMO CONVERSAR:' + K.CONVERSA,
    FORMATO,
    'EXEMPLOS DE BOAS RESPOSTAS (imite o jeito, mas adapte as peças ao pedido):\n' + textoExemplos(),
    'CATÁLOGO (ID | nome | categoria (lugar no look) | cores | estilo | descrição):\n' + (linhas || '(vazio)'),
    'LOOK ATUAL DO PROVADOR VIRTUAL: ' + textoLook
  ].map(s => s.trim()).join('\n\n');
}

function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return null; // mesma origem (o próprio site na Vercel)
  const extras = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const host = req.headers.host;
  if (host && (origem === `https://${host}` || origem === `http://${host}`)) return origem;
  if (extras.includes(origem)) return origem;
  return false;
}

const limparTexto = (t, max = MAX_CARACTERES) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, max);

function lerCatalogo(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, MAX_PECAS_CATALOGO).map(p => ({
    id: limparTexto(p && p.id, 20),
    nome: limparTexto(p && p.nome, 60),
    categoria: limparTexto(p && p.categoria, 20),
    cores: [].concat((p && p.cores) || []).map(c => limparTexto(c, 15)).slice(0, 5),
    estilo: limparTexto(p && p.estilo, 30),
    descricao: limparTexto(p && p.descricao, 140)
  })).filter(p => p.id && p.nome);
}

function lerLookAtual(look, porId) {
  if (!look || typeof look !== 'object') return 'vazio (a pessoa ainda não escolheu peças).';
  const partes = [];
  for (const espaco of ['unica', 'cima', 'baixo']) {
    const v = look[espaco];
    if (!v) continue;
    if (v.id && porId.has(String(v.id))) {
      const p = porId.get(String(v.id));
      partes.push(`${NOME_ESPACO[espaco]}: ${p.id} (${p.nome})`);
    } else if (v.foto) {
      partes.push(`${NOME_ESPACO[espaco]}: uma foto de roupa da própria pessoa (fora do catálogo)`);
    }
  }
  return partes.length ? partes.join('; ') + '.' : 'vazio (a pessoa ainda não escolheu peças).';
}

// Confere cada look: só IDs que existem, cada peça no lugar certo, sem misturar peça única com cima/baixo.
function normalizarLooks(looks, porId) {
  const saida = [];
  for (const l of [].concat(looks || [])) {
    if (!l || typeof l !== 'object') continue;
    const look = { nome: limparTexto(l.nome, 50) || 'Look', porque: limparTexto(l.porque, 220), cima: '', baixo: '', unica: '', terceira: '', acessorios: [] };
    const roupas = ['unica', 'cima', 'baixo', 'terceira'].map(k => String(l[k] || '').trim()).filter(id => porId.has(id));
    for (const id of roupas) {
      const espaco = ESPACO[porId.get(id).categoria];
      const jaqueta = porId.get(id).categoria === 'Jaquetas';
      if (espaco === 'unica' && !look.unica) look.unica = id;
      else if (espaco === 'baixo' && !look.baixo) look.baixo = id;
      else if (espaco === 'cima') {
        if (!look.cima) look.cima = id;
        else if (!look.terceira && jaqueta && look.cima !== id) look.terceira = id;
        else if (!look.terceira && porId.get(look.cima).categoria === 'Jaquetas' && look.cima !== id) { look.terceira = look.cima; look.cima = id; }
      }
    }
    if (look.unica) { // a peça única substitui cima e baixo; uma jaqueta por cima pode ficar
      const jaq = [look.cima, look.terceira].find(id => id && porId.get(id).categoria === 'Jaquetas');
      look.cima = ''; look.baixo = ''; look.terceira = jaq || '';
    }
    if (look.cima && look.terceira === look.cima) look.terceira = '';
    look.acessorios = [...new Set([].concat(l.acessorios || []).map(String))]
      .filter(id => porId.has(id) && ESPACO[porId.get(id).categoria] === 'acessorio').slice(0, 2);
    if (look.unica || look.cima || look.baixo) saida.push(look);
    if (saida.length >= MAX_LOOKS) break;
  }
  return saida;
}

// Tenta aproveitar a resposta mesmo se o JSON vier cortado
function lerJSON(texto) {
  try { return JSON.parse(texto); } catch { /* segue */ }
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* segue */ } }
  const r = String(texto).match(/"resposta"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (r) { try { return { resposta: JSON.parse(`"${r[1]}"`) }; } catch { /* segue */ } }
  return { resposta: /^\s*\{/.test(texto) ? '' : texto };
}

async function chamarGemini(url, chave, corpo) {
  let ultimo;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo) });
    const dados = await resp.json().catch(() => ({}));
    ultimo = { resp, dados };
    if (resp.ok || ![500, 503].includes(resp.status)) break;   // só repete quando o Gemini está sobrecarregado
    await new Promise(r => setTimeout(r, 1200));
  }
  return ultimo;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    resposta: { type: 'STRING' },
    looks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' }, porque: { type: 'STRING' },
          cima: { type: 'STRING' }, baixo: { type: 'STRING' }, unica: { type: 'STRING' }, terceira: { type: 'STRING' },
          acessorios: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['nome', 'porque', 'cima', 'baixo', 'unica', 'terceira', 'acessorios']
      }
    },
    pecas: { type: 'ARRAY', items: { type: 'STRING' } },
    sugestoes: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['resposta', 'looks', 'pecas', 'sugestoes']
};

async function handler(req, res) {
  // ----- CORS (só para origens permitidas) -----
  const origem = origemPermitida(req);
  if (origem) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(origem === false ? 403 : 204).end();
  if (origem === false) return res.status(403).json({ erro: 'Origem não permitida.' });
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return res.status(500).json({ erro: 'A chave GEMINI_API_KEY não foi configurada na Vercel.' });

  // ----- Lê e valida o pedido -----
  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
  if (!corpo || !Array.isArray(corpo.mensagens) || corpo.mensagens.length === 0) {
    return res.status(400).json({ erro: 'Envie { mensagens: [...] }.' });
  }

  const mensagens = corpo.mensagens.slice(-MAX_MENSAGENS).map(m => ({
    role: m && m.autor === 'ia' ? 'model' : 'user',
    parts: [{ text: limparTexto(m && m.texto) || '…' }]
  }));
  while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift(); // o Gemini exige começar pelo usuário
  if (!mensagens.length) return res.status(400).json({ erro: 'Mensagem vazia.' });

  const catalogo = lerCatalogo(corpo.catalogo);
  const porId = new Map(catalogo.map(p => [p.id, p]));
  const instrucoes = montarInstrucoes(catalogo, lerLookAtual(corpo.lookAtual, porId));

  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  try {
    const { resp, dados } = await chamarGemini(url, chave, {
      systemInstruction: { parts: [{ text: instrucoes }] },
      contents: mensagens,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: SCHEMA }
    });

    if (!resp.ok) {
      console.error('Erro do Gemini:', resp.status, JSON.stringify(dados).slice(0, 500));
      const ocupado = resp.status === 429;
      return res.status(ocupado ? 429 : 502).json({
        erro: ocupado ? 'Muitas perguntas ao mesmo tempo. Espere um minutinho e tente de novo.' : 'A IA não conseguiu responder agora.'
      });
    }

    const texto = dados?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const saida = lerJSON(texto);
    const looks = normalizarLooks(saida.looks, porId);
    const nosLooks = new Set(looks.flatMap(l => [l.cima, l.baixo, l.unica, l.terceira, ...l.acessorios]));
    const pecas = [...new Set([].concat(saida.pecas || []).map(String))]
      .filter(id => porId.has(id) && !nosLooks.has(id)).slice(0, 4);
    const sugestoes = [].concat(saida.sugestoes || []).map(s => limparTexto(s, 40)).filter(Boolean).slice(0, 3);

    return res.status(200).json({
      resposta: limparTexto(saida.resposta, 2000) ? String(saida.resposta).slice(0, 2000)
        : (looks.length ? 'Separei estas ideias para você:' : 'Desculpe, não consegui pensar numa resposta. Pode perguntar de outro jeito?'),
      looks, pecas, sugestoes
    });
  } catch (e) {
    console.error('Falha ao chamar o Gemini:', e);
    return res.status(502).json({ erro: 'Não foi possível falar com a IA agora.' });
  }
}

module.exports = handler;
module.exports.normalizarLooks = normalizarLooks;   // usado nos testes
module.exports.montarInstrucoes = montarInstrucoes;
