# Worker do Provador com IA (WeShop AI)

Este Worker é o **backend seguro** da janela "🪄 Experimentar com IA".
Ele guarda a chave `WESHOP_API_KEY` e conversa com a API oficial da WeShop. O site nunca vê a chave.

```
Site (index.html) ──► Worker (Cloudflare) ──► WeShop AI
                      guarda a chave            1. POST /openapi/agent/assets/images  (upload da roupa e da pessoa)
                      confere a origem          2. POST /openapi/agent/runs           (virtualtryon v1.0, weshopFlash, auto, batchCount 1)
                      valida as fotos           3. GET  /openapi/agent/runs/{executionId}  (consulta até "Success")
```

## Antes de começar
- **Conta na WeShop AI com créditos:** https://open.weshop.ai. A API é paga, por créditos. Gere a chave de API lá.
- **Conta grátis na Cloudflare:** https://dash.cloudflare.com/sign-up.
- ⚠️ **Nunca** cole a chave no `index.html`, no GitHub, em grupos ou em mensagens. Ela vai **só** no segredo do Worker.

---

## Jeito 1: pelo painel da Cloudflare (sem terminal)
Os nomes dos menus podem mudar um pouco com o tempo.

1. Entre em **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Create Worker**.
2. Dê o nome **`modaclick-provador`** e clique em **Deploy**.
3. Clique em **Edit code**, apague o código de exemplo, cole **todo** o conteúdo de `worker/src/index.js` e clique em **Deploy**.
4. Vá em **Settings → Variables and Secrets** e adicione:
   - **Type: Secret**, Name `WESHOP_API_KEY`, Value: a sua chave da WeShop. O tipo *Secret* esconde o valor depois de salvo.
   - **Type: Text**, Name `ALLOWED_ORIGINS`, Value: o endereço do site, sem barra no final. Por exemplo:
     `https://modaclick.pages.dev,http://localhost:3000`
5. Clique em **Deploy** para aplicar.
6. Copie o endereço do Worker, que é algo como `https://modaclick-provador.SEU-USUARIO.workers.dev`.
   Abra `.../status` no navegador. Deve aparecer `{"ok":true,"configurado":true}`.

## Jeito 2: pelo terminal (Wrangler)
Precisa do Node.js 18+.
```bash
cd worker
npx wrangler login                      # abre o navegador para entrar na Cloudflare
npx wrangler secret put WESHOP_API_KEY  # cole a chave quando pedir (ela não aparece na tela)
# edite ALLOWED_ORIGINS em wrangler.toml com o endereço do site
npx wrangler deploy                     # publica e mostra o endereço do Worker
```

---

## Ligar o site ao Worker
No `index.html`, procure `const PROVADOR_IA = {` e preencha:
```js
WORKER_URL: 'https://modaclick-provador.SEU-USUARIO.workers.dev',
```
Com `WORKER_URL` vazio, a janela fica em **modo demonstração**: mostra só uma ilustração marcada como "IMAGEM DEMONSTRATIVA" e não envia nada.

## Onde abrir o site para testar
O endereço onde o site está aberto precisa estar em `ALLOWED_ORIGINS`:

| Onde o site está aberto | O que colocar em `ALLOWED_ORIGINS` |
|---|---|
| Cloudflare Pages (grátis: Workers & Pages → Create → Pages → envie a pasta) | `https://SEU-PROJETO.pages.dev` |
| Servidor local (`node servidor-local.mjs`) | `http://localhost:3000` |
| Prévia do Claude ou arquivo aberto com dois cliques | ❌ Veja abaixo |

### E a prévia do Claude?
**Provavelmente não vai funcionar lá.** A prévia bloqueia conexões com sites externos. Foi por isso que as fotos do Unsplash e o iframe da WeShop não apareciam, e o mesmo deve acontecer com o Worker.

Além disso, a prévia (e um arquivo aberto com dois cliques) tem origem `null`. Liberar `null` em `ALLOWED_ORIGINS` deixaria **qualquer** arquivo aberto em qualquer computador usar os seus créditos. Por isso:
- Use a prévia para mexer no **visual**, em modo demonstração.
- Teste a IA de verdade no Cloudflare Pages ou no servidor local.

## Segurança que já vem pronta
- **CORS restrito:** só as origens de `ALLOWED_ORIGINS` recebem resposta. Nunca é usado `*`.
- **Fotos de catálogo:** só são baixadas do `images.unsplash.com`, então o Worker não vira um "proxy aberto".
- **Salvar imagem:** a rota `/imagem` só baixa resultados de domínios da WeShop.
- **Validação das fotos:** só JPG, PNG ou WEBP, até 10 MB. O site também confere as regras da WeShop: mais de 512 px e proporção menor que 2:1.
- **Autorização:** o envio só acontece com a autorização marcada, e o Worker confere.
- **Sem registros:** o Worker não guarda fotos nem registra imagens em log.
- **Limite de pedidos por IP (opcional, recomendado):** descomente o bloco `[[ratelimits]]` em `wrangler.toml`.
  Isso protege os seus créditos se alguém tentar abusar.

## Importante sobre o resultado
No agente `virtualtryon`, a foto da pessoa vai em `fashionModelImage`. A documentação descreve esse campo como *"a modelo gerada vai se parecer com esta pessoa"*. Ou seja: **não é garantido que seja exatamente a mesma pessoa**, e o rosto ou o corpo podem mudar. A janela avisa isso no resultado.

## Erros comuns
| Mensagem | O que fazer |
|---|---|
| "Origem não permitida" / "recusou este site" | Coloque o endereço exato do site em `ALLOWED_ORIGINS` e faça Deploy. |
| "O segredo WESHOP_API_KEY não foi cadastrado" | Adicione o segredo (passo 4) e faça Deploy. |
| "A chave da WeShop é inválida" | Gere outra chave na WeShop e atualize o segredo. |
| "A conta da WeShop está sem créditos" | Compre ou recarregue créditos na WeShop. |
| "Não conseguimos falar com o servidor (Worker)" | Confira o `WORKER_URL` e a internet. Na prévia do Claude, isso é esperado. |
