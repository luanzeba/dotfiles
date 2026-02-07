# Templates

All templates in `~/Obsidian/Personal/Templates/`. Use `{{date}}` for Obsidian's date placeholder.

## Jahaida Template

For daughter's documents, records, IEPs, medical, legal.

```markdown
---
category:
  - "[[Categories/Jahaida|Jahaida]]"
type: 
date: "{{date}}"
---

```

**Usage:** Any note about Jahaida - school records, IEPs, medical visits, legal documents, foster care records.

## Jack Template

For son's documents and records.

```markdown
---
category:
  - "[[Categories/Jack|Jack]]"
type: 
date: "{{date}}"
---

```

**Usage:** Any note about Jack - school, medical, activities.

## Journal Template

For personal journal entries.

```markdown
---
category:
  - "[[Categories/Journal|Journal]]"
type:
  - Journal
date: "{{date}}"
tags:
  - note
  - journal
---

```

**Usage:** Personal reflections, life events, stream of consciousness entries.

## Spiritist Study Template

For spiritist doctrine study notes.

```markdown
---
category:
  - "[[Categories/Espiritismo|Espiritismo]]"
book: 
chapter: 
themes: 
tags:
  - espiritismo
date: "{{date}}"
---

```

**Usage:** EADE studies, Pao Nosso reflections, spiritist book studies.

## Project Template

For projects (personal or work).

```markdown
---
category:
  - "[[Categories/Projects|Projects]]"
type: []
org: []
start: 
year: 
tags:
  - projects
url: 
status:
---


```

**Usage:** Work projects, personal projects, side projects.

## Evergreen Template

For timeless ideas that grow over time.

```markdown
---
created: {{date}}
tags:
  - evergreen
---

```

**Usage:** Ideas, concepts, principles that are not time-bound. These accumulate connections over time.

## Trip Template

For travel planning and trip memories.

```markdown
---
category:
  - "[[Categories/Trips|Trips]]"
type: 
start: 
end: 
location: 
---

```

**Usage:** Vacation planning, trip itineraries, travel memories.

## Daily Note Template

For daily todos and tasks. Lives in `Dailies/YYYY-MM-DD.md`.

```markdown
---
tags:
  - daily
---
## Notes

```dataview
list
where
	!contains(file.tags, "daily") and
	contains(file.outlinks, this.file.link) or
	contains(string(file.frontmatter), string(dateformat(this.file.day,"yyyy-MM-dd")))
sort file.ctime asc
limit 50
```
```

**Usage:** Daily task tracking, todos, quick notes. The dataview query auto-shows notes linked to this day.

## Clipping Template

For saved web articles and essays.

```markdown
---
category:
  - "[[Categories/Clippings|Clippings]]"
source: 
author: 
created: {{date}}
---

```

**Usage:** Web clipper saves, articles to read, reference material written by others.

## Agent Skill Template

For documenting AI agent skills.

```markdown
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

[Add your instructions here that Claude will follow when this skill is active]

## Examples
- Example usage 1
- Example usage 2

## Guidelines
- Guideline 1
- Guideline 2
```

**Usage:** Documenting custom skills for OpenCode or other AI agents.

## Tax Filing Template

For tax-related notes.

```markdown
---
category:
  - "[[Categories/Taxes|Taxes]]"
type: 
year: 
status: 
---

## Documents needed

## Filing notes

## Key dates

```

**Usage:** Annual tax filing notes, document checklists, filing status.
