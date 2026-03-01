---
name: spiritist-presentation
description: >
  Criar apresentações espíritas no estilo palestra, baseadas em capítulos de livros
  espíritas (Pão Nosso, Fonte Viva, Caminho Verdade e Vida, etc.). Usar quando o
  usuário pedir para criar uma apresentação, palestra ou estudo aprofundado sobre
  um capítulo de livro espírita. O processo é colaborativo: análise do texto base
  parágrafo a parágrafo, pesquisa de fontes complementares verificadas (codificação +
  obras complementares), construção de um exemplo recorrente, e geração de slides
  PowerPoint minimalistas com roteiro de fala. Diferente da reflexão de abertura
  (2 min), estas são apresentações de 15-25 minutos. A ênfase central é fidelidade
  absoluta ao texto base. Também usar quando o usuário mencionar "apresentação
  espírita", "palestra espírita", "estudo de capítulo para apresentação", ou quiser
  criar slides para centro espírita.
---

# Apresentações Espíritas

Criar apresentações no estilo palestra (15-25 min) baseadas em capítulos de livros espíritas, com slides PowerPoint minimalistas e roteiro de fala detalhado.

## Princípio Central: Fidelidade ao Texto Base

**Esta é a regra que governa tudo.** O texto base do capítulo é o centro da apresentação. Cada ponto da apresentação deve ter raiz direta no texto. Fontes complementares existem para iluminar o texto base, nunca para substituí-lo ou desviar dele.

Quando o usuário ou a pesquisa introduzir conceitos não presentes no capítulo:
1. Reconhecer a ideia
2. Verificar se há conexão direta com o texto
3. Se não houver, redirecionar: "Como podemos conectar isso ao que o autor escreveu?"

## Fluxo de Trabalho

### 1. Obter e Analisar o Texto Base

Extrair o capítulo. Para o Pão Nosso, usar:
```bash
python3 SKILL_DIR/../pao-nosso-reflexao/scripts/extrair_capitulo.py <numero> <caminho_pdf>
```
PDF padrão: `~/Obsidian/Personal/Attachments/039__Pao_Nosso_1950.pdf`

Para outros livros, solicitar o PDF ou texto ao usuário.

**Análise parágrafo a parágrafo:** Mapear a estrutura do capítulo identificando:
- Epígrafe (passagem bíblica) e seu contexto original
- Tema central de cada parágrafo
- Progressão lógica do autor (como as ideias se constroem)
- Frases-chave que servirão de âncora nos slides

### 2. Discussão Colaborativa do Texto

Conduzir conversa com o usuário seguindo estas perguntas:
- "Qual o tema central deste capítulo?"
- "Que ideias específicas mais chamaram sua atenção?"
- "Como esse ensinamento se aplica ao dia a dia?"

**Não criar a apresentação automaticamente.** Desenvolver juntos, iterando.

### 3. Pesquisa e Verificação de Fontes

Buscar 2-3 fontes complementares, com pelo menos uma da codificação.

#### Fontes da Codificação (PDFs no Obsidian Vault)
Extrair texto com `pdftotext` e buscar com `grep`:
- `~/Obsidian/Personal/Attachments/evangelho-segundo-o-espiritismo.pdf`
- `~/Obsidian/Personal/Attachments/O-Livro-dos-Espiritos.pdf`
- `~/Obsidian/Personal/Attachments/A-Genese.pdf`
- `~/Obsidian/Personal/Attachments/O-Céu-e-o-Inferno.pdf`

**Processo de verificação — ver `references/verificacao-fontes.md`.**

#### Epígrafe Bíblica
Verificar o contexto original da passagem bíblica (capítulo completo), não apenas o versículo isolado. Usar web-browser skill para consultar o texto em https://www.bibliaonline.com.br/acf/. Contexto frequentemente revela conexões que enriquecem a análise.

#### Obras Complementares
Para livros de Emmanuel, André Luiz e outros: verificar se o PDF está disponível localmente (~/Downloads ou ~/Obsidian/Personal/Attachments). Se não estiver, tratar citações como contextuais — nunca inventar texto.

### 4. Construir Exemplo Recorrente

Encontrar **um único cenário cotidiano** que acompanhe toda a apresentação, crescendo junto com a progressão do texto. Critérios:
- Universal (todos se identificam)
- Concreto e específico (não abstrato)
- Capaz de se desenvolver slide a slide, como o autor desenvolve suas ideias
- Conectado diretamente ao texto (não forçado)

Discutir opções com o usuário. Oferecer 2-3 cenários e deixar escolher.

### 5. Criar Nota no Obsidian

Salvar anotações de trabalho em `~/Obsidian/Personal/Notes/` usando template Spiritist Study. Incluir:
- Texto base completo
- Análise parágrafo a parágrafo
- Fontes verificadas com citações exatas
- Exemplo recorrente desenvolvido
- Roteiro de fala (o que dizer em cada slide)

Esta nota é a fonte de preparação — mais importante que os slides.

### 6. Gerar Slides PowerPoint

Usar `python-pptx`. Seguir as diretrizes em `references/slides.md`.

**Princípio:** Slides são âncoras visuais, não teleprompters. Poucas palavras. O público deve prestar atenção no apresentador, não ler slides.

### 7. Roteiro de Fala

Para cada slide, escrever na nota do Obsidian o que o apresentador deve dizer. Tom: conversacional, pessoal, vulnerável quando apropriado. Não é sermão — é conversa entre irmãos.

## Estrutura da Apresentação

Estrutura padrão (adaptar conforme o capítulo):

1. **Abertura com cenário** (1-2 slides): Exemplo cotidiano que puxa atenção, sem revelar o tema
2. **Epígrafe** (1-2 slides): Passagem bíblica + contexto original
3. **Desenvolvimento** (15-20 slides): Parágrafo a parágrafo do texto base, intercalando:
   - Trecho-âncora do texto original
   - Exemplo recorrente aplicado àquele ponto
   - Fonte complementar quando iluminar o ponto
4. **Momento pessoal** (1-2 slides): Honestidade, vulnerabilidade — "nós também lutamos com isso"
5. **Fechamento** (2-3 slides): Volta ao cenário de abertura + frase final do capítulo
6. **Referências** (1 slide): Todas as fontes citadas

## Checklist Final

- [ ] Cada slide tem conexão direta com o texto base?
- [ ] As fontes complementares iluminam o texto (não desviam)?
- [ ] Todas as citações foram verificadas nos PDFs originais?
- [ ] Nenhuma citação foi inventada ou parafraseada como se fosse literal?
- [ ] O exemplo recorrente funciona em todos os pontos?
- [ ] Os slides têm poucas palavras (âncoras, não parágrafos)?
- [ ] O roteiro de fala cobre ~15-25 minutos?
- [ ] O tom é pessoal e conversacional?
- [ ] A nota no Obsidian está completa como material de preparação?
