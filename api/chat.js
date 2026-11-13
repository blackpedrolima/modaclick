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
// ============================================================

const MODELO_PADRAO = 'gemini-3.8-flash';
const MAX_MENSAGENS = 20;        // histórico máximo enviado à IA
const MAX_CARACTERES = 1500;     // tamanho máximo de cada mensagem
const MAX_PECAS_CATALOGO = 200;  // proteção contra pedidos gigantes

const INSTRUCOES = `
Você é a "Moda Click IA", consultora de moda do site ModaClick.
Fale sempre em português do Brasil, de forma simpática, natural e curta (no máximo 2 parágrafos curtos ou uma lista curta).

O que você faz:
- Recomenda roupas de acordo com o estilo da pessoa.
- Ajuda a montar looks para ocasiões (festa, trabalho, passeio, jantar, eventos, escola, verão, inverno).
- Sugere combinações de peças e de cores que combinam entre si.
- Dá dicas de tendências e de estilo.
- Sempre que fizer sentido, recomenda peças do CATÁLOGO abaixo, usando os IDs exatos.

Regras importantes:
- Nunca faça comentários negativos, ofensivos ou julgamentos sobre o corpo de ninguém.
  Não diga que um corpo "deve" ou "não pode" usar algo, nem que alguém precisa esconder alguma característica.
  Foque em estilo, preferência, conforto e experimentação.
  Exemplo bom: "Se você quiser destacar a cintura, essa peça pode ser uma opção interessante."
- Só recomende peças do catálogo pelos IDs listados. Não invente peças, lojas, marcas, preços ou disponibilidade.
  As peças do catálogo não têm preço nem loja; são fotos de inspiração.
- Se o catálogo não tiver algo adequado, diga isso com naturalidade e dê a dica em texto.
- Não peça dados pessoais (nome completo, endereço, telefone, escola, idade, fotos).
- Se o assunto não for moda, estilo ou o site ModaClick, responda brevemente e traga a conversa de volta para moda.
- Mantenha tudo adequado para adolescentes.

Formato da resposta: JSON com
  "resposta": o texto para a pessoa (pode usar **negrito** e listas com "- "),
  "pecas": lista com até 4 IDs do catálogo recomendados nesta resposta (ou lista vazia).
`.trim();

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

function limparTexto(t) {
  return String(t || '').slice(0, MAX_CARACTERES);
}

module.exports = async function handler(req, res) {
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
  if (!chave) {
    return res.status(500).json({
      erro: 'A chave GEMINI_API_KEY não foi configurada na Vercel.'
    });
  }

  // ----- Lê e valida o pedido -----
  let corpo = req.body;
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo); } catch { corpo = null; }
  }
  if (!corpo || !Array.isArray(corpo.mensagens) || corpo.mensagens.length === 0) {
    return res.status(400).json({ erro: 'Envie { mensagens: [...] }.' });
  }

  const mensagens = corpo.mensagens.slice(-MAX_MENSAGENS).map(m => ({
    role: m.autor === 'ia' ? 'model' : 'user',
    parts: [{ text: limparTexto(m.texto) }]
  }));
  // A conversa enviada ao Gemini precisa começar com o usuário
  while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
  if (!mensagens.length) return res.status(400).json({ erro: 'Mensagem vazia.' });

  const catalogo = Array.isArray(corpo.catalogo) ? corpo.catalogo.slice(0, MAX_PECAS_CATALOGO) : [];
  const idsValidos = new Set(catalogo.map(p => String(p.id)));
  const textoCatalogo = catalogo.map(p =>
    `${String(p.id).slice(0, 20)} | ${String(p.nome).slice(0, 60)} | ${String(p.categoria).slice(0, 20)} | cores: ${[].concat(p.cores || []).join(', ').slice(0, 60)} | estilo: ${String(p.estilo).slice(0, 30)}`
  ).join('\n');

  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: `${INSTRUCOES}\n\nCATÁLOGO (ID | nome | categoria | cores | estilo):\n${textoCatalogo || '(vazio)'}` }]
        },
        contents: mensagens,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              resposta: { type: 'STRING' },
              pecas: { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['resposta', 'pecas']
          }
        }
      })
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      console.error('Erro do Gemini:', resposta.status, JSON.stringify(dados).slice(0, 500));
      const ocupado = resposta.status === 429;
      return res.status(ocupado ? 429 : 502).json({
        erro: ocupado
          ? 'Muitas perguntas ao mesmo tempo. Espere um minutinho e tente de novo.'
          : 'A IA não conseguiu responder agora.'
      });
    }

    const texto = dados?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let saida;
    try { saida = JSON.parse(texto); } catch { saida = { resposta: texto, pecas: [] }; }

    const pecas = [].concat(saida.pecas || [])
      .map(String)
      .filter(id => idsValidos.has(id))
      .slice(0, 4);

    return res.status(200).json({
      resposta: String(saida.resposta || 'Desculpe, não consegui pensar numa resposta. Pode perguntar de outro jeito?'),
      pecas
    });
  } catch (e) {
    console.error('Falha ao chamar o Gemini:', e);
    return res.status(502).json({ erro: 'Não foi possível falar com a IA agora.' });
  }
};
