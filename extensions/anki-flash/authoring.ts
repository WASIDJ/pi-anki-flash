import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey } from "@earendil-works/pi-tui";
import {
	addNote, canAddNotes, createDeck, deckNames, getTags, modelNames, modelFieldNames, modelTemplates,
	setConnectUrl, type AddNoteParams,
} from "./connect";
import { loadConfig } from "./config";
import { stripHtml } from "./render";

export interface NoteTemplate {
	name: string;
	fields: string[];
	clozeFields: string[];
	cardTemplates: string[];
}

export async function readTemplate(name: string): Promise<NoteTemplate> {
	const [fields, templates] = await Promise.all([modelFieldNames(name), modelTemplates(name)]);
	const clozeFields = new Set<string>();
	for (const template of Object.values(templates)) {
		for (const match of template.Front.matchAll(/{{cloze:([^}]+)}}/g)) clozeFields.add(match[1].trim());
	}
	return { name, fields, clozeFields: [...clozeFields], cardTemplates: Object.keys(templates) };
}

export async function authoringContext() {
	const config = loadConfig();
	setConnectUrl(config.connectUrl);
	const [names, decks, tags] = await Promise.all([modelNames(), deckNames(), getTags()]);
	const templates = await Promise.all(names.map(readTemplate));
	const defaultDeck = decks.find((d) => d === config.defaultDeck)
		?? config.deckPriority.flatMap((p) => decks.filter((d) => d.toLowerCase().includes(p.toLowerCase())))[0]
		?? (decks.length === 1 ? decks[0] : undefined);
	return { templates, decks, tags, defaultDeck };
}

export interface NoteDraft {
	deck?: string;
	model?: string;
	front?: string;
	back?: string;
	fields?: Record<string, string>;
	tags?: string[];
	revision?: string;
}

export function normalizeTags(tags: string[]): string[] {
	return [...new Set(["pi", ...tags.flatMap((t) => t.trim().split(/[\s,，]+/)).filter(Boolean)])];
}

async function selectDeck(ctx: ExtensionContext, signal?: AbortSignal): Promise<string | undefined> {
	while (!signal?.aborted) {
		const decks = await deckNames();
		let createOption = "＋ 新建牌组…";
		while (decks.includes(createOption)) createOption += "＋";
		const selected = await ctx.ui.select("选择目标牌组", [...decks, createOption], { signal });
		if (!selected || signal?.aborted) return undefined;
		if (selected !== createOption) return selected;
		const name = (await ctx.ui.input("新建牌组：输入名称后创建（子牌组用 :: 分隔）", "例如：English::Phrases", { signal }))?.trim();
		if (signal?.aborted) return undefined;
		if (!name) continue;
		if (name.split("::").some((part) => !part.trim()) || /[\x00-\x1f\x7f]/.test(name)) {
			ctx.ui.notify("牌组名称不能包含空层级或控制字符", "error");
			continue;
		}
		try {
			const existing = decks.find((deck) => deck.toLowerCase() === name.toLowerCase());
			if (existing) return existing;
			const id = await createDeck(name);
			// Resolve Anki's canonical name, including whitespace/name normalization.
			const names = await deckNames();
			const canonical = names.find((deck) => deck === name)
				?? names.find((deck) => deck.toLowerCase() === name.toLowerCase());
			if (!canonical) throw new Error(`牌组已创建（${id}），请从列表选择 Anki 保存的名称`);
			ctx.ui.notify(`已创建牌组：${canonical}`, "info");
			return signal?.aborted ? undefined : canonical;
		} catch (error) {
			ctx.ui.notify(`创建牌组失败或名称需要确认：${error instanceof Error ? error.message : error}`, "error");
		}
	}
	return undefined;
}

export function draftFields(draft: NoteDraft, template: NoteTemplate): Record<string, string> {
	if (draft.fields) {
		const unknown = Object.keys(draft.fields).filter((key) => !template.fields.includes(key));
		if (unknown.length) throw new Error(`Unknown fields for ${template.name}: ${unknown.join(", ")}`);
		return Object.fromEntries(template.fields.map((key) => [key, draft.fields![key] ?? ""]));
	}
	if (template.fields.length > 2) {
		throw new Error(`Use named fields for ${template.name}: ${template.fields.join(", ")}`);
	}
	return Object.fromEntries(template.fields.map((key, i) => [key, (i === 0 ? draft.front : draft.back) ?? ""]));
}

function validateFields(fields: Record<string, string>, template: NoteTemplate): void {
	if (!Object.values(fields).some((value) => value.trim())) throw new Error("Card fields are empty");
	if (template.clozeFields.length && !template.clozeFields.some((key) => /{{c[1-9]\d*::[\s\S]+?}}/.test(fields[key] ?? ""))) {
		throw new Error(`Cloze requires {{c1::answer}} in: ${template.clozeFields.join(", ")}`);
	}
}

type Choice = "y" | "n" | "e" | "t" | "g" | "d" | "r";
const actions: Record<Choice, string> = {
	y: "y · 保存", n: "n · 跳过", e: "e · 修改字段", t: "t · 换模板", g: "g · 修改标签", d: "d · 换牌组",
	r: "r · 提修改建议，让 Pi 重写",
};

// Escape control sequences from card content; keep newlines for a readable preview.
function display(value: string): string {
	return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export async function previewChoice(ctx: ExtensionContext, note: AddNoteParams, signal?: AbortSignal, revision?: string): Promise<Choice> {
	const metadata = display([
		`牌组: ${note.deckName}    [d] 更换`, `模板: ${note.modelName}    [t] 浏览 / 选择模板`,
		`建议标签: ${note.tags?.join("  ·  ") || "(无)"}    [g] 编辑`,
		...(revision ? [`你的修改建议: ${revision}`] : []),
	].join("\n"));
	const body = display(Object.entries(note.fields).map(([key, value]) => {
		const label = ({ Front: "正面", Back: "背面", Text: "填空正文", Extra: "补充说明" } as Record<string, string>)[key] ?? key;
		const readable = /<\/?(?:b|strong|div|p|br|span|ul|li|em|i|script|style)\b/i.test(value) ? stripHtml(value).join("\n") : value;
		return `${label} · ${key}\n\n${readable || "（空）"}`;
	}).join("\n\n────────────────────\n\n"));
	if (signal?.aborted) return "n";
	if (ctx.mode !== "tui") {
		const selected = await ctx.ui.select(`Anki 卡片预览\n${metadata}\n\n${body}`, Object.values(actions), { signal });
		return (Object.keys(actions) as Choice[]).find((key) => actions[key] === selected) ?? "n";
	}
	return ctx.ui.custom<Choice>((tui, theme, _kb, done) => {
		let offset = 0;
		let maxOffset = 0;
		const abort = () => done("n");
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) queueMicrotask(abort);
		return {
			render(width: number) {
				const contentWidth = Math.max(12, Math.min(width - 4, 100));
				const render = (text: string) => new Text(text, 0, 0).render(contentWidth);
				const rule = theme.fg("borderMuted", "─".repeat(contentWidth));
				const header = [rule, ...render(theme.fg("accent", theme.bold("Anki · 卡片预览"))), "", ...render(metadata), rule];
				const footer = [rule,
					...render(theme.fg("success", "[y] 保存") + "   [n/Esc] 跳过   [r] 提修改建议，让 Pi 重写"),
					...render("[e] 直接编辑字段   [t] 模板   [g] 标签   [d] 牌组"),
					...render(theme.fg("muted", "↑/↓ 或 j/k 滚动正文 · 文字预览，保存保留原始格式")),
				];
				const lines = render(body);
				const height = Math.max(1, tui.terminal.rows - header.length - footer.length - 2);
				maxOffset = Math.max(0, lines.length - height);
				offset = Math.min(offset, maxOffset);
				return [...header, ...lines.slice(offset, offset + height), ...footer].map((line) => `  ${line}`);
			},
			handleInput(data: string) {
				if (data.length === 1 && data.toLowerCase() in actions) done(data.toLowerCase() as Choice);
				else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done("n");
				else if (matchesKey(data, "down") || data === "j") offset = Math.min(maxOffset, offset + 1);
				else if (matchesKey(data, "up") || data === "k") offset = Math.max(0, offset - 1);
				tui.requestRender();
			},
			invalidate() {},
			dispose() { signal?.removeEventListener("abort", abort); },
		};
	});
}

export async function reviewAndAdd(draft: NoteDraft, ctx: ExtensionContext, signal?: AbortSignal) {
	if (!ctx.hasUI) throw new Error("Interactive UI required to review and confirm Anki cards; open Pi in TUI or RPC mode.");
	if (signal?.aborted) return { status: "cancelled" };
	const context = await authoringContext();
	let template = draft.model ? context.templates.find((t) => t.name === draft.model) : undefined;
	if (draft.model && !template) throw new Error(`Unknown template: ${draft.model}`);
	if (!template) {
		const cloze = Object.values(draft.fields ?? { front: draft.front ?? "" }).some((s) => /{{c[1-9]\d*::/.test(s));
		const candidates = context.templates.filter((t) => Boolean(t.clozeFields.length) === cloze
			&& (draft.fields ? Object.keys(draft.fields).every((key) => t.fields.includes(key)) : t.fields.length <= 2));
		template = candidates.find((t) => t.name === (cloze ? "Cloze" : "Basic")) ?? candidates[0];
	}
	if (!template) throw new Error("No compatible template. Call anki_note_context and provide model + named fields.");
	let deck: string | undefined = draft.deck ?? context.defaultDeck;
	if (deck && !context.decks.includes(deck)) throw new Error(`Unknown deck: ${deck}`);
	if (!deck) deck = await selectDeck(ctx, signal);
	if (!deck || signal?.aborted) return { status: "cancelled" };
	const note: AddNoteParams = {
		deckName: deck, modelName: template.name, fields: draftFields(draft, template), tags: normalizeTags(draft.tags ?? []),
	};
	validateFields(note.fields, template);
	while (!signal?.aborted) {
		const choice = await previewChoice(ctx, note, signal, draft.revision);
		if (choice === "n" || signal?.aborted) return { status: "cancelled", draft: note };
		if (choice === "y") {
			validateFields(note.fields, template);
			const [valid] = await canAddNotes([note]);
			if (!valid) throw new Error("Anki rejected this draft (duplicate or invalid fields). No note was added.");
			if (signal?.aborted) return { status: "cancelled", draft: note };
			const noteId = await addNote(note);
			return { status: "created", noteId, note };
		}
		if (choice === "e") {
			const edited = await ctx.ui.editor("修改字段 JSON（保存后返回预览）", JSON.stringify(note.fields, null, 2));
			if (edited === undefined) continue;
			try {
				const fields = JSON.parse(edited);
				if (!fields || Array.isArray(fields) || typeof fields !== "object" || Object.values(fields).some((v) => typeof v !== "string")) {
					throw new Error("Fields must be a JSON object with string values");
				}
				const next = draftFields({ fields }, template);
				validateFields(next, template);
				note.fields = next;
			} catch (error) { ctx.ui.notify(String(error), "error"); }
		}
		if (choice === "r") {
			const feedback = await ctx.ui.editor("你想怎么改？Pi 会按建议重写，再给你确认", draft.revision ?? "");
			if (signal?.aborted) return { status: "cancelled", draft: note };
			if (!feedback?.trim()) continue;
			return { status: "needs_revision", template, draft: note, feedback: feedback.trim(),
				instruction: "Revise this draft according to feedback. Preserve its deck and tags unless the feedback changes them. Call anki_add_note again with the revised fields and revision=the exact feedback so the user sees their request in the new preview. A new y confirmation is required." };
		}
		if (choice === "g") {
			const tags = await ctx.ui.editor("修改标签（空格或逗号分隔；pi 自动保留）", note.tags!.join(" "));
			if (tags !== undefined) note.tags = normalizeTags([tags]);
		}
		if (choice === "d") {
			const selected = await selectDeck(ctx, signal);
			if (selected) note.deckName = selected;
		}
		if (choice === "t") {
			const selected = await ctx.ui.select("选择模板（Anki 笔记类型）", context.templates.map((t) => t.name), { signal });
			if (!selected || selected === template.name) continue;
			// Return to the agent for semantic regeneration; never silently move fields by position.
			return { status: "needs_revision", template: context.templates.find((t) => t.name === selected), draft: note,
				instruction: "Regenerate this draft using the selected template's named fields, then call anki_add_note for a new preview." };
		}
	}
	return { status: "cancelled", draft: note };
}
