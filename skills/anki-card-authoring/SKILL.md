---
name: anki-card-authoring
description: Make Anki cards from conversation when asked to make card, 制卡, or 记住这个; support automatic or manual template selection and suggested tags.
---

# Anki Card Authoring Workflow

Use pi-anki-flash's tools to draft and review cards inside the conversation.

## 1. Discover, draft and preview

Call `anki_note_context` to read available note types (templates), exact field names, decks and existing tags. Use `templateMode: "manual"` when the user wants a template picker; otherwise use `auto`. Respect a named template or the returned `selectedTemplate`. A cancelled picker ends this request.

Choose a template suitable for the material when none was specified: question/answer for direct recall, Cloze for a sentence with a missing fact. Supply named `fields` matching the schema; put `{{c1::answer}}` in an actual `clozeFields` field. Specialized types such as Image Occlusion need their required data; use them only when that data is available.

Call `anki_add_note` immediately with the draft, model, fields and suggested tags. Its preview provides y/n confirmation, editing and template/deck switching. This is the review gate; an extra chat approval turn is unnecessary. Submit multiple drafts sequentially.

Handle the result: `created` means saved (report the note ID); `cancelled` means skip that draft without retrying; `needs_revision` means regenerate the returned draft for the selected template and call the tool again for a fresh preview. Preserve edited tags and deck from the returned draft. On a write/network error, check for an existing note before retrying.

## 2. Authoring rules (reject bad drafts yourself)

- **One fact per card.** If the back has two ideas, split it.
- **The back must be short enough to recite** — one word, one number,
  or one sentence (≤ ~25 Chinese chars / ~15 English words for knowledge
  cards). Paragraphs belong in the vault, not on a card.
- **The front must cue recall, not restate the answer.** Vague fronts
  ("谈谈有限理性") fail; specific fronts ("Simon 提出'有限理性'是为了
  替代什么假设？") work.
- Use the learner's own words from the conversation when possible.
- Context matters: for names/theories, anchor with the person + field
  ("Simon 认为政策执行中的'满意解'指的是？").
- Cloze-style phrasing beats essay phrasing for facts lifted from prose.

## 3. Required metadata

- Suggest a few relevant tags, reusing existing names before introducing new ones. The tool adds `pi` automatically.
- Use the deck requested in the conversation, or the returned default; omit an ambiguous deck so the tool asks the user to choose.

## 4. Review-and-fix commands for the user

- `/make-card` — automatic template choice; `/make-card manual` — template picker.
- `/anki-browse tag:pi added:1` — today's agent-made cards
- Verbal kit: "删掉卡 #12345"(anki_delete_notes), "暂停这张"(anki_suspend_cards)
- Tell the user these exist after the first authoring session.

## 5. When NOT to make cards

Quotes, code one-liners, current-conversation trivia, and anything the user
said was only illustrative. Ask if unsure.
