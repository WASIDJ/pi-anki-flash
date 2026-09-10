# pi-anki-flash

A complete terminal Anki client embedded in [pi](https://github.com/mariozechner/pi) the coding agent — review cards in a full-screen overlay while the agent works, add notes from chat, search decks, and simulate FSRS retention targets. Everything goes through [AnkiConnect](https://ankiweb.net/shared/info/2055492159), so grading uses Anki's real scheduler and syncs to AnkiWeb.

## Prerequisites

- **Anki desktop** running, with the **AnkiConnect** add-on (code `2055492159`). Default endpoint `http://127.0.0.1:8765` (override via `ankiFlash.connectUrl`).
- Images render inline on terminals with a graphics protocol: **Ghostty, Kitty, WezTerm, iTerm2** (not under tmux). Elsewhere they degrade to `[image: …]` placeholders.
- Audio plays with macOS `afplay` (adjust by forking if you're on Linux — swap in `mpv`/`aplay`).

## Install

```bash
pi install git:github.com/WASIDJ/pi-anki-flash
```

## Review overlay

`/anki` (auto-picks the deck with most due cards) · `/anki AIInfra` · `Ctrl+Shift+K`

| Key    | Action                                    |
| ------ | ----------------------------------------- |
| Space  | reveal answer (audio replays)             |
| 1–4    | Again / Hard / Good / Easy (real grading) |
| r      | replay audio                              |
| u      | undo last grade                           |
| s      | suspend / unsuspend current card          |
| b      | toggle browse mode (j/k to navigate)      |
| a      | add a card (front → back form)            |
| q/Esc  | close                                     |

Long cards are capped at 30 image-rows / 60 text-lines per section with a "truncated" hint — view the full card in Anki or anki-tui.

## Chat commands

| Command                                | Purpose                                  |
| -------------------------------------- | ---------------------------------------- |
| `/anki [deck]`                         | review overlay                           |
| `/anki-add "front | back" [deck]`      | add a Basic card                         |
| `/anki-browse <query>`                 | search cards (Anki search syntax)        |
| `/anki-stats [deck]`                   | new / learn / review counts              |
| `/anki-decks`                          | list decks with due totals               |
| `/anki-newdeck <name>`                 | create a deck                            |
| `/anki-config [key] [value]`           | show or change configuration             |
| `/anki-sim [deck]`                     | FSRS retention simulation (see below)    |

While the agent is working, a widget above the editor shows how many cards are due.

## Agent tools

The LLM inside pi gets nine tools so it can help you manage Anki directly:

- `anki_list_decks` · `anki_find_cards` · `anki_card_info` · `anki_deck_stats`
- `anki_add_note` · `anki_delete_notes` · `anki_suspend_cards`
- `anki_set_config` · `anki_simulate_retention`

Write-level tools carry guidelines to preview destructive operations before running.

## Configuration

Lives under the top-level `ankiFlash` key of `~/.pi/agent/settings.json` (pi round-trips unknown keys safely), editable via `/anki-config key value` or the `anki_set_config` tool:

```json
{
  "connectUrl": "http://127.0.0.1:8765",
  "defaultDeck": null,
  "deckPriority": ["PTE", "AIInfra"],
  "autoOpen": { "enabled": false, "cooldownMin": 30, "onlyWhenDue": true },
  "media": { "playAudio": true, "renderImages": true, "maxImageWidthCells": 40, "maxImageHeightCells": 30 },
  "review": { "allowBrowsingInModal": true },
  "sim": { "retentions": [0.8, 0.85, 0.9, 0.95], "historyDays": 30 }
}
```

Set `autoOpen.enabled` to pop the review overlay automatically when the agent starts (rate-limited by `cooldownMin`, once per session).

## FSRS simulation

`/anki-sim [deck]` estimates future review workload at different desired-retention targets. It uses the FSRS-4.5 forgetting-curve inversion `I(S, DR) = S · (DR⁻² − 1) · 81/19`, scaling every in-review card's interval from its current scheduling to each target, then sums `Σ 1/I` as the expected daily review count. Learning cards count as a fixed addend; stability is assumed unchanged (first-order approximation). It's a read-only planning aid — it never touches Anki's scheduler.

## Development

```bash
pi -e ./extensions/anki-flash/index.ts   # try without installing
```

Layout: `extensions/anki-flash/` — `connect.ts` (AnkiConnect), `config.ts`, `render.ts` (text/audio/image), `review.ts` (overlay), `tools.ts` (agent tools), `fsrs.ts` (simulation), `index.ts` (entry).

## License

MIT
