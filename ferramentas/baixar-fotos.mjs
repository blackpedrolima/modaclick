// Baixa as fotos do catálogo para a pasta img/ (opcional).
// Assim o site não depende do Unsplash para mostrar as fotos.
//
// Como usar (precisa do Node 18 ou mais novo):
//   1. Abra um terminal dentro da pasta modaclick
//   2. Rode:  node ferramentas/baixar-fotos.mjs
//   3. Publique o site junto com a pasta img/
//
// O site tenta, nesta ordem: Unsplash → img/<id>.jpg → imagem padrão.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pecas = [...html.matchAll(/\{ id: '([\w-]+)',[^}]*?foto: '([\w-]+)'/g)].map(m => ({ id: m[1], foto: m[2] }));
if (!pecas.length) throw new Error('Não encontrei o CATALOGO no index.html');

await mkdir(new URL('../img/', import.meta.url), { recursive: true });
let ok = 0;
for (const { id, foto } of pecas) {
  const url = `https://images.unsplash.com/photo-${foto}?auto=format&fit=crop&w=900&q=80&fm=jpg`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await writeFile(new URL(`../img/${id}.jpg`, import.meta.url), Buffer.from(await r.arrayBuffer()));
    console.log(`✅ ${id}`);
    ok++;
  } catch (e) {
    console.log(`❌ ${id}: ${e.message} — troque o código "foto" dessa peça no index.html`);
  }
}
console.log(`\n${ok} de ${pecas.length} fotos salvas em img/`);
