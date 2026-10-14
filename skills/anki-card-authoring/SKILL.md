---
name: anki-card-authoring
description: Make Anki cards from conversation when asked to make card, 制卡, or 记住这个; support automatic or manual template selection and suggested tags.
---

# Anki Card Authoring Workflow

Use pi-anki-flash's tools to draft and review cards inside the conversation.

## 1. Discover, draft and preview

Call `anki_note_context` to read available note types (templates), exact field names, decks and existing tags. Use `templateMode: "manual"` when the user wants a template picker; otherwise use `auto`. Respect a named template or the returned `selectedTemplate`. A cancelled picker ends this request.

Choose a template suitable for the material when none was specified: question/answer for direct recall, Cloze for a sentence with a missing fact. Supply named `fields` matching the schema; put `{{c1::answer}}` in an actual `clozeFields` field. 

**Image handling & Image Occlusion rule**:
- You can freely use images via Markdown `![alt](/path/or/url)` or HTML `<img src="...">` or the `images` parameter. `pi-anki-flash` automatically uploads local files and remote URLs into Anki's `collection.media` and rewrites the card fields.
- **NEVER use the `Image Occlusion` template**: Anki's native Image Occlusion relies on desktop GUI canvas coordinates. When making cards involving diagrams, diagrams or pictures, use `Anki Markdown` (or `Basic`) with the image on the Front and key takeaways/questions on the Back, or use Cloze below the image.

Call `anki_add_note` immediately with the draft, model, fields, suggested tags, `guided: true`, and a short `chain.anchor` naming the core concept. Its preview provides y/n confirmation, editing and template/deck switching. This is the review gate; an extra chat approval turn is unnecessary.

Handle the result: `cancelled` means stop without retrying; `needs_revision` means regenerate from the returned draft and call the tool again. After `created`, inspect `nextCard`. When present, generate exactly one card from the original source using its `direction`, `previousCard`, and `draft`, then call `anki_add_note` again without another chat question. Treat a custom direction as authoritative: use an explicit question as the next front, adapting only for the selected template, and treat pasted material as additional source evidence. Keep the card self-contained and preserve the returned deck, model, tags, chain and guided mode. When `nextCard` is absent, the user chose to finish. On a write/network error, check for an existing note before retrying.

## 1.5 No-review mode (batch direct write)

**User default template**: always use `Anki Markdown` (Front/Back) for batch cards unless the user asks otherwise or the material clearly needs cloze (`Anki Markdown Cloze`) — its renderer is markdown-it with GFM table support, so markdown tables/bold/lists in field content render correctly.

When the user **explicitly** says no review is needed (e.g. 「直接制卡」「不需要确认」「不用审核」「直接生成全部卡片」), approval is unwanted friction: do NOT route drafts through `anki_add_note`'s interactive preview. Instead write notes directly to Anki via the AnkiConnect HTTP API (`addNote` / `addNotes` on `connectUrl` from plugin config, default `http://127.0.0.1:8765`), then ALWAYS call `sync` as the final mandatory step (no `sync` = incomplete) so other devices see the cards — do not wait for the user to ask. The authoring rules in section 2 still apply. Silent acceptance is not explicit — ask if unsure.

## 2. Authoring rules (reject bad drafts yourself)

- **One retrieval target per card.** Split independent ideas, while preserving a user's explicit compound question when its parts form one meaningful unit.
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
- In a guided chain, connect each new card through one useful relationship: mechanism, prerequisite, contrast, application, boundary, consequence, or the user's custom direction. Name the concept explicitly so the card remains understandable during random review. Avoid repeating a relationship already recorded in `chain.coveredDirections`.

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
