/**
 * Flashcard overlay — review mode (guiDeckReview-backed, real Anki scheduling)
 * plus browse mode (j/k through due cards, no grading), plus inline add-note.
 *
 * Keys:
 *  Space reveal · 1-4 grade · r replay audio · u undo · s toggle suspend
 *  b toggle browse mode · j/k browse prev/next · a add note · q/Esc close
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import {
	getDeckStats,
	type DeckStat,
	type CardInfo,
	findCards,
	cardsInfo,
	guiDeckReview,
	guiCurrentCard,
	guiShowAnswer,
	guiAnswerCard,
	undo,
	toggleSuspend,
	pickDeck,
	addNote,
	type GuiCard,
} from "./connect";
import { renderCard, wrapLines, styleCardLine, playSounds, type CardRenderResult } from "./render";
import type { AnkiFlashConfig } from "./config";

type View = "loading" | "review" | "browse" | "add" | "done" | "error";
const EASE_LABELS: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

interface BrowseEntry {
	cardId: number;
	question: string;
	answer: string;
}

export class FlashcardComponent {
	private pi: ExtensionAPI;
	private tui: { requestRender: () => void };
	private done: () => void;
	private config: AnkiFlashConfig;

	private view: View = "loading";
	private errorMsg = "";
	private deckArg: string | null;

	// review state
	private card: GuiCard | null = null;
	private showAnswer = false;
	private rendered: CardRenderResult | null = null;
	private statusFlash = "";
	private deckStats: DeckStat | null = null;
	private cardInfo: CardInfo | null = null;

	// browse state
	private browseList: BrowseEntry[] = [];
	private browseIdx = 0;
	private browseRendered: CardRenderResult | null = null;

	// add-note state
	private addFront = "";
	private addBack = "";
	private addField: "front" | "back" = "front";
	private addDeck = "";

	private busy = false;

	constructor(
		pi: ExtensionAPI,
		tui: { requestRender: () => void },
		done: () => void,
		config: AnkiFlashConfig,
		deckArg: string | null,
	) {
		this.pi = pi;
		this.tui = tui;
		this.done = done;
		this.config = config;
		this.deckArg = deckArg;
	}

	async start(): Promise<void> {
		try {
			const deck = await pickDeck(this.deckArg ?? this.config.defaultDeck ?? undefined, this.config.deckPriority);
			if (!deck) {
				this.view = "done";
				this.repaint();
				return;
			}
			this.addDeck = deck;
			await guiDeckReview(deck);
			await this.loadCurrentCard();
		} catch (e) {
			this.fail(e);
		}
		this.repaint();
	}

	private async loadCurrentCard(): Promise<void> {
		this.card = await guiCurrentCard();
		await this.refreshMetadata();
		if (!this.card) {
			this.view = "done";
			return;
		}
		this.view = "review";
		this.showAnswer = false;
		this.rendered = await renderCard(this.card.question, this.card.answer, this.config);
		playSounds(this.card.question, this.pi, this.config);
	}

	private async refreshMetadata(): Promise<void> {
		// Optional metadata must never prevent reviewing; discard stale values on failure.
		const [stats, info] = await Promise.allSettled([
			getDeckStats([this.addDeck]),
			this.card ? cardsInfo([this.card.cardId]) : Promise.resolve([]),
		]);
		this.deckStats = stats.status === "fulfilled"
			? Object.values(stats.value).find((s) => s.name === this.addDeck) ?? null : null;
		this.cardInfo = info.status === "fulfilled" ? info.value[0] ?? null : null;
	}

	private fail(e: unknown): void {
		this.view = "error";
		this.errorMsg = e instanceof Error ? e.message : String(e);
		this.repaint();
	}

	private flash(msg: string): void {
		this.statusFlash = msg;
		setTimeout(() => {
			this.statusFlash = "";
			this.tui.requestRender();
		}, 1500);
	}

	private repaint(): void {
		this.tui.requestRender();
	}

	// ------------------------------------------------------------------ keys

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || ((data === "q" || data === "Q") && this.view !== "add")) {
			if (this.view === "add") {
				// Esc exits the add form; q is a normal typed character there.
				if (matchesKey(data, "escape")) {
					this.view = "review";
					this.repaint();
					return;
				}
			} else {
				this.done();
				return;
			}
		}

		switch (this.view) {
			case "loading":
			case "done":
			case "error":
				if (!matchesKey(data, "escape") && (data === "q" || data === "Q")) this.done();
				else if (this.view !== "loading") this.done();
				return;
			case "add":
				this.handleAddKey(data);
				return;
			case "browse":
				this.handleBrowseKey(data);
				return;
			case "review":
				this.handleReviewKey(data);
				return;
		}
	}

	private handleReviewKey(data: string): void {
		if (this.busy || !this.card) return;

		if (data === " ") {
			void this.runBusy(async () => {
				await guiShowAnswer();
				const current = await guiCurrentCard();
				if (!current || current.cardId !== this.card!.cardId) {
					await this.loadCurrentCard();
					return;
				}
				this.card = current;
				this.showAnswer = true;
				playSounds(this.card.answer, this.pi, this.config);
			});
			return;
		}

		if (data === "r" || data === "R") {
			playSounds(this.showAnswer ? this.card.answer : this.card.question, this.pi, this.config);
			return;
		}

		if (data === "u" || data === "U") {
			void this.runBusy(async () => {
				const label = await undo();
				this.flash(`undo: ${label}`);
				await this.loadCurrentCard();
			});
			return;
		}

		if (data === "s" || data === "S") {
			void this.runBusy(async () => {
				const states = await toggleSuspend([this.card!.cardId]);
				this.flash(states[0] ? "card suspended" : "card unsuspended");
				await this.loadCurrentCard();
			});
			return;
		}

		if (data === "b" || data === "B") {
			if (this.config.review.allowBrowsingInModal) void this.enterBrowse();
			return;
		}

		if (data === "a" || data === "A") {
			this.enterAdd(this.card.deckName);
			return;
		}

		if (this.showAnswer && data >= "1" && data <= "4") {
			const ease = Number(data);
			if (!(this.card.buttons ?? [1, 2, 3, 4]).includes(ease)) return;
			void this.runBusy(async () => {
				await guiAnswerCard(ease);
				this.flash(`${EASE_LABELS[ease]} ✓`);
				await this.loadCurrentCard();
			});
		}
	}

	private async enterBrowse(): Promise<void> {
		this.view = "browse";
		this.repaint();
		try {
			const deck = this.card?.deckName ?? (this.deckArg ?? undefined);
			const query = deck ? `is:due deck:"${deck}"` : "is:due";
			const ids = await findCards(query);
			if (ids.length === 0) {
				this.flash("no due cards to browse");
				this.view = "review";
				return;
			}
			const infos = await cardsInfo(ids.slice(0, 200));
			this.browseList = infos.map((c) => ({ cardId: c.cardId, question: c.question, answer: c.answer }));
			this.browseIdx = 0;
			await this.renderBrowseEntry();
		} catch (e) {
			this.fail(e);
			return;
		}
		this.repaint();
	}

	private async renderBrowseEntry(): Promise<void> {
		const entry = this.browseList[this.browseIdx];
		if (!entry) return;
		this.browseRendered = await renderCard(entry.question, entry.answer, this.config);
	}

	private handleBrowseKey(data: string): void {
		if (data === "b" || data === "B") {
			this.view = "review";
			this.repaint();
			return;
		}
		if ((data === "j" || data === "J" || matchesKey(data, "down")) && this.browseList.length > 0) {
			this.browseIdx = (this.browseIdx + 1) % this.browseList.length;
			void this.renderBrowseEntry().then(() => this.repaint());
			return;
		}
		if ((data === "k" || data === "K" || matchesKey(data, "up")) && this.browseList.length > 0) {
			this.browseIdx = (this.browseIdx - 1 + this.browseList.length) % this.browseList.length;
			void this.renderBrowseEntry().then(() => this.repaint());
			return;
		}
		if (data === "r" || data === "R") {
			const entry = this.browseList[this.browseIdx];
			if (entry) playSounds(entry.question, this.pi, this.config);
			return;
		}
	}

	// --------------------------------------------------------------- add form

	private enterAdd(deck: string): void {
		this.view = "add";
		this.addFront = "";
		this.addBack = "";
		this.addField = "front";
		this.addDeck = deck;
		this.repaint();
	}

	private handleAddKey(data: string): void {
		if (matchesKey(data, "escape")) {
			this.view = "review";
			this.repaint();
			return;
		}
		if (matchesKey(data, "enter") || data === "\n" || data === "\r") {
			if (this.addField === "front") {
				this.addField = "back";
				this.repaint();
			} else {
				void this.submitAdd();
			}
			return;
		}
		if (data === "\x7f" || matchesKey(data, "backspace")) {
			if (this.addField === "front") this.addFront = this.addFront.slice(0, -1);
			else this.addBack = this.addBack.slice(0, -1);
			this.repaint();
			return;
		}
		// printable input
		if (data.length > 0 && !data.startsWith("\x1b")) {
			if (this.addField === "front") this.addFront += data;
			else this.addBack += data;
			this.repaint();
		}
	}

	private async submitAdd(): Promise<void> {
		const front = this.addFront.trim();
		const back = this.addBack.trim();
		if (!front) {
			this.flash("front is empty");
			this.addField = "front";
			this.repaint();
			return;
		}
		try {
			await addNote({
				deckName: this.addDeck,
				modelName: "Basic",
				fields: { Front: front, Back: back },
				tags: ["pi"],
			});
			this.flash(`card added to ${this.addDeck}`);
			await this.refreshMetadata();
		} catch (e) {
			this.flash(`add failed: ${e instanceof Error ? e.message : e}`);
		}
		this.view = "review";
		this.repaint();
	}

	private async runBusy(fn: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await fn();
		} catch (e) {
			this.flash(`error: ${e instanceof Error ? e.message : e}`);
		} finally {
			this.busy = false;
			this.repaint();
		}
	}

	// ---------------------------------------------------------------- render

	invalidate(): void {}

	dispose(): void {}

	render(width: number): string[] {
		const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
		const accent = (s: string) => `\x1b[36m${s}\x1b[0m`;
		const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
		const gold = (s: string) => `\x1b[33m${s}\x1b[0m`;

		const boxWidth = Math.max(1, Math.min(width - 6, 86));
		const pad = (content: string) => {
			// Escape-sequence lines (images) have no width to pad.
			const isImageSeq = content.includes("\x1b_G") || content.includes("\x1bPq") || content.includes("\x1b]1337;");
			if (isImageSeq) return ` ${dim("│")} ${content} ${dim("│")}`;
			const safe = truncateToWidth(content, boxWidth);
			const w = visibleWidth(safe);
			return ` ${dim("│")} ${safe}${" ".repeat(Math.max(0, boxWidth - w))} ${dim("│")}`;
		};
		const border = (l: string, r: string) => ` ${dim(l + "─".repeat(boxWidth + 2) + r)}`;

		const lines: string[] = [];
		lines.push(border("╭", "╮"));

		const deck = this.card?.deckName ?? this.addDeck ?? "";
		const modeLabel =
			this.view === "browse" ? "BROWSE" : this.view === "add" ? "ADD" : "REVIEW";
		lines.push(pad(`${bold(accent("ANKI"))} ${dim("·")} ${gold(modeLabel)}${deck ? ` ${dim("·")} ${gold(deck)}` : ""}`));
		if (this.config.review.showCounts && this.view !== "loading") {
			const s = this.deckStats;
			const summary = s
				? `新卡 ${s.new_count} · 学习中 ${s.learn_count} · 待复习 ${s.review_count} · 牌组总数 ${s.total_in_deck}`
				: "张数暂不可用";
			for (const line of wrapLines([summary], boxWidth)) lines.push(pad(line));
		}
		if (this.config.review.showCardState && this.view === "review" && this.card) {
			const state = this.cardInfo ? ["新卡", "学习中", "复习", "重新学习"][this.cardInfo.type] ?? "未知" : "未知";
			for (const line of wrapLines([`状态：${state} · ${this.showAnswer ? "请选择熟悉程度" : "回忆后按空格"}`], boxWidth)) lines.push(pad(dim(line)));
		}
		lines.push(border("├", "┤"));

		if (this.view === "loading") {
			lines.push(pad(dim("Loading cards…")));
		} else if (this.view === "error") {
			lines.push(pad(bold("AnkiConnect error")));
			for (const l of wrapLines([this.errorMsg], boxWidth - 2)) lines.push(pad(dim(l)));
			lines.push(pad(""));
			lines.push(pad(dim("Anki must be running with the AnkiConnect add-on (2055492159).")));
		} else if (this.view === "done" || (!this.card && this.view === "review")) {
			lines.push(pad(bold(gold("All done! No more due cards. 🎉"))));
		} else if (this.view === "add") {
			lines.push(pad(`${bold("Front:")} ${this.addFront}${this.addField === "front" ? accent("▌") : ""}`));
			lines.push(pad(`${bold("Back:  ")} ${this.addBack}${this.addField === "back" ? accent("▌") : ""}`));
			lines.push(pad(dim("Enter: next field / submit · Esc: cancel")));
		} else if (this.view === "browse") {
			const r = this.browseRendered;
			lines.push(pad(dim(`card ${this.browseIdx + 1}/${this.browseList.length}`)));
			if (r) {
				lines.push(pad(dim("问题")));
				for (const l of wrapLines(r.questionLines.map(styleCardLine), boxWidth - 2)) lines.push(pad(l));
				lines.push(pad(""));
				lines.push(pad(accent("答案")));
				for (const l of wrapLines(r.answerLines.map(styleCardLine), boxWidth - 2)) lines.push(pad(l));
				if (r.truncated) lines.push(pad(gold("…truncated — see full card in Anki/anki-tui")));
			} else {
				lines.push(pad(dim("Loading…")));
			}
		} else if (this.view === "review" && this.card) {
			const r = this.rendered;
			if (r) {
				lines.push(pad(dim("问题")));
				for (const l of wrapLines(r.questionLines.map(styleCardLine), boxWidth - 2)) lines.push(pad(l));
				if (this.showAnswer) {
					lines.push(pad(""));
				lines.push(pad(accent("答案")));
					for (const l of wrapLines(r.answerLines.map(styleCardLine), boxWidth - 2)) lines.push(pad(l));
					if (r.truncated) lines.push(pad(gold("…truncated — see full card in Anki/anki-tui")));
				}
			} else {
				lines.push(pad(dim("Loading…")));
			}
		}

		lines.push(pad(""));
		if (this.busy) lines.push(pad(dim("working…")));
		if (this.statusFlash) lines.push(pad(gold(this.statusFlash)));

		lines.push(border("├", "┤"));
		if (this.view === "review" && this.showAnswer) {
			const labels: Record<number, string> = { 1: "重来", 2: "困难", 3: "良好", 4: "简单" };
			const colors: Record<number, number> = { 1: 31, 2: 33, 3: 32, 4: 36 };
			let row = "";
			for (const [i, button] of (this.card?.buttons ?? [1, 2, 3, 4]).entries()) {
				const interval = this.config.review.showNextReviews ? this.card?.nextReviews?.[i] : undefined;
				const item = `\x1b[${colors[button] ?? 37}m${bold(`${button} ${labels[button] ?? "?"}`)}${interval ? `  ${interval}` : ""}\x1b[0m`;
				if (row && visibleWidth(row) + 4 + visibleWidth(item) > boxWidth) {
					lines.push(pad(row)); row = "";
				}
				row += (row ? "    " : "") + item;
			}
			if (row) for (const line of wrapLines([row], boxWidth)) lines.push(pad(line));
			for (const line of wrapLines(["u 撤销 · r 音频 · s 暂停 · Esc 退出"], boxWidth)) lines.push(pad(dim(line)));
		} else {
			for (const line of wrapLines([this.footer(bold, EASE_LABELS, this.card?.buttons ?? [1, 2, 3, 4])], boxWidth)) lines.push(pad(line));
		}
		lines.push(border("╰", "╯"));
		// Absolute safety: never exceed the allotted width regardless of width math.
		return lines.map((l) =>
			l.includes("\x1b_G") || l.includes("\x1bPq") || l.includes("\x1b]1337;") || visibleWidth(l) <= width ? l : truncateToWidth(l, width - 1),
		);
	}

	private footer(bold: (s: string) => string, labels: Record<number, string>, buttons: number[]): string {
		const k = (s: string) => bold(s);
		switch (this.view) {
			case "review":
				if (!this.showAnswer) return `${k("Space")} reveal · ${k("b")} browse · ${k("a")} add · ${k("Esc")} close`;
				return (
					buttons.map((b, i) => {
						const interval = this.config.review.showNextReviews ? this.card?.nextReviews?.[i] : undefined;
						return `${k(String(b))} ${labels[b] ?? "?"}${interval ? ` (${interval})` : ""}`;
					}).join(" · ") +
					` · ${k("u")} undo · ${k("Esc")} close`
				);
			case "browse":
				return `${k("j/k")} next/prev · ${k("r")} replay · ${k("b")} back to review · ${k("Esc")} close`;
			case "add":
				return `${k("Enter")} next/submit · ${k("Esc")} cancel`;
			default:
				return `${k("Any key")} close`;
		}
	}
}
