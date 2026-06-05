#!/usr/bin/env python3
"""
Extrai capítulo de livros espíritas.

Modos de uso:
1) Coleção Fonte Viva (recomendado)
   python3 scripts/extrair_capitulo.py "<livro>" <capitulo> [caminho_vault]

2) PDF direto (compatibilidade)
   python3 scripts/extrair_capitulo.py <capitulo> <caminho_pdf>
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import unicodedata
from typing import Dict, List, Optional, Tuple

DEFAULT_VAULT = "/Users/luan/Obsidian/Personal"


def normalize_key(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def discover_collection_books(vault_path: str) -> Dict[str, str]:
    notes_dir = os.path.join(vault_path, "Notes")
    attachments_dir = os.path.join(vault_path, "Attachments")

    if not os.path.isdir(notes_dir):
        raise FileNotFoundError(f"Diretório de notas não encontrado: {notes_dir}")

    books: Dict[str, str] = {}

    for name in os.listdir(notes_dir):
        if not name.endswith(".md"):
            continue

        note_path = os.path.join(notes_dir, name)
        note_text = read_text_file(note_path)

        if not re.search(r"(?im)^collection:\s*[\"']?Fonte Viva[\"']?\s*$", note_text):
            continue

        pdf_match = re.search(r"!\[\[([^\]\n]+\.pdf)\]\]", note_text, flags=re.IGNORECASE)
        if not pdf_match:
            continue

        pdf_name = pdf_match.group(1).strip()
        pdf_path = os.path.join(attachments_dir, pdf_name)

        if not os.path.exists(pdf_path):
            continue

        book_name = name[:-3]
        books[book_name] = pdf_path

    return books


def resolve_book_name(user_book: str, books: Dict[str, str]) -> Optional[str]:
    target = normalize_key(user_book)
    if not target:
        return None

    exact = [book for book in books if normalize_key(book) == target]
    if exact:
        return exact[0]

    partial = [book for book in books if target in normalize_key(book) or normalize_key(book) in target]
    if len(partial) == 1:
        return partial[0]

    if len(partial) > 1:
        # Escolhe o nome mais curto como heurística simples de melhor match.
        return sorted(partial, key=len)[0]

    return None


def ensure_pdftotext() -> None:
    if shutil.which("pdftotext"):
        return
    raise RuntimeError("pdftotext não está disponível no sistema. Instale poppler-utils/poppler.")


def extract_pdf_text(pdf_path: str) -> str:
    try:
        result = subprocess.run(
            ["pdftotext", pdf_path, "-"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Erro ao extrair texto do PDF: {exc}") from exc

    return result.stdout


def is_probable_title(line: str) -> bool:
    title = line.strip()
    if not title:
        return False
    if len(title) > 100:
        return False
    if re.fullmatch(r"\d+", title):
        return False
    if re.search(r"\.{4,}", title):
        return False
    if len(title.split()) > 14:
        return False

    low = title.lower()
    if low.startswith(("capítulo", "capitulo", "sumário", "sumario", "índice", "indice", "conteúdo", "conteudo")):
        return False

    return True


def next_nonempty_line(lines: List[str], start: int) -> Tuple[Optional[int], Optional[str]]:
    idx = start
    while idx < len(lines):
        line = lines[idx].strip()
        if line:
            return idx, line
        idx += 1
    return None, None


Candidate = Tuple[int, int, str, int]  # score, start_line, title, content_start_line


def chapter_candidates(lines: List[str], chapter: int, start_line: int = 0) -> List[Candidate]:
    candidates: List[Candidate] = []
    chapter_str = str(chapter)

    for i in range(max(0, start_line), len(lines) - 1):
        current = lines[i].strip()

        # Padrão 1: número do capítulo em linha própria + título na linha seguinte
        if current == chapter_str:
            title_idx, title = next_nonempty_line(lines, i + 1)
            if title and title_idx is not None and is_probable_title(title):
                score = 0
                if i > 120:
                    score += 1

                _, after_title = next_nonempty_line(lines, title_idx + 1)
                if after_title and (after_title.startswith(("“", '"', "'")) or "—" in after_title or "–" in after_title):
                    score += 2

                candidates.append((score, i, title, title_idx + 1))

        # Padrão 2: "CAPÍTULO <n> = TÍTULO"
        m = re.match(
            rf"(?i)^\s*CAP[IÍ]TULO\s+{chapter}\s*[:=\-–—]?\s*(.+?)\s*$",
            lines[i],
        )
        if m:
            title = m.group(1).strip()
            if is_probable_title(title):
                score = 0
                if i > 120:
                    score += 1

                _, after_line = next_nonempty_line(lines, i + 1)
                if after_line and (after_line.startswith(("“", '"', "'")) or "—" in after_line or "–" in after_line):
                    score += 2

                candidates.append((score, i, title, i + 1))

        # Padrão 3: "<n> - TÍTULO"
        m = re.match(rf"^\s*{chapter}\s*[\-–—]\s*(.+?)\s*$", current)
        if m:
            title = m.group(1).strip()
            if is_probable_title(title):
                score = 0
                if i > 120:
                    score += 1

                _, after_line = next_nonempty_line(lines, i + 1)
                if after_line and (after_line.startswith(("“", '"', "'")) or "—" in after_line or "–" in after_line):
                    score += 2

                candidates.append((score, i, title, i + 1))

    return candidates


def pick_start_candidate(candidates: List[Candidate]) -> Optional[Candidate]:
    if not candidates:
        return None

    best_score = max(c[0] for c in candidates)
    best = [c for c in candidates if c[0] == best_score]
    # Empate: prioriza ocorrência mais tarde no documento para evitar índice/sumário.
    return max(best, key=lambda c: c[1])


def pick_next_candidate(candidates: List[Candidate]) -> Optional[Candidate]:
    if not candidates:
        return None

    good = [c for c in candidates if c[0] >= 1]
    pool = good if good else candidates
    return min(pool, key=lambda c: c[1])


def clean_chapter_content(lines: List[str]) -> str:
    cleaned = [line.rstrip() for line in lines]

    while cleaned and not cleaned[0].strip():
        cleaned.pop(0)
    while cleaned and not cleaned[-1].strip():
        cleaned.pop()

    while cleaned and re.fullmatch(r"\d{1,3}", cleaned[0].strip()):
        cleaned.pop(0)
        while cleaned and not cleaned[0].strip():
            cleaned.pop(0)

    while cleaned and re.fullmatch(r"\d{1,3}", cleaned[-1].strip()):
        cleaned.pop()
        while cleaned and not cleaned[-1].strip():
            cleaned.pop()

    return "\n".join(cleaned).strip()


def extract_chapter_from_text(text: str, chapter: int) -> Optional[str]:
    lines = text.splitlines()

    start = pick_start_candidate(chapter_candidates(lines, chapter))
    if not start:
        return None

    _, start_line, title, content_start = start

    next_start = pick_next_candidate(chapter_candidates(lines, chapter + 1, start_line + 1))
    end_line = next_start[1] if next_start else len(lines)

    content = clean_chapter_content(lines[content_start:end_line])
    return f"{chapter}\n{title}\n{content}".strip()


def parse_args(argv: List[str]) -> Tuple[int, str]:
    if len(argv) < 3:
        raise ValueError(
            "Uso:\n"
            "  python3 scripts/extrair_capitulo.py \"<livro>\" <capitulo> [caminho_vault]\n"
            "  python3 scripts/extrair_capitulo.py <capitulo> <caminho_pdf>"
        )

    # Modo compatível antigo: <capitulo> <caminho_pdf>
    if argv[1].isdigit() and len(argv) == 3:
        chapter = int(argv[1])
        pdf_path = argv[2]
        return chapter, pdf_path

    # Modo coleção: <livro> <capitulo> [caminho_vault]
    book_name = argv[1]
    if not argv[2].isdigit():
        raise ValueError("Capítulo inválido. Informe um número inteiro.")

    chapter = int(argv[2])
    vault_path = argv[3] if len(argv) >= 4 else DEFAULT_VAULT

    books = discover_collection_books(vault_path)
    if not books:
        raise RuntimeError(
            "Nenhum livro com collection: \"Fonte Viva\" foi encontrado no vault."
        )

    resolved = resolve_book_name(book_name, books)
    if not resolved:
        available = ", ".join(sorted(books.keys()))
        raise RuntimeError(
            f'Livro "{book_name}" não encontrado na coleção Fonte Viva. '
            f"Disponíveis: {available}"
        )

    return chapter, books[resolved]


def main() -> int:
    try:
        chapter, pdf_path = parse_args(sys.argv)

        if chapter < 1 or chapter > 500:
            raise ValueError("Capítulo deve estar entre 1 e 500.")

        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"Arquivo não encontrado: {pdf_path}")

        ensure_pdftotext()

        text = extract_pdf_text(pdf_path)
        chapter_text = extract_chapter_from_text(text, chapter)

        if not chapter_text:
            raise RuntimeError(
                f"Capítulo {chapter} não encontrado no PDF. "
                "Tente fornecer o texto manualmente."
            )

        print(chapter_text)
        return 0

    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
