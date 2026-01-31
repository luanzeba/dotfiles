#!/usr/bin/env python3
"""
Script para extrair um capítulo específico do livro Pão Nosso.
Usa pdftotext se disponível, caso contrário retorna instruções para extração manual.
"""

import subprocess
import sys
import re
import os

def extrair_capitulo(numero_capitulo, caminho_pdf):
    """
    Extrai um capítulo do PDF do Pão Nosso.

    Args:
        numero_capitulo: Número do capítulo (1-180)
        caminho_pdf: Caminho para o arquivo PDF do Pão Nosso

    Returns:
        Texto do capítulo ou None se não encontrado
    """
    # Verifica se pdftotext está disponível
    try:
        subprocess.run(['which', 'pdftotext'], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        print("ERRO: pdftotext não está disponível no sistema.", file=sys.stderr)
        print("Por favor, instale poppler-utils ou forneça o texto do capítulo manualmente.", file=sys.stderr)
        return None

    # Extrai todo o texto do PDF (sem -layout para formato mais limpo)
    try:
        result = subprocess.run(
            ['pdftotext', caminho_pdf, '-'],
            capture_output=True,
            text=True,
            check=True
        )
        texto_completo = result.stdout
    except subprocess.CalledProcessError as e:
        print(f"ERRO ao extrair texto do PDF: {e}", file=sys.stderr)
        return None

    # Procura pelo capítulo específico
    # Padrão: número em uma linha, seguido de título
    # Usamos \s* para lidar com possíveis espaços extras
    padrao = rf'^\s*{numero_capitulo}\s*\n(.+?)\n'
    match = re.search(padrao, texto_completo, re.MULTILINE)

    if not match:
        print(f"ERRO: Capítulo {numero_capitulo} não encontrado no PDF.", file=sys.stderr)
        return None

    titulo = match.group(1).strip()
    posicao_inicio = match.end()

    # Procura pelo próximo capítulo para saber onde termina
    proximo_numero = numero_capitulo + 1
    padrao_proximo = rf'^\s*{proximo_numero}\s*\n'
    match_proximo = re.search(padrao_proximo, texto_completo[posicao_inicio:], re.MULTILINE)

    if match_proximo:
        posicao_fim = posicao_inicio + match_proximo.start()
        conteudo = texto_completo[posicao_inicio:posicao_fim]
    else:
        # Último capítulo do livro
        conteudo = texto_completo[posicao_inicio:]

    # Limpa o conteúdo
    conteudo = conteudo.strip()

    # Monta o texto completo do capítulo
    capitulo_completo = f"{numero_capitulo}\n{titulo}\n{conteudo}"

    return capitulo_completo

def main():
    if len(sys.argv) < 3:
        print("Uso: python3 extrair_capitulo.py <numero_capitulo> <caminho_pdf>")
        print("Exemplo: python3 extrair_capitulo.py 65 /caminho/para/Pao_Nosso.pdf")
        sys.exit(1)

    try:
        numero_capitulo = int(sys.argv[1])
        if numero_capitulo < 1 or numero_capitulo > 180:
            print("ERRO: Número do capítulo deve estar entre 1 e 180.", file=sys.stderr)
            sys.exit(1)
    except ValueError:
        print("ERRO: Número do capítulo deve ser um número inteiro.", file=sys.stderr)
        sys.exit(1)

    caminho_pdf = sys.argv[2]

    if not os.path.exists(caminho_pdf):
        print(f"ERRO: Arquivo não encontrado: {caminho_pdf}", file=sys.stderr)
        sys.exit(1)

    capitulo = extrair_capitulo(numero_capitulo, caminho_pdf)

    if capitulo:
        print(capitulo)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
