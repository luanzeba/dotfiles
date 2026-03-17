---
name: writing-studio
description: Collaborative writing workflow for blog posts, GitHub discussions, and other long-form pieces in Luan's voice. Use when the user wants to brainstorm a story, extract main points through conversation, build an outline, and iteratively draft/revise content that sounds like them (including Cabel-inspired narrative energy without imitation).
---

# Writing Studio

Use this skill to co-create writing through conversation. Do not jump to a full polished draft in the first response.

## Default Workflow

1. **Set the brief**
   - Ask for format (blog post, GitHub discussion, note, or other), audience, objective, and target length.
   - Ask for constraints (deadline, links to include, sensitive details to avoid).
   - Ask for a narrative/humor dial from 0-3 (0 = pure technical, 3 = playful).

2. **Run a story interview**
   - Ask 2-4 focused questions at a time (avoid giant questionnaires).
   - Prioritize concrete details: moments, decisions, tradeoffs, surprises, outcomes, metrics, and direct quotes.
   - Use `references/question-bank.md` for prompt options.

3. **Build a Story Card before drafting**
   - Create and confirm:
     - one-sentence thesis
     - reader promise (what they will walk away with)
     - core arc (before -> turning point -> after)
     - 3-5 supporting beats
     - evidence/assets (links, PRs, screenshots, data)

4. **Offer 2 outline options**
   - Usually: `Narrative-first` and `Lesson-first`.
   - Keep each outline short and pick one with the user.
   - Use `references/modes.md` for mode-specific defaults.

5. **Draft in passes**
   - Draft section-by-section, getting quick confirmation between sections.
   - Reuse the user's own phrases whenever possible.
   - Keep prose natural and avoid over-formatting unless the destination requires it.

6. **Run revision passes**
   - **Voice pass:** apply `voice-and-tone`.
   - **Evidence pass (technical claims):** apply `evidence-based-responses`.
   - **Output format pass (GitHub):** apply `markdown-output`.
   - **Compression pass:** remove repetition; stop when the point is made.

## Cabel-Inspired Mode (without imitation)

When the user asks for Cabel-like energy, borrow techniques, not personality:

- Prefer a concrete opening scene or specific moment over abstract setup.
- Use distinctive details early (time, place, object, specific incident).
- Add occasional parenthetical asides for personality.
- Maintain forward motion ("what happened next?").

Guardrails:

- Do not copy phrases, cadence signatures, or joke templates from source posts.
- Keep humor optional and sparse unless the user asks for more.
- Preserve Luan's baseline: direct, technically clear, grounded.

Use `references/style-signals.md` for examples and red lines.

## Quality Bar

- Specific > abstract.
- Evidence > claims.
- Natural cadence > formulaic AI polish.
- Fewer strong points > many repetitive points.
