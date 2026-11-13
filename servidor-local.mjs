// ============================================================
//  Servidor local do ModaClick — testar SEM publicar o site
//
//  Roda o site e os backends (api/chat.js e api/provador.js) no seu
//  computador, para usar a IA da FASHN (ou WeShop) e a Moda Click IA.
//
//  Como usar (precisa do Node 18 ou mais novo: https://nodejs.org):
//    1. Copie .env.example para .env e cole sua chave em FASHN_API_KEY
//       (e GEMINI_API_KEY, se quiser o chat).
//    2. No terminal, dentro da pasta modaclick, rode:
//         node servidor-local.mjs
//    3. Abra no navegador:  http://localhost:3000
//
//  O arquivo .env fica só no seu computador. Nunca envie ele para ninguém.
// ============================================================

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 3000;

// Lê o .env (formato NOME=valor), sem precisar de pacotes
const arquivoEnv = path.join(pasta, '.env');
if (existsSync(arquivoEnv)) {
  for (const linha of readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m && !m[2].startsWith('cole-a-chave') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const require = createRequire(import.meta.url);
const rotas = {
  '/api/chat': require('./api/chat.js'),
  '/api/provador': require('./api/provador.js')
};

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const BLOQUEADOS = ['.env', 'servidor-local.mjs'];

http.createServer((req, res) => {
  // Ajudantes no estilo da Vercel
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };

  const caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rotas[caminho]) {
    let corpo = '', tamanho = 0;
    req.on('data', (d) => {
      tamanho += d.length;
      if (tamanho > 10 * 1024 * 1024) { res.status(413).json({ erro: 'Pedido grande demais.' }); req.destroy(); return; }
      corpo += d;
    });
    req.on('end', async () => {
      try { req.body = corpo ? JSON.parse(corpo) : null; } catch { req.body = corpo; }
      try { await rotas[caminho](req, res); }
      catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ erro: 'Erro no servidor local.' }); }
    });
    return;
  }

  // Arquivos do site
  const relativo = caminho === '/' ? 'index.html' : caminho.replace(/^\/+/, '');
  const arquivo = path.normalize(path.join(pasta, relativo));
  if (!arquivo.startsWith(pasta) || BLOQUEADOS.includes(path.basename(arquivo))) { res.statusCode = 403; return res.end(); }
  readFile(arquivo).then((dados) => {
    res.setHeader('Content-Type', TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream');
    res.end(dados);
  }).catch(() => { res.statusCode = 404; res.end('Não encontrado'); });
}).listen(PORTA, () => {
  const provador = process.env.FASHN_API_KEY ? 'FASHN ✅' : process.env.WESHOP_API_KEY ? 'WeShop ✅' : 'sem chave ⚠️ (use a IA gratuita ou coloque FASHN_API_KEY no .env)';
  console.log(`\n🌸 ModaClick rodando em http://localhost:${PORTA}`);
  console.log(`   Provador com IA pelo servidor: ${provador}`);
  console.log(`   Moda Click IA (chat): ${process.env.GEMINI_API_KEY ? 'Gemini ✅' : 'sem chave ⚠️ (GEMINI_API_KEY no .env)'}`);
  console.log('   Para parar: Ctrl + C\n');
});
