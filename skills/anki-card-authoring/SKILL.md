---
name: anki-card-authoring
description: Turn conversation material into Anki flashcards of reviewable quality. Use when the user asks to "make cards", "make a deck", "记住这个", or asks the agent to author Anki notes from the discussion.
---

# Anki Card Authoring Workflow

The agent has Anki tools (`anki_add_note`, `anki_list_decks`, `anki_newdeck`)
via pi-anki-flash. Follow this workflow — never batch-write without a review
gate.

## 1. Propose before writing

Draft every card in the chat FIRST as a table, then STOP and wait for
explicit approval ("OK", "入库", "全部加", or per-card edits).

| # | Deck | Front | Back | 为什么值得记 |
|---|------|-------|------|-------------|

Do NOT call `anki_add_note` in the same turn you propose the drafts.
Only write the approved subset. If the user edits a card verbally, apply the
edit then confirm the final text once.

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

- Always add tag `pi` to agent-authored notes (the tool does not tag
  automatically — pass `tags: ["pi", <context-tag>]`).
- Deck: ask if ambiguous; default to the deck the user has been studying
  (`anki_list_decks`, prefer deckPriority in ankiFlash config).

## 4. Review-and-fix commands for the user

- `/anki-browse tag:pi added:1` — today's agent-made cards
- Verbal kit: "删掉卡 #12345"(anki_delete_notes), "暂停这张"(anki_suspend_cards)
- Tell the user these exist after the first authoring session.

## 5. When NOT to make cards

Quotes, code one-liners, current-conversation trivia, and anything the user
said was only illustrative. Ask if unsure.
