# pi-anki-flash

English | [简体中文](README.zh-CN.md) | [中文完整使用指南](docs/usage.zh-CN.md)

An Anki client and conversational card-authoring workflow for the
[Pi coding agent](https://pi.dev/). Review cards without leaving the terminal,
turn the current conversation into confirmed Anki notes, browse your collection,
inspect deck statistics, and estimate FSRS workloads.

All collection and review operations go through
[AnkiConnect](https://ankiweb.net/shared/info/2055492159), so cards use Anki's
real scheduler and sync normally through AnkiWeb.

## Highlights

- Make cards from the current conversation with automatic or manual note-type selection.
- Preview every generated note before writing it; press `y` to save or `n` to skip.
- Revise drafts in natural language, edit fields or tags, switch note types, and choose or create decks.
- Reuse existing Anki tags and mark agent-authored notes with `pi`.
- Use Basic, Cloze, Markdown, and custom note types through their real named fields.
- Review and grade due cards in a terminal overlay backed by Anki's scheduler.
- Browse cards, inspect due counts, and run a read-only FSRS workload simulation.
- Read and update one deck's desired retention, daily limits, and learning steps from chat.

## Requirements

- Node.js 20 or newer and a working Pi installation.
- Anki Desktop running with AnkiConnect installed (add-on code `2055492159`).
- The default endpoint is `http://127.0.0.1:8765`; change `ankiFlash.connectUrl` if needed.
- Ghostty, Kitty, WezTerm, and iTerm2 can render supported images inline. Other terminals show placeholders.
- Audio playback currently uses macOS `afplay`.

## Installation

```bash
pi install git:github.com/WASIDJ/pi-anki-flash
```

Run `/reload` if Pi was already open. Keep Anki Desktop running while using the extension.

## Make cards from a conversation

Ask Pi naturally:

```text
Make a card from what we just discussed.
Turn this explanation into two Anki cards.
Make a card and let me choose the template manually.
Use Anki Markdown Cloze for this card.
```

Or use `/make-card [instructions]` for automatic note-type selection and
`/make-card manual [instructions]` to choose a note type first.

Pi reads the note types, named fields, decks, and tags from your running Anki
collection. It generates one draft at a time and opens an interactive preview.
The note is written only after you press `y`.

| Key | Action |
| --- | --- |
| `y` | Save the displayed note |
| `n` / `Esc` | Skip it |
| `r` | Give Pi a natural-language revision request and preview the rewrite |
| `e` | Edit the named fields as JSON |
| `t` | Choose another Anki note type and regenerate its fields |
| `g` | Edit suggested tags |
| `d` | Change or create the destination deck |
| `↑` / `↓`, `j` / `k` | Scroll a long preview |

The header keeps the deck, note type, suggested tags, and latest revision visible.
HTML fields appear as readable text in the preview and retain their original HTML
when saved. Use `::` when creating nested decks, for example
`Languages::English`. Deck creation happens immediately, so skipping the card
afterward leaves an empty deck in Anki.

Find today's agent-authored notes with `/anki-browse tag:pi added:1`.

### pi-permission-system

`anki_add_note` contains its own mandatory preview. If `pi-permission-system` is
installed, allow this tool to avoid a second generic dialog before the preview:

```json
{
  "permission": {
    "anki_add_note": "allow"
  }
}
```

Other tool permissions remain independent.

## Review cards

Open `/anki` or press `Ctrl+Shift+K`, then choose a deck from the picker. Pi switches
Anki to that deck and opens the review overlay. The picker includes new, learning,
and review counts for every deck.

| Key | Action |
| --- | --- |
| `Space` | Reveal the answer and replay audio |
| `1`–`4` | Grade Again / Hard / Good / Easy through Anki |
| `r` | Replay audio |
| `u` | Undo the last grade |
| `s` | Suspend or unsuspend the current card |
| `b` | Toggle browse mode; use `j` / `k` to navigate |
| `a` | Open the simple Basic note form |
| `q` / `Esc` | Close the overlay |

Long cards are capped at 30 image rows and 60 text lines per section. Open the
card in Anki when the overlay reports truncated content.

The header shows new, learning, review, and total counts plus the current card
state. After revealing the answer, each rating displays Anki's next interval.
These rows can be toggled with `review.showCounts`, `review.showCardState`, and
`review.showNextReviews`.

## Commands

| Command | Purpose |
| --- | --- |
| `/make-card [instructions]` | Generate and confirm cards from the conversation |
| `/make-card manual [instructions]` | Choose the note type before generation |
| `/anki` | Choose a deck and open the review overlay |
| `/anki-add "front \| back" [deck]` | Directly add a simple Basic note |
| `/anki-browse <query>` | Search with Anki search syntax |
| `/anki-stats [deck]` | Show new, learning, and review counts |
| `/anki-newdeck <name>` | Create a deck |
| `/anki-config [key] [value]` | Read or change extension settings |
| `/anki-sim [deck]` | Estimate FSRS workload at several retention targets |

Pi receives ten tools:

```text
anki_list_decks       anki_find_cards       anki_card_info
anki_deck_stats       anki_note_context      anki_add_note
anki_delete_notes     anki_suspend_cards     anki_set_config
anki_simulate_retention
```

It also receives `anki_get_study_plan` and `anki_set_study_plan` for real deck
scheduling settings.

## Configuration

Settings live under `ankiFlash` in `~/.pi/agent/settings.json` and can also be
changed with `/anki-config` or `anki_set_config`:

```json
{
  "ankiFlash": {
    "connectUrl": "http://127.0.0.1:8765",
    "defaultDeck": null,
    "deckPriority": ["Languages", "AIInfra"],
    "autoOpen": { "enabled": false, "cooldownMin": 30, "onlyWhenDue": true },
    "media": { "playAudio": true, "renderImages": true, "maxImageWidthCells": 40, "maxImageHeightCells": 30 },
    "review": { "allowBrowsingInModal": true, "showCounts": true, "showCardState": true, "showNextReviews": true },
    "sim": { "retentions": [0.8, 0.85, 0.9, 0.95], "historyDays": 30 }
  }
}
```

When `autoOpen.enabled` is true, Pi may open the review overlay once per session,
subject to `cooldownMin` and `onlyWhenDue`.

## FSRS simulation

`/anki-sim [deck]` estimates review volume using the FSRS-4.5 forgetting-curve
inversion `I(S, DR) = S × (DR⁻² − 1) × 81/19`. It treats estimated stability as
unchanged, adds learning cards as fixed workload, and reports expected daily
reviews. It never modifies Anki's scheduler.

## Deck study plans in chat

The agent can inspect and update the real Anki scheduling preset for one deck:

```text
查看 AIInfra 的复习策略，以及哪些牌组共用这个预设。
把 AIInfra 的 FSRS 目标保留率设为 90%，每天新卡 10 张，复习上限 200 张。
先预览把 AIInfra 的目标保留率改成 95%，不要保存。
```

Supported settings are desired retention, preset new/review daily limits, and
learning/relearning steps. Shared and Default presets are cloned before the
named deck is changed; private presets are updated in place. Writes are read
back and verified.

FSRS must already be enabled in Anki. The extension does not enable FSRS,
optimize its weights, reschedule existing cards, or assign the new preset to
subdecks. See the [Chinese usage guide](docs/usage.zh-CN.md#在对话中设置单个牌组的学习计划)
for examples and exact scope.

## Development

```bash
pi -e ./extensions/anki-flash/index.ts
npm test
PI_ANKI_LIVE=1 npm test
node tests/rpc-smoke.mjs
npx tsc --noEmit
```

- `npm test` uses mocked Anki responses and Pi's actual extension loader.
- `PI_ANKI_LIVE=1 npm test` discovers and preflights note types against a running Anki instance without writing notes.
- `node tests/rpc-smoke.mjs` exercises automatic/manual selection, revision, preview, and cancellation with the configured Pi model. It never approves a write.
- Set `PI_PACKAGE_DIR` if Pi is installed outside the standard global Node path.
- `npx tsc --noEmit` checks the extension TypeScript.

## License

MIT
