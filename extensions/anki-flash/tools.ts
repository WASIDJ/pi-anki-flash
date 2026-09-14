/**
 * Custom tools exposed to the pi agent (LLM-callable).
 * Read tools are open; write tools carry guidelines that destructive or
 * config-changing calls should be previewed to the user first.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	cardsInfo,
	deckNames,
	deleteNotes,
	findCards,
	getDeckStats,
	toggleSuspend,
	setConnectUrl,
} from "./connect";
import { loadConfig, setConfigKey, parseConfigValue } from "./config";
import { simulateDeck, formatSimTable } from "./fsrs";
import { authoringContext, reviewAndAdd } from "./authoring";

import { getStudyPlan, setStudyPlan } from "./scheduling";

function ok(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function registerAnkiTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "anki_get_study_plan",
		label: "Anki Study Plan",
		description: "Read a deck's scheduling preset, FSRS desired retention, daily preset limits, learning steps, and other decks sharing the preset. FSRS enablement is unknown.",
		promptSnippet: "Read a deck's real Anki scheduling settings",
		parameters: Type.Object({ deck: Type.String() }),
		async execute(_id, params) {
			try {
				setConnectUrl(loadConfig().connectUrl);
				const result = await getStudyPlan(params.deck);
				return ok(JSON.stringify(result, null, 2), result);
			} catch (e) { return { ...ok(errText(e)), isError: true }; }
		},
	});

	pi.registerTool({
		name: "anki_set_study_plan",
		label: "Anki Set Study Plan",
		description: "Preview or apply actual scheduling settings to exactly one deck. Automatically isolates shared/default presets. desiredRetention uses a fraction (0.9 = 90%). Does not enable FSRS, optimize weights, bulk-reschedule cards, or assign subdecks. Daily limits are preset limits, not overrides.",
		promptSnippet: "Set a deck's FSRS retention, daily limits, and learning steps",
		promptGuidelines: [
			"Use this tool for real Anki scheduling changes; anki_set_config only changes plugin behavior.",
			"Read the current study plan first. If the user explicitly specifies deck and values, apply those values without asking again; otherwise preview a concrete proposal with apply=false and ask for the missing choices.",
			"Convert 90% to desiredRetention=0.9. Change only requested fields. Report saved values and preset scope afterwards.",
			"Always explain that FSRS must already be enabled in Anki; a stored retention target is not evidence of enablement. Do not claim parameter optimization or immediate rescheduling.",
		],
		parameters: Type.Object({
			deck: Type.String(),
			changes: Type.Object({
				desiredRetention: Type.Optional(Type.Number({ minimum: 0.7, maximum: 0.99 })),
				newCardsPerDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 9999 })),
				reviewsPerDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 9999 })),
				learningStepsMinutes: Type.Optional(Type.Array(Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1440 }))),
				relearningStepsMinutes: Type.Optional(Type.Array(Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1440 }))),
			}, { additionalProperties: false }),
			apply: Type.Optional(Type.Boolean({ description: "Default false previews without writing. Set true to save requested changes." })),
		}),
		async execute(_id, params) {
			try {
				setConnectUrl(loadConfig().connectUrl);
				const result = await setStudyPlan(params.deck, params.changes, params.apply ?? false);
				return ok(JSON.stringify(result, null, 2), result);
			} catch (e) { return { ...ok(errText(e)), isError: true }; }
		},
	});

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
		name: "anki_note_context",
		label: "Anki Templates & Tags",
		description: "Read real Anki note templates (models), named fields, cloze fields, decks and existing tags before drafting cards. Optionally let the user manually select a template.",
		promptSnippet: "Discover Anki templates and tags; optionally select a template manually",
		promptGuidelines: [
			"Before making cards, call anki_note_context. Reuse relevant existing tags and select a suitable template from the returned schema.",
			"For manual template selection use templateMode=manual; otherwise choose automatically based on the content. Respect an explicitly named template.",
		],
		parameters: Type.Object({ templateMode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("manual")])) }),
		async execute(_id, params, signal, _update, ctx) {
			try {
				const context = await authoringContext();
				if (signal?.aborted) return ok("Cancelled", { status: "cancelled" });
				if (params.templateMode === "manual") {
					if (!ctx.hasUI) throw new Error("Interactive UI required for manual template selection");
					const selected = await ctx.ui.select("选择模板（Anki 笔记类型）", context.templates.map((t) => t.name), { signal });
					if (!selected || signal?.aborted) return ok("Template selection cancelled. Stop authoring.", { status: "cancelled" });
					return ok(JSON.stringify({ ...context, selectedTemplate: selected }), { selectedTemplate: selected });
				}
				return ok(JSON.stringify(context));
			} catch (e) {
				return { ...ok(`Error: ${errText(e)}`, { error: errText(e) }), isError: true };
			}
		},
	});

	pi.registerTool({
		name: "anki_add_note",
		label: "Anki Add Note",
		description: "Preview an Anki draft with suggested tags and template, allow edits, then save ONLY when the user presses y. Supports named fields for custom and Cloze templates. Returns created, cancelled, or needs_revision.",
		promptSnippet: "Preview, edit and confirm Anki flashcards with y/n",
		promptGuidelines: [
			"Use anki_add_note when the user asks to turn material into flashcards or to remember something as a card.",
			"Call this tool directly with a draft: its UI provides the preview and approval. Supply relevant suggested tags; pi is added automatically.",
			"Use named fields matching anki_note_context, including {{c1::answer}} in a cloze field for Cloze templates. For automatic selection, choose the best available model for the content.",
			"Create multiple cards sequentially so each gets its own review. If cancelled, do not retry that draft. If needs_revision, call again using the returned draft state and instruction.",
			"The returned needs_revision draft uses anki_add_note parameter names and is authoritative. Preserve its deck, model, tags, and revision. For a template switch, regenerate sourceFields into the selected template's named fields without changing the other draft properties.",
			"For /make-card and conversational card-making, set guided=true. After a created result with nextCard, immediately generate exactly one related card using nextCard.direction, previousCard, draft, and instruction; do not ask another chat question. Stop when nextCard is absent.",
			"Report success only for status=created. For an uncertain write/network error, search for the note before retrying to avoid duplicates.",
		],
		parameters: Type.Object({
			deck: Type.Optional(Type.String()),
			front: Type.Optional(Type.String()),
			back: Type.Optional(Type.String()),
			fields: Type.Optional(Type.Record(Type.String(), Type.String())),
			tags: Type.Optional(Type.Array(Type.String())),
			model: Type.Optional(Type.String()),
			revision: Type.Optional(Type.String({ description: "The user's exact revision request, when regenerating after feedback; displayed in the next preview." })),
			guided: Type.Optional(Type.Boolean({ description: "After saving, let the user choose the relationship explored by the next card." })),
			chain: Type.Optional(Type.Object({
				anchor: Type.Optional(Type.String({ description: "The core concept shared by this card chain." })),
				coveredDirections: Type.Optional(Type.Array(Type.String())),
			})),
		}),
		async execute(_id, params, signal, _update, ctx) {
			try {
				const result = await reviewAndAdd(params, ctx, signal);
				return ok(JSON.stringify(result), result);
			} catch (e) {
				return { ...ok(`Error: ${errText(e)}`, { error: errText(e) }), isError: true };
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
