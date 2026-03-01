# Verificação de Fontes Espíritas

## Regra Absoluta

**Nunca inventar citações.** Se não puder verificar no texto original, não citar como literal. Parafrasear é aceitável quando sinalizado ("Emmanuel nos ensina que..."), citação entre aspas exige verificação.

## Processo de Verificação

### Codificação (Kardec)

1. Extrair texto do PDF: `pdftotext <arquivo.pdf> /tmp/<nome>.txt`
2. Buscar por palavras-chave: `grep -n -i "termo" /tmp/<nome>.txt`
3. Ler contexto: `sed -n '<inicio>,<fim>p' /tmp/<nome>.txt`
4. Confirmar: capítulo, item/questão, e texto exato

Caminhos dos PDFs:
```
~/Obsidian/Personal/Attachments/evangelho-segundo-o-espiritismo.pdf
~/Obsidian/Personal/Attachments/O-Livro-dos-Espiritos.pdf
~/Obsidian/Personal/Attachments/A-Genese.pdf
~/Obsidian/Personal/Attachments/O-Céu-e-o-Inferno.pdf
```

### Obras Complementares

1. Verificar se o PDF está disponível localmente
2. Se disponível: mesmo processo (pdftotext + grep + ler contexto)
3. Se não disponível: tratar como referência contextual, não citação literal

### Passagens Bíblicas

1. Usar web-browser skill para acessar https://www.bibliaonline.com.br/acf/
2. Verificar o versículo citado E ler o capítulo inteiro para contexto
3. O contexto da passagem frequentemente revela conexões valiosas

### O que Registrar

Para cada fonte verificada, anotar na nota do Obsidian:
- Obra, capítulo/questão exata
- Citação literal (entre aspas)
- Autor espiritual (quando aplicável: São Luís, Isabel de França, etc.)
- Como se conecta ao texto base

## Erros Comuns a Evitar

- Citar "de memória" sem verificar — LLMs podem gerar citações plausíveis mas inexistentes
- Atribuir ao autor errado (ex: confundir Emmanuel com André Luiz)
- Citar capítulo/questão errada
- Parafrasear e colocar entre aspas como se fosse literal
- Usar obras que não foram verificadas como se fossem citação direta
