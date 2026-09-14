/**
 * pi-anki-flash — full Anki client inside pi.
 *
 * Commands:
 *   /anki                                review current Anki card (Ctrl+Shift+K)
 *   /anki-add "front | back" [deck]      add a Basic card
 *   /anki-browse <query>                 search cards, results in chat
 *   /anki-stats [deck]                   deck statistics
 *   /anki-config [key] [value]           show/change config
 *   /anki-sim [deck]                     FSRS retention simulation
 *
 * Agent tools: anki_list_decks, anki_find_cards, anki_card_info,
 *   anki_deck_stats, anki_add_note, anki_delete_notes, anki_suspend_cards,
 *   anki_set_config, anki_simulate_retention
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	setConnectUrl,
	ping,
	pickDeck,
	addNote,
	findCards,
	cardsInfo,
	deckNames,
	getDeckStats,
	createDeck,
} from "./connect";
import { loadConfig, setConfigKey, parseConfigValue, type AnkiFlashConfig } from "./config";
import { simulateDeck, formatSimTable } from "./fsrs";
import { textLines } from "./render";
import { registerAnkiTools } from "./tools";
import { FlashcardComponent } from "./review";

let config: AnkiFlashConfig;

function reloadConfig(): void {
	config = loadConfig();
	setConnectUrl(config.connectUrl);
}

async function openOverlay(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("anki-flash requires interactive TUI mode", "error");
		return;
	}
	reloadConfig();
	if (!(await ping())) {
		ctx.ui.notify("AnkiConnect unreachable — start Anki desktop first", "error");
		return;
	}
	let deck: string;
	try {
		const decks = await deckNames();
		const stats = await getDeckStats(decks);
		const choices = Object.values(stats)
			.map((s) => ({
				deck: s.name,
				due: s.new_count + s.learn_count + s.review_count,
				label: `${s.name}  ·  新卡 ${s.new_count}  学习中 ${s.learn_count}  待复习 ${s.review_count}`,
			}))
			.sort((a, b) => b.due - a.due || a.deck.localeCompare(b.deck));
		if (choices.length === 0) {
			ctx.ui.notify("Anki 中没有可用牌组", "error");
			return;
		}
		const selected = await ctx.ui.select("选择要复习的 Anki 牌组", choices.map((choice) => choice.label));
		if (!selected) return;
		deck = choices.find((choice) => choice.label === selected)!.deck;
	} catch (e) {
		ctx.ui.notify(`读取牌组失败：${e instanceof Error ? e.message : e}`, "error");
		return;
	}
	await ctx.ui.custom((tui, _theme, _kb, done) => {
		const component = new FlashcardComponent(pi, tui, () => done(undefined), config, deck);
		void component.start();
		return component;
	});
}

export default function (pi: ExtensionAPI) {
	reloadConfig();
	registerAnkiTools(pi);

	pi.registerCommand("make-card", {
		description: "Make cards from the conversation: /make-card [auto|manual] [instructions]",
		handler: async (args) => {
			const manual = /^manual(?:\s|$)/i.test(args.trim());
			const request = args.trim().replace(/^(auto|manual)(?:\s+|$)/i, "");
			pi.sendUserMessage(
				`Make Anki cards from ${request || "the relevant material in our conversation"}. ` +
				`Use anki_note_context with templateMode=${manual ? "manual" : "auto"}, then draft using the returned template fields and relevant suggested tags. ` +
				"Call anki_add_note with guided=true and a concise chain.anchor for interactive preview and y/n confirmation. After each saved card, follow nextCard to generate one related card in the direction the user selected. Follow selected templates and handle needs_revision; stop when nextCard is absent or the user cancels.",
				{ deliverAs: "followUp" },
			);
		},
	});

	// ------------------------------------------------------------ commands

	pi.registerCommand("anki", {
		description: "Choose a deck, switch Anki to it, and review",
		handler: async (_args, ctx) => {
			await openOverlay(pi, ctx);
		},
	});

	pi.registerCommand("anki-add", {
		description: 'Add a card: /anki-add "front | back" [deck]',
		handler: async (args, ctx) => {
			reloadConfig();
			// "front | back" or "front | back | deck"; no pipe = usage error
			const parts = args.trim().split(/\s*\|\s*/);
			const front = parts[0]?.trim();
			const explicitDeck = parts.length >= 3 ? parts[parts.length - 1].trim() : "";
			const backText = parts.slice(1, parts.length >= 3 ? -1 : parts.length).join(" | ").trim();
			if (!front || !backText) {
				ctx.ui.notify('Usage: /anki-add "front | back" [deck]', "error");
				return;
			}

			try {
				const deck = await pickDeck(explicitDeck || config.defaultDeck || undefined, config.deckPriority);
				if (!deck) throw new Error("No decks available");
				const id = await addNote({
					deckName: deck,
					modelName: "Basic",
					fields: { Front: front, Back: backText },
					tags: ["pi"],
				});
				ctx.ui.notify(`Card ${id} added to "${deck}"`, "info");
			} catch (e) {
				ctx.ui.notify(`add failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	pi.registerCommand("anki-browse", {
		description: "Search cards (Anki search syntax): /anki-browse deck:AIInfra is:due",
		handler: async (args, ctx) => {
			reloadConfig();
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /anki-browse <Anki search query>", "error");
				return;
			}
			ctx.ui.notify(`Searching: ${query}`, "info");
			try {
				const ids = await findCards(query);
				if (ids.length === 0) {
					ctx.ui.notify("No matching cards", "info");
					return;
				}
				const infos = await cardsInfo(ids.slice(0, 30));
				const lines = infos.map((c, i) => {
					const front = textLines(c.question, 6).lines.join(" / ").slice(0, 90);
					return `${i + 1}. [#${c.cardId}] (${c.deckName}) ${front}`;
				});
				if (ids.length > 30) lines.push(`…and ${ids.length - 30} more`);
				ctx.ui.notify(lines.join("\n"), "info");
			} catch (e) {
				ctx.ui.notify(`browse failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	pi.registerCommand("anki-stats", {
		description: "Deck statistics (optional arg: deck name)",
		handler: async (args, ctx) => {
			reloadConfig();
			try {
				const decks = args.trim() ? [args.trim()] : await deckNames();
				const stats = await getDeckStats(decks);
				const lines = Object.values(stats).map(
					(s) =>
						`${s.name}: total=${s.total_in_deck} new=${s.new_count} learn=${s.learn_count} review=${s.review_count}`,
				);
				ctx.ui.notify(lines.join("\n") || "(no decks)", "info");
			} catch (e) {
				ctx.ui.notify(`stats failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	pi.registerCommand("anki-config", {
		description: "Show config, or set: /anki-config autoOpen.enabled true",
		handler: async (args, ctx) => {
			reloadConfig();
			const parts = args.trim().split(/\s+/).filter(Boolean);
			try {
				if (parts.length === 0) {
					ctx.ui.notify(`ankiFlash config:\n${JSON.stringify(config, null, 2)}`, "info");
					return;
				}
				if (parts.length < 2) {
					ctx.ui.notify("Usage: /anki-config <dotted.key> <value>", "error");
					return;
				}
				const key = parts[0];
				const value = parseConfigValue(parts.slice(1).join(" "));
				const newCfg = setConfigKey(key, value);
				config = newCfg;
				setConnectUrl(newCfg.connectUrl);
				ctx.ui.notify(`Set ${key} = ${JSON.stringify(value)}`, "info");
			} catch (e) {
				ctx.ui.notify(`config failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	pi.registerCommand("anki-sim", {
		description: "FSRS retention simulation for a deck (default: most-due deck)",
		handler: async (args, ctx) => {
			reloadConfig();
			try {
				const deck = args.trim() || (await pickDeck(undefined, config.deckPriority));
				if (!deck) {
					ctx.ui.notify("No deck with cards found", "error");
					return;
				}
				const sim = await simulateDeck(deck, config.sim.retentions, config.sim.historyDays);
				ctx.ui.notify(formatSimTable(sim).join("\n"), "info");
			} catch (e) {
				ctx.ui.notify(`sim failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	pi.registerCommand("anki-newdeck", {
		description: "Create a deck: /anki-newdeck <name>",
		handler: async (args, ctx) => {
			reloadConfig();
			const name = args.trim();
			if (!name) {
				ctx.ui.notify("Usage: /anki-newdeck <name>", "error");
				return;
			}
			try {
				await createDeck(name);
				ctx.ui.notify(`Deck "${name}" created`, "info");
			} catch (e) {
				ctx.ui.notify(`create failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	// ------------------------------------------------------------ shortcut

	pi.registerShortcut("ctrl+shift+k", {
		description: "Open Anki flashcard review",
		handler: async (ctx) => {
			await openOverlay(pi, ctx);
		},
	});

	// ------------------------------------------------- widget + auto-open

	let lastAutoOpen = 0;
	let autoOpenShownThisSession = false;

	async function dueCount(): Promise<number> {
		try {
			const ids = await findCards("is:due");
			return ids.length;
		} catch {
			return -1;
		}
	}

	pi.on("agent_start", async (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		reloadConfig();
		const count = await dueCount();
		if (count > 0) {
			ctx.ui.setWidget("anki-flash", [
				`🃏 ${count} Anki card(s) due — Ctrl+Shift+K or /anki to review while waiting`,
			]);
		}
		if (!config.autoOpen.enabled) return;
		if (autoOpenShownThisSession) return;
		if (config.autoOpen.onlyWhenDue && count <= 0) return;
		const now = Date.now();
		if (now - lastAutoOpen < config.autoOpen.cooldownMin * 60_000) return;
		lastAutoOpen = now;
		autoOpenShownThisSession = true;
		await openOverlay(pi, ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		ctx.ui.setWidget("anki-flash", undefined);
	});

	pi.on("session_start", async (_event, ctx) => {
		autoOpenShownThisSession = false;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		if (!(await ping())) return; // silent when Anki isn't running
	});
}
