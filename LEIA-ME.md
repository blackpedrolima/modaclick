# ModaClick — Plataforma de moda com IA

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | O site inteiro: Início, **Roupas**, **Moda Click IA** e **Provador Virtual** |
| `api/chat.js` | Backend do chat Moda Click IA. Guarda a chave do Gemini em segredo |
| `api/provador-hf.js` | Backend da **IA gratuita** do provador (Hugging Face), usado no site publicado |
| `api/provador.js` | (Opcional, pago) Backend do provador pela FASHN |
| `package.json` / `vercel.json` | Dizem à Vercel para instalar a biblioteca do Hugging Face e dar até 5 minutos por geração |
| `servidor-local.mjs` | (Opcional) Roda o site e os backends no seu computador |
| `ferramentas/baixar-fotos.mjs` | (Opcional) Baixa as fotos do catálogo para a pasta `img/` |
| `.env.example` | Modelo das variáveis secretas (nunca coloque chaves reais aqui) |

## Como as três áreas conversam
- **Roupas → Provador:** o botão **➕ Adicionar ao look** leva a peça para o Provador Virtual.
- **Roupas → IA:** o botão "O que combina com ela?" faz essa pergunta para a Moda Click IA.
- **IA → Provador:** a IA recomenda peças do catálogo, e cada uma tem o botão "Experimentar".

---

## Provador Virtual: look completo com IA

### Como funciona para o cliente
1. Na página de uma roupa, ele clica em **➕ Adicionar ao look**. A peça vai para o espaço certo:
   - **Parte de cima:** camisetas, blusas, jaquetas, casacos
   - **Parte de baixo:** calças, saias
   - **Peça única:** vestidos, macacões, conjuntos (substitui cima e baixo)
2. Também dá para colocar **fotos próprias de roupas** em cada espaço (📷 câmera ou 🖼️ galeria).
3. Ele envia a **foto da pessoa**, tirada na hora ou da galeria.
4. Marca a autorização e clica em **✨ GERAR MEU LOOK**.
5. A IA aplica **uma peça de cada vez** na foto: primeiro a **parte de baixo**, depois a **parte de cima** sobre esse resultado. Se for peça única, só ela.
6. No resultado: comparação **antes e depois** (deslizar ou lado a lado), **Salvar imagem**, **Trocar ou adicionar peças**, **Gerar novamente** e **Descartar minhas fotos**.

O botão **🪄 Experimentar com IA** abre uma janela para provar **uma peça só**, bem rápido. De lá, **➕ Montar look completo** leva a peça (e a foto) para o Provador.

Acessórios (bolsas, óculos, joias) não entram no provador.

### As IAs usadas (escolhidas em "Como juntar as fotos?")
| Opção | Precisa de quê | O que faz |
|---|---|---|
| 🤗 **IA gratuita** (padrão) | Nada (o token `HF_TOKEN` é opcional) | **Parte de cima → IDM-VTON** (`yisol/IDM-VTON`). **Parte de baixo e peça única → OOTDiffusion** (`levihsu/OOTDiffusion`, modo corpo inteiro). No site publicado, quem chama a IA é o **servidor da Vercel** (`api/provador-hf.js`), porque esses espaços recusam chamadas feitas direto do navegador ("Failed to fetch"). Sem servidor, o site tenta pelo navegador. |
| 🖥️ **IA pelo servidor** | Chave paga `FASHN_API_KEY` na Vercel | FASHN, mais fiel à peça. Também aplica uma peça de cada vez. |
| 👀 **Teste sem IA** | Nada | Só mostra as fotos lado a lado, para testar a seleção. Não troca a roupa. |

**Limites da IA gratuita:**
- Pode ter **fila**, e a cota grátis de GPU é pequena. Um **token gratuito do Hugging Face** aumenta a cota: huggingface.co → Settings → Access Tokens → *Read*.
  - **Melhor jeito:** guardar na Vercel como `HF_TOKEN` (Settings → Environments → Production → **Redeploy**). Fica secreto e vale para todos.
  - Alternativa: colar no campo da opção IA gratuita. Fica salvo só naquele navegador.
  - ⚠️ **Nunca coloque o token no `index.html`**: o site e o repositório são públicos.
- Os espaços são públicos e de terceiros: se um sair do ar, aquela parte para até ele voltar.
- **Parte de baixo e vestidos** funcionam melhor com foto de **corpo inteiro**, de frente e em pé.
- Cada peça leva de 30 segundos a alguns minutos. Um look com 2 peças leva o dobro.

> ⚠️ **Na prévia de arquivos do Claude, a IA não funciona**: ela bloqueia conexões externas. Use o site publicado (Vercel) ou abra o `index.html` no navegador.

**Dica para apresentações:** gere os looks **antes** e guarde com **Salvar imagem**. Se houver fila na hora, vocês já têm os resultados.

### Privacidade
- As fotos só são enviadas depois que a pessoa marca a **autorização**.
- O ModaClick **não salva** as fotos: elas ficam só na memória da página, e "Descartar minhas fotos" apaga tudo. Só as peças do catálogo escolhidas ficam lembradas no navegador.
- Os espaços do Hugging Face guardam as fotos temporariamente para processar o pedido. Na FASHN, o resultado fica disponível por no máximo 60 minutos.
- No plano gratuito do Gemini, o Google pode usar as conversas do chat para melhorar os produtos dele. Oriente quem usar o site a **não colocar dados pessoais no chat**.

---

## Publicar na Vercel (grátis)

1. **GitHub:** crie um repositório e envie **tudo o que está dentro** da pasta `modaclick`. O `index.html`, o `package.json`, o `vercel.json` e a pasta `api` precisam ficar na raiz.
2. **Vercel:** em vercel.com, entre com o GitHub → **Add New → Project** → importe o repositório → **Framework Preset: Other** → **Deploy**.
3. **Chat (grátis):** crie a chave em **aistudio.google.com/apikey**. Na Vercel: projeto → **Settings → Environments → Production** → adicione `GEMINI_API_KEY` → **Save** → **Deployments → ⋯ → Redeploy**.
4. Para atualizar o site, envie os arquivos novos ao GitHub. A Vercel publica sozinha.

**Variáveis (todas opcionais):**

| Nome | Para que serve |
|---|---|
| `HF_TOKEN` | Token "Read" do Hugging Face: aumenta a cota da IA gratuita do provador |
| `GEMINI_API_KEY` | Liga o chat Moda Click IA (grátis) |
| `GEMINI_MODEL` | Troca o modelo do chat (padrão `gemini-3.8-flash`) |
| `FASHN_API_KEY` | Liga a opção paga "IA pelo servidor" no provador |
| `FASHN_MODE` | `performance`, `balanced` (padrão) ou `quality` |
| `ALLOWED_ORIGINS` | Libera outros sites a usar o chat (ex.: `null` para iframe `srcdoc`) |

---

## Fotos do catálogo
- O site tenta, nesta ordem: **Unsplash** → cópia local em `img/<id>.jpg` → **imagem padrão** do ModaClick. Nunca fica um espaço vazio.
- A prévia do Claude bloqueia fotos de outros sites. No navegador ou no site publicado, elas carregam.
- Para não depender do Unsplash: com o Node 18+, rode `node ferramentas/baixar-fotos.mjs` e publique junto com a pasta `img/`.

## Como adicionar peças ao catálogo
No `index.html`, procure `const CATALOGO = [` e copie um bloco:
```js
{ id: 'ves-07', nome: 'Vestido rosa', categoria: 'Vestidos', cores: ['Rosa'], tamanhos: ['P','M','G'], estilo: 'Festa',
  descricao: 'Descrição curta da peça.', foto: '1234567890-abcdef', credito: 'nome-da-foto-ABC123' },
```
- **Categorias:** Camisetas, Blusas, Jaquetas (parte de cima) · Calças, Saias (parte de baixo) · Vestidos, Conjuntos (peça única) · Acessórios (não entram no provador).
- `foto` é o código da imagem no Unsplash (a parte depois de `photo-`); `credito` é o final do endereço `unsplash.com/photos/...`.
- `enquadrar: 'contain'` mostra a peça inteira, sem cortes. Use em fotos da peça sozinha.
- **Cor nova:** adicione também em `CORES_HEX`. A IA do chat passa a recomendar as peças novas automaticamente.

## Testar no computador sem publicar
- **IA gratuita:** só abrir o `index.html` no Chrome ou Edge, com internet.
- **Chat, FASHN e IA gratuita pelo servidor:** com o Node 18+, copie `.env.example` para `.env`, coloque as chaves, rode `npm install` (uma vez) e `node servidor-local.mjs`, e abra `http://localhost:3000`.
