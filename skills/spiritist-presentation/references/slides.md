# Diretrizes para Slides PowerPoint

## Filosofia

Slides são **âncoras visuais** para o apresentador. O público deve prestar atenção na pessoa que fala, não ficar lendo slides. Quando alguém lê um slide, para de ouvir.

## Design Visual

### Configuração
- Widescreen: 13.333 x 7.5 polegadas
- `python-pptx` para geração
- Slides em branco (layout 6) — controle total

### Paleta de Cores
```python
BG_DARK    = RGBColor(0x1A, 0x1A, 0x2E)   # fundo principal
BG_MEDIUM  = RGBColor(0x22, 0x22, 0x3A)   # variação (alterna entre slides)
TEXT_WHITE = RGBColor(0xF5, 0xF0, 0xE8)   # texto principal (branco quente)
TEXT_GOLD  = RGBColor(0xD4, 0xAF, 0x6A)   # destaques, títulos de conceito
TEXT_DIM   = RGBColor(0x9A, 0x95, 0x8C)   # referências, citações do texto base
ACCENT     = RGBColor(0xC4, 0x8A, 0x5A)   # alertas, contrastes
```

Alternar `BG_DARK` e `BG_MEDIUM` entre slides para ritmo visual sutil.

### Tipografia
- Fonte: Georgia (serifada, contemplativa)
- Títulos de conceito: 40-56pt, GOLD, bold
- Texto principal: 30-38pt, WHITE
- Citações do texto base: 18-24pt, DIM, italic
- Referências: 16-18pt, DIM

### Margens
- Esquerda/direita: 1.5 polegadas
- Topo: 1.2 polegadas

## Tipos de Slide

### Título
- Nome do capítulo grande, centralizado, GOLD
- Livro + capítulo abaixo, DIM
- Linha decorativa dourada
- Autor, DIM, italic

### Citação Bíblica / Epígrafe
- Texto em itálico, WHITE, centralizado
- Referência abaixo, DIM
- Espaço generoso

### Conceito (âncora do texto base)
- 1-3 palavras de título em GOLD, bold, grande (44-56pt)
- Citação curta do texto base abaixo, DIM, italic, pequena

### Exemplo / Cenário
- Contexto em DIM (o que está acontecendo)
- Frase-chave em WHITE, bold
- Sem citação do texto — o slide é sobre a vida real

### Fonte Complementar
- Citação em WHITE, italic, centralizada
- Referência completa (obra, capítulo, item, autor espiritual), DIM

### Síntese / Insight
- 2-3 frases curtas em WHITE
- Linha separadora dourada
- Conclusão em GOLD, bold

### Momento Pessoal
- Texto em WHITE, centralizado
- Tom vulnerável, simples
- Pode ter uma segunda linha em GOLD

### Fechamento
- Volta ao cenário + citação final do capítulo em GOLD, italic

## Regras de Conteúdo

1. **Máximo 15 palavras por slide** (exceto citações)
2. Citações do texto base: curtas, 1-2 frases, italic, tamanho menor
3. Nunca colocar parágrafos inteiros
4. Um conceito por slide
5. Sem bullet points — frases soltas com espaço
6. Referências sempre no rodapé, discretas
