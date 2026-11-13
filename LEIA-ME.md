# ModaClick — Plataforma de moda com IA

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | O site inteiro: Início, **Roupas**, **Moda Click IA** e **Provador Virtual** |
| `api/chat.js` | O backend da Moda Click IA. Ele guarda a chave do Gemini em segredo |
| `api/provador.js` | O backend do Provador Virtual com IA (FASHN ou WeShop). Ele guarda a chave em segredo |
| `worker/` | Backend no **Cloudflare Worker** para a WeShop AI (janela "Experimentar com IA"). Veja `worker/LEIA-ME-WORKER.md` |
| `servidor-local.mjs` | Roda o site e a IA no seu computador, sem publicar |
| `ferramentas/baixar-fotos.mjs` | (Opcional) Baixa as fotos do catálogo para a pasta `img/` |
| `.env.example` | Modelo das variáveis secretas (não coloque a chave real aqui) |
| `_versao-anterior-provador.html` | Backup da página anterior do provador |

## Como as três áreas conversam

- **Roupas → Provador:** o botão "Experimentar" leva a peça escolhida para o Provador Virtual.
- **Roupas → IA:** o botão "O que combina com ela?" faz essa pergunta para a Moda Click IA.
- **IA → Provador:** a IA recomenda peças do catálogo, e cada uma tem o botão "Experimentar".

---

## Passo a passo para publicar (Vercel, grátis)

### 1. Criar a chave do Gemini (o professor faz)

1. Acesse **https://aistudio.google.com/apikey** com uma conta Google.
2. Clique em **Create API key** e copie a chave.
3. ⚠️ **Nunca** coloque essa chave no `index.html` nem mande no grupo. Ela vai só na Vercel (passo 3).

### 2. Subir o projeto

1. Crie uma conta em **https://vercel.com** (pode entrar com o GitHub).
2. Opção mais fácil: coloque esta pasta num repositório do GitHub. Na Vercel, clique em **Add New → Project** e escolha o repositório.
3. Não precisa mudar nenhuma configuração de build. Pode deixar tudo como está.

### 3. Guardar a chave em segredo

1. No projeto da Vercel, vá em **Settings → Environment Variables**.
2. Adicione:
   - Nome: `GEMINI_API_KEY`
   - Valor: a chave copiada no passo 1
3. Clique em **Save** e depois em **Deployments → ⋯ → Redeploy**.

Pronto! Acesse o link do site e teste a aba **Moda Click IA**.

### Variáveis opcionais

| Nome | Para que serve |
|---|---|
| `GEMINI_MODEL` | Troca o modelo de IA. O padrão é `gemini-3.8-flash` |
| `ALLOWED_ORIGINS` | Libera outros sites a usar o chat. Use `null` se o site rodar dentro de um iframe com `srcdoc` |

---

## Se o site rodar dentro de um iframe com `srcdoc`

Dentro de um `srcdoc` não existe servidor, então o chat precisa do endereço completo do backend:

1. Publique na Vercel como explicado acima.
2. No `index.html`, procure `CONFIG` e troque `API_CHAT: '/api/chat'` pelo endereço completo, por exemplo:
   `API_CHAT: 'https://modaclick.vercel.app/api/chat'`
3. Na Vercel, adicione a variável `ALLOWED_ORIGINS` com o valor `null` e faça **Redeploy**.

---

## Janela "🪄 Experimentar com IA" (WeShop AI)

Na página de cada roupa, o botão **🪄 Experimentar com IA** abre uma janela com:
1. a roupa selecionada;
2. o envio da foto de corpo (câmera ou galeria);
3. o botão **Gerar meu look**;
4. o resultado;
5. a comparação entre a foto original e o resultado, de dois jeitos: **deslizar** ou **lado a lado**.

- **Modo demonstração** (padrão, com `PROVADOR_IA.WORKER_URL` vazio): nada é enviado. O resultado é uma **ilustração marcada como "IMAGEM DEMONSTRATIVA · não foi gerada por IA"**.
- **Modo real:** preencha `WORKER_URL` com o endereço do Worker. O passo a passo completo está em **`worker/LEIA-ME-WORKER.md`**.

O botão **"Provador completo"** continua levando para a aba Provador Virtual, com as opções FASHN, IA gratuita e teste sem IA.

---

## Provador Virtual com IA

### Como funciona
1. No catálogo, a pessoa clica em **✨ Experimentar virtualmente**. A peça já entra como "Foto da roupa".
2. Também dá para **tirar uma foto** ou escolher da **galeria**, tanto da roupa quanto da pessoa.
3. As duas fotos aparecem em prévia, com os botões **Trocar** e **Remover**.
4. A pessoa marca a **autorização** e clica em **GERAR MEU LOOK**. O botão só aparece quando as duas fotos estão prontas.
5. O servidor envia as fotos para uma **API de prova virtual de verdade** e devolve a imagem gerada. No resultado aparecem os botões **Salvar imagem**, **Experimentar outra roupa**, **Gerar novamente** e **Descartar minhas fotos**.

Acessórios (bolsas, óculos, joias) não entram no provador. A IA de prova virtual funciona com roupas.

### Testar SEM publicar o site

Na tela do provador, em **"Como juntar as fotos?"**, há três opções. O botão é sempre **JUNTAR FOTOS**.

| Opção | Precisa de quê | O que faz |
|---|---|---|
| 🤗 **IA gratuita** | Nada! Basta abrir o `index.html` no navegador (Chrome, Edge…) com internet | Usa a IA de verdade de um espaço público do Hugging Face (**IDM-VTON**), direto do navegador. **Só troca peças da parte de cima** (camisetas, blusas, jaquetas). Pode ter fila, e a cota grátis de GPU é pequena: um token gratuito do Hugging Face (huggingface.co → Settings → Access Tokens) aumenta a cota. |
| 👀 **Teste sem IA** | Nada | Mostra as duas fotos **lado a lado**, com o aviso "TESTE SEM IA: a roupa NÃO foi trocada". Serve para testar a seleção e o envio das fotos. Não envia nada para lugar nenhum. |
| 🖥️ **IA pelo servidor** | Servidor local **ou** site publicado, com a chave da FASHN | Prova virtual completa: blusas, calças, saias e vestidos. |

**Servidor local (FASHN sem publicar):**
1. Instale o **Node.js 18+** (https://nodejs.org).
2. Copie `.env.example` para `.env` e cole sua chave em `FASHN_API_KEY`.
3. No terminal, dentro da pasta, rode `node servidor-local.mjs`.
4. Abra **http://localhost:3000**. A opção "IA pelo servidor" fica disponível.

> Na **prévia de arquivos do Claude** nada disso funciona, porque ela bloqueia conexões externas. Abra o arquivo no navegador do computador.

### Ligar a IA (obrigatório para funcionar)
A IA recomendada é a **FASHN**. Ela foi feita só para prova virtual: preserva o rosto, o cabelo, o corpo e a pose, e reproduz a roupa com fidelidade.

1. Crie uma conta em **https://app.fashn.ai** e gere uma chave de API (*API Keys*). A API cobra **1 crédito por imagem** e os créditos são pagos. Confira o preço no site.
2. Na Vercel, em **Settings → Environment Variables**, adicione `FASHN_API_KEY` com a chave. Depois faça **Redeploy**.
3. Abra o site publicado, vá em **Provador Virtual** e teste. Se a chave não estiver configurada, o próprio site avisa.

Se preferirem a **WeShop**, coloquem `WESHOP_API_KEY` no lugar da chave da FASHN. A variável opcional `PROVADOR_PROVEDOR` (`fashn` ou `weshop`) força a escolha.

| Variável | Para que serve |
|---|---|
| `FASHN_API_KEY` | Chave da FASHN (recomendada) |
| `FASHN_MODE` | `performance` (mais rápido), `balanced` (padrão) ou `quality` (melhor, uns 15 s) |
| `WESHOP_API_KEY` / `WESHOP_VERSION` | Alternativa: WeShop |
| `PROVADOR_PROVEDOR` | Força `fashn` ou `weshop` |

> ⚠️ O provador **não funciona na prévia de arquivos do Claude** nem abrindo o `index.html` direto no computador, porque precisa do servidor (`api/provador.js`) com a chave. Nesses casos, o site mostra um aviso e **não inventa resultado**.

### Privacidade
- As fotos só são enviadas depois que a pessoa marca **"Autorizo o processamento das minhas fotos"**. O servidor também confere essa autorização.
- O ModaClick **não salva** as fotos: elas ficam só na memória da página, e "Descartar minhas fotos" apaga tudo. O `api/provador.js` não grava nem registra as imagens.
- Na FASHN, o resultado é pedido em base64, então fica disponível lá por no máximo 60 minutos (o padrão seria 3 dias).

---

## Fotos do catálogo

**Por que as fotos apareciam vazias:** as fotos vêm do Unsplash, um site externo. A **prévia de arquivos do Claude bloqueia imagens de outros sites** por segurança. É a mesma regra que bloqueava o iframe da WeShop. Num navegador normal (abrindo o `index.html` no Chrome ou Edge) ou com o site publicado, as fotos carregam.

**O que o site faz agora**, para cada foto:
1. Tenta carregar a foto do **Unsplash**.
2. Se não der, tenta a **cópia local** em `img/<id>.jpg` (por exemplo, `img/ves-01.jpg`).
3. Se também não der, mostra a **imagem padrão do ModaClick**: um cabide rosa com "Foto indisponível". Nunca fica um espaço vazio.

Se nenhuma foto carregar, aparece um aviso explicando o motivo.

**Para não depender do Unsplash (recomendado ao publicar):**
1. Com o Node 18+ instalado, rode `node ferramentas/baixar-fotos.mjs` dentro da pasta.
2. As fotos são salvas em `img/`. Publique o site junto com essa pasta.
3. O script avisa se alguma foto não existir mais. Nesse caso, troquem o código `foto` dessa peça.

**Enquadramento:** as peças fotografadas sozinhas usam `enquadrar: 'contain'`, que mostra a peça inteira sem cortes. As fotos com modelo preenchem o card, centralizadas na parte de cima, para não cortar o rosto.

---

## Como adicionar peças ao catálogo

No `index.html`, procure `const CATALOGO = [` e copie um bloco:

```js
{ id: 'ves-07', nome: 'Vestido rosa', categoria: 'Vestidos', cores: ['Rosa'], tamanhos: ['P','M','G'], estilo: 'Festa',
  descricao: 'Descrição curta da peça.', foto: '1234567890-abcdef', credito: 'nome-da-foto-ABC123' },
```

- **Categorias aceitas:** Camisetas, Calças, Vestidos, Saias, Blusas, Jaquetas, Conjuntos, Acessórios.
- **`foto`:** o código da imagem no Unsplash (a parte depois de `photo-` no endereço da imagem).
- **`credito`:** o final do endereço da página da foto (`unsplash.com/photos/...`).
- **Cor nova:** adicione também em `CORES_HEX`, para a bolinha de cor aparecer.
- A IA passa a recomendar as peças novas automaticamente.

## Privacidade

- No plano gratuito do Gemini, o Google pode usar as conversas para melhorar os produtos dele. Por isso, oriente quem usar o site a **não colocar dados pessoais no chat**.
- As fotos do provador só saem do navegador depois da autorização, e vão apenas para a API de prova virtual (FASHN ou WeShop).
