# Frontmatter Schema

Standard properties used across the vault.

## Universal Properties

### category
**Type:** list  
**Format:** `[[Categories/Name|Name]]`  
**Required:** Yes for most notes  
**Description:** Links to category pages. Can have multiple categories.

```yaml
category:
  - "[[Categories/Jahaida|Jahaida]]"
  - "[[Categories/GitHub|GitHub]]"
```

### type
**Type:** list  
**Format:** Plain text strings (NOT links)  
**Required:** No  
**Description:** Sub-categorization within a category. See `categories.md` for valid types per category.

```yaml
type:
  - Documents
  - IEP
```

### tags
**Type:** list  
**Format:** Plain text, no spaces  
**Required:** No  
**Description:** Obsidian tags for quick filtering.

```yaml
tags:
  - note
  - journal
  - espiritismo
  - daily
  - projects
  - evergreen
```

### created
**Type:** date  
**Format:** `YYYY-MM-DD`  
**Required:** Recommended  
**Description:** Date the note was created.

### date
**Type:** text  
**Format:** `YYYY-MM-DD` (uses Obsidian `{{date}}` placeholder in templates)  
**Required:** For dated notes  
**Description:** Primary date associated with the note (event date, document date, purchase date, etc.)

## Status Properties

### status
**Type:** text  
**Values:** `active`, `completed`, `on-hold`, `archived`, `resolved`, `closed`, `Idea`  
**Used by:** Projects, Investigations  
**Description:** Current state of the item.

## Date Range Properties

### start
**Type:** date  
**Format:** `YYYY-MM-DD`  
**Used by:** Projects, Trips  
**Description:** Start date of a period or event.

### end
**Type:** date  
**Format:** `YYYY-MM-DD`  
**Used by:** Projects, Trips  
**Description:** End date of a period or event.

### year
**Type:** number  
**Used by:** Books, Projects, Taxes  
**Description:** Year associated with the item.

## People Properties

### author
**Type:** list or text  
**Used by:** Books, Clippings  
**Description:** Author(s) of the work.

## Content Properties

### book
**Type:** text  
**Used by:** Espiritismo  
**Description:** Book being studied (e.g., "Pao Nosso", "O Evangelho Segundo o Espiritismo").

### chapter
**Type:** text or number  
**Used by:** Espiritismo  
**Description:** Chapter number or title.

### themes
**Type:** list  
**Used by:** Espiritismo, Meetings  
**Description:** Key themes explored in the study or discussed in meeting.

### genre
**Type:** list  
**Used by:** Books  
**Description:** Genre classification.

## Location Properties

### location
**Type:** text  
**Used by:** Trips, Meetings  
**Description:** Location name, address, or "Phone"/"Virtual" for remote meetings.

## Media Properties

### rating
**Type:** number  
**Range:** 1-7  
**Used by:** Books, Products  
**Description:** Personal rating. 7=Perfect, 1=Evil. (kepano's 7-point scale)

### url
**Type:** text  
**Used by:** Projects, Clippings  
**Description:** Related URL.

### source
**Type:** text  
**Used by:** Clippings  
**Description:** Source website or publication.

## Organization Properties

### org
**Type:** list  
**Used by:** Projects  
**Description:** Organization(s) associated with a project.

## Product Properties

### maker
**Type:** text  
**Used by:** Products  
**Description:** Manufacturer or creator of the product.

### model
**Type:** text  
**Used by:** Products  
**Description:** Model name/number.

### price
**Type:** number  
**Used by:** Products  
**Description:** Price paid or current price.

## Obsidian Bases Configuration

**Important:** Bases configuration goes in embedded code blocks, NOT in frontmatter.

### cssclasses
**Type:** list  
**Used by:** Category files  
**Description:** CSS classes applied to the page. Use `wide` for full-width Bases tables.

```yaml
cssclasses:
  - wide
```

### Bases Code Block

Bases queries are defined in the note body using a `base` code block:

````markdown
```base
filters:
  and:
    - category.contains(link("Categories/Name"))
    - file.folder != "Templates"
views:
  - type: table
    name: Table
    order:
      - file.name
      - type
    groupBy:
      property: type
      direction: ASC
```
````

**Filter syntax:**
- `category.contains(link("Categories/Name"))` - Match category links
- `file.folder != "Templates"` - Exclude template files
- Use `and:` to combine multiple conditions

**View options:**
- `type: table` - Display as table
- `order:` - List of properties to show as columns
- `groupBy:` - Group rows by a property value
