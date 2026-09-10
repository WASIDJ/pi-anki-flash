/**
 * Custom tools exposed to the pi agent (LLM-callable).
 * Read tools are open; write tools carry guidelines that destructive or
 * config-changing calls should be previewed to the user first.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	addNote,
	cardsInfo,
	deckNames,
	deleteNotes,
	findCards,
	getDeckStats,
	modelFieldNames,
	modelNames,
	toggleSuspend,
} from "./connect";
import { loadConfig, setConfigKey, parseConfigValue } from "./config";
import { simulateDeck, formatSimTable } from "./fsrs";

function ok(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function registerAnkiTools(pi: ExtensionAPI): void {
	// ------------------------------------------------------------- read tools

	pi.registerTool({
		name: "anki_list_decks",
		label: "Anki List Decks",
		description: "List all Anki decks with due counts (new/learn/review). Requires Anki running with AnkiConnect.",
		promptSnippet: "List Anki decks and due-card counts",
		promptGuidelines: ["Use anki_list_decks when the user asks about their Anki decks or how many cards are due."],
		parameters: Type.Object({}),
		async execute() {
			try {
				const decks = await deckNames();
				const stats = await getDeckStats(decks);
				const lines = Object.values(stats).map(
					(s) =>
						`${s.name}: total=${s.total_in_deck} due(new+learn+review)=${s.new_count + s.learn_count + s.review_count}`,
				);
				return ok(lines.join("\n") || "(no decks)");
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_find_cards",
		label: "Anki Find Cards",
		description: "Search Anki cards with Anki search syntax (e.g. 'deck:AIInfra is:due'). Returns card ids.",
		promptSnippet: "Search Anki cards by query",
		promptGuidelines: ["Use anki_find_cards when the user wants to locate cards; combine with anki_card_info to read them."],
		parameters: Type.Object({ query: Type.String() }),
		async execute(_id, params) {
			try {
				const ids = await findCards(String(params.query ?? ""));
				return ok(
					ids.length
						? `card ids (${ids.length}): ${ids.slice(0, 50).join(", ")}${ids.length > 50 ? " …" : ""}`
						: "no matches",
				);
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_card_info",
		label: "Anki Card Info",
		description: "Read details (fields, deck, interval, reps) of up to 20 Anki cards by id.",
		promptSnippet: "Read Anki card contents and scheduling state",
		promptGuidelines: ["Use anki_card_info after anki_find_cards to inspect specific cards."],
		parameters: Type.Object({ cardIds: Type.Array(Type.Number()) }),
		async execute(_id, params) {
			try {
				const ids = (params.cardIds as number[]).slice(0, 20);
				const info = await cardsInfo(ids);
				const lines = info.map(
					(c) =>
						`#${c.cardId} [${c.deckName}/${c.modelName}] interval=${c.interval}d reps=${c.reps}\n` +
						Object.entries(c.fields)
							.sort((a, b) => a[1].order - b[1].order)
							.map(([k, v]) => `  ${k}: ${v.value.replace(/<[^>]+>/g, " ").slice(0, 200)}`)
							.join("\n"),
				);
				return ok(lines.join("\n\n"));
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_deck_stats",
		label: "Anki Deck Stats",
		description: "Per-deck statistics (new/learn/review counts, total). Pass a deck name or omit for all.",
		promptSnippet: "Anki deck statistics",
		promptGuidelines: ["Use anki_deck_stats when the user asks about deck progress or review load."],
		parameters: Type.Object({ deck: Type.Optional(Type.String()) }),
		async execute(_id, params) {
			try {
				const decks = params.deck ? [String(params.deck)] : await deckNames();
				const stats = await getDeckStats(decks);
				return ok(JSON.stringify(Object.values(stats), null, 2));
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	// ------------------------------------------------------------ write tools

	pi.registerTool({
		name: "anki_add_note",
		label: "Anki Add Note",
		description: "Create a new Anki note (flashcard). Defaults to the Basic model; fields map by name.",
		promptSnippet: "Create Anki flashcards",
		promptGuidelines: [
			"Use anki_add_note when the user asks to turn material into flashcards or to remember something as a card.",
			"Always include the tag 'pi' in anki_add_note tags so agent-made cards are findable with 'tag:pi'.",
			"When creating multiple cards from a discussion, first list every draft (front/back) in the chat as a table and wait for explicit user approval before calling anki_add_note.",
			"When using anki_add_note, tell the user the created card fields afterwards.",
		],
		parameters: Type.Object({
			deck: Type.String(),
			front: Type.String(),
			back: Type.String(),
			tags: Type.Optional(Type.Array(Type.String())),
			model: Type.Optional(Type.String()),
		}),
		async execute(_id, params) {
			try {
				const model = params.model ? String(params.model) : "Basic";
				let fieldNames: string[];
				try {
					fieldNames = await modelFieldNames(model);
				} catch {
					throw new Error(`Unknown note model "${model}" (available: ${(await modelNames()).join(", ")})`);
				}
				const fields: Record<string, string> = {};
				if (fieldNames.length >= 1) fields[fieldNames[0]] = String(params.front ?? "");
				if (fieldNames.length >= 2) fields[fieldNames[1]] = String(params.back ?? "");
				for (const extra of fieldNames.slice(2)) fields[extra] = "";
				const id = await addNote({
					deckName: String(params.deck),
					modelName: model,
					fields,
					tags: (params.tags as string[] | undefined) ?? [],
				});
				return ok(`Note created: id=${id} deck=${params.deck} front="${String(params.front ?? "").slice(0, 60)}"`);
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_delete_notes",
		label: "Anki Delete Notes",
		description: "Delete Anki notes by note id (DESTRUCTIVE — list what will be deleted first).",
		promptSnippet: "Delete Anki notes",
		promptGuidelines: [
			"Before calling anki_delete_notes, show the user the note contents found via search and get explicit confirmation.",
		],
		parameters: Type.Object({ noteIds: Type.Array(Type.Number()) }),
		async execute(_id, params) {
			try {
				const ids = params.noteIds as number[];
				await deleteNotes(ids);
				return ok(`Deleted ${ids.length} note(s): ${ids.join(", ")}`);
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_suspend_cards",
		label: "Anki Suspend Cards",
		description: "Toggle suspend state of cards by card id (suspended cards stop being scheduled).",
		promptSnippet: "Suspend or unsuspend Anki cards",
		promptGuidelines: ["Before calling anki_suspend_cards, list the affected cards to the user and confirm."],
		parameters: Type.Object({ cardIds: Type.Array(Type.Number()) }),
		async execute(_id, params) {
			try {
				const ids = params.cardIds as number[];
				const states = await toggleSuspend(ids);
				return ok(`Suspension toggled: ${ids.map((id, i) => `#${id}=${states[i] ? "suspended" : "active"}`).join(", ")}`);
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	// --------------------------------------------------------- config & sim

	pi.registerTool({
		name: "anki_set_config",
		label: "Anki Set Config",
		description: "Read or change anki-flash settings (stored in the ankiFlash key of pi's settings.json).",
		promptSnippet: "Get or set pi-anki-flash configuration",
		promptGuidelines: [
			"Use anki_set_config when the user asks to change anki-flash behavior (autoOpen, decks, media, connect URL).",
			"When using anki_set_config with an explicit key, confirm the new value with the user afterwards.",
		],
		parameters: Type.Object({
			key: Type.Optional(Type.String({ description: "dotted key, e.g. autoOpen.enabled" })),
			value: Type.Optional(Type.String({ description: "new value (JSON or scalar); omit to read" })),
		}),
		async execute(_id, params) {
			try {
				if (!params.key) {
					return ok(JSON.stringify(loadConfig(), null, 2));
				}
				const key = String(params.key);
				if (params.value === undefined) {
					const cfg = loadConfig() as unknown as Record<string, unknown>;
					const val = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], cfg);
					return ok(`${key} = ${JSON.stringify(val)}`);
				}
				const newCfg = setConfigKey(key, parseConfigValue(String(params.value)));
				return ok(`Set ${key} = ${params.value}\nNew ankiFlash config:\n${JSON.stringify(newCfg, null, 2)}`);
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});

	pi.registerTool({
		name: "anki_simulate_retention",
		label: "Anki FSRS Simulation",
		description:
			"Simulate FSRS review workload at different desired-retention targets for a deck (read-only planning aid).",
		promptSnippet: "Simulate FSRS review load at retention targets",
		promptGuidelines: [
			"Use anki_simulate_retention when the user asks how changing their desired retention would affect daily review volume.",
			"anki_simulate_retention only simulates; it never modifies Anki scheduling parameters.",
		],
		parameters: Type.Object({
			deck: Type.String(),
			retentions: Type.Optional(Type.Array(Type.Number())),
			historyDays: Type.Optional(Type.Number()),
		}),
		async execute(_id, params) {
			try {
				const cfg = loadConfig();
				const sim = await simulateDeck(
					String(params.deck),
					(params.retentions as number[] | undefined) ?? cfg.sim.retentions,
					(params.historyDays as number | undefined) ?? cfg.sim.historyDays,
				);
				return ok(formatSimTable(sim).join("\n"));
			} catch (e) {
				return ok(`Error: ${errText(e)}`, { error: errText(e) });
			}
		},
	});
}
