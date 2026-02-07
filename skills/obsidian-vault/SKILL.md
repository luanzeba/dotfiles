---
name: obsidian-vault
description: Navigate, read, create, and find notes in the Obsidian Personal vault. Use when creating notes, finding existing notes, working with daily tasks/todos, checking categories, managing vault organization, or when the user mentions Obsidian, their vault, notes, or dailies. Vault location is ~/Obsidian/Personal.
---

# Obsidian Vault

Manage notes in the Personal Obsidian vault following kepano's organizational philosophy.

## Vault Location

**Path:** `~/Obsidian/Personal`

## Directory Structure

| Directory | Purpose |
|-----------|---------|
| `Notes/` | Personal notes - the main content |
| `Dailies/` | Daily notes named `YYYY-MM-DD.md` for todos and daily tasks |
| `Categories/` | Category overview pages with Bases filters |
| `Clippings/` | Saved articles/essays written by others |
| `Attachments/` | Images, PDFs, media files |
| `Templates/` | Note templates |

## Creating Notes

### Template Selection

| Note Type | Template | Location |
|-----------|----------|----------|
| Jahaida document/record | `Jahaida Template.md` | `Notes/` |
| Jack document/record | `Jack Template.md` | `Notes/` |
| Journal entry | `Journal Template.md` | `Notes/` |
| Spiritist study | `Spiritist Study Template.md` | `Notes/` |
| Project | `Project Template.md` | `Notes/` |
| Evergreen note | `Evergreen Template.md` | `Notes/` |
| Trip | `Trip Template.md` | `Notes/` |
| Daily tasks | `Daily Note Template.md` | `Dailies/YYYY-MM-DD.md` |
| Web clipping | `Clipping Template.md` | `Clippings/` |
| Agent skill doc | `Agent Skill Template.md` | `Notes/` |
| Tax filing | `Tax filing template.md` | `Notes/` |

### Naming Conventions

- **Notes:** Descriptive title, e.g., `Jahaida IEP - May 2025.md`
- **Dailies:** `YYYY-MM-DD.md` format only
- **Dates in content:** Always `YYYY-MM-DD`

### Category Link Format

**Always use:** `[[Categories/Name|Name]]`

```yaml
category:
  - "[[Categories/Jahaida|Jahaida]]"
  - "[[Categories/GitHub|GitHub]]"
```

**Never use:**
- `[[Name]]` - ambiguous, could conflict with note names
- `[[Categories/Name]]` - works but displays ugly path

### The `type` Property

Use `type` as a sub-category within a category:

```yaml
category:
  - "[[Categories/Jahaida|Jahaida]]"
type:
  - Documents
  - IEP
```

Common type values per category - see `references/categories.md`.

## Finding Notes

### By Category

```bash
grep -l "Categories/Jahaida" ~/Obsidian/Personal/Notes/*.md
```

### By Text Content

```bash
grep -r "search term" ~/Obsidian/Personal/Notes/
```

### By Filename

```bash
ls ~/Obsidian/Personal/Notes/ | grep -i "keyword"
```

### Recent Notes

```bash
ls -lt ~/Obsidian/Personal/Notes/ | head -20
```

## Dailies Workflow

Daily notes track todos and daily tasks.

### Create Today's Daily

```bash
DATE=$(date +%Y-%m-%d)
FILE=~/Obsidian/Personal/Dailies/$DATE.md
```

Use the Daily Note Template format.

### Daily Note Structure

```markdown
---
tags:
  - daily
---
## Notes

[Dataview query shows linked notes - auto-populated by Obsidian]
```

The user typically adds tasks and notes throughout the day. Link to other notes using `[[Note Name]]`.

## Category Files

Category files in `Categories/` use Obsidian Bases via embedded code blocks (NOT frontmatter).

### Correct Bases Syntax

````markdown
---
cssclasses:
  - wide
---

```base
filters:
  and:
    - category.contains(link("Categories/CategoryName"))
    - file.folder != "Templates"
views:
  - type: table
    name: Table
    order:
      - file.name
      - type
      - date
    groupBy:
      property: type
      direction: ASC
```
````

**Key points:**
- Use `cssclasses: [wide]` in frontmatter for full-width tables (Minimal theme requirement)
- Bases config goes in a `base` code block, NOT in frontmatter
- Filter syntax uses dot notation: `category.contains(link("..."))`
- Always exclude Templates folder: `file.folder != "Templates"`
- Use `groupBy` to organize by relevant property (type, status, genre, etc.)

## References

- `references/categories.md` - All valid categories with descriptions and type values
- `references/templates.md` - Complete template formats
- `references/frontmatter-schema.md` - All frontmatter properties and valid values
