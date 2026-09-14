/**
 * Card HTML → terminal lines. Images render via kitty/iTerm2 protocols when
 * the terminal supports them (pi-tui capability detection), otherwise they
 * degrade to "[image: filename]" placeholders.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	renderImage,
	wrapTextWithAnsi,
	getCapabilities,
	getPngDimensions,
	getJpegDimensions,
	getGifDimensions,
	getWebpDimensions,
	allocateImageId,
} from "@earendil-works/pi-tui";
import { retrieveMediaFile, storeMediaFile } from "./connect";
import type { AnkiFlashConfig } from "./config";

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

const IMG_TOKEN = "[IMG_TOKEN]";

export function stripHtml(html: string): string[] {
	return html
		.replace(/\[sound:[^\]]+\]/g, "♪")
		.replace(/<img[^>]*>/g, `\n${IMG_TOKEN}\n`)
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(div|p|li|h[1-6]|tr|td|th)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

export function textLines(html: string, maxLines = 60): { lines: string[]; trimmed: boolean } {
	const lines = stripHtml(html).filter((l) => l !== IMG_TOKEN);
	if (lines.length <= maxLines) return { lines, trimmed: false };
	return { lines: lines.slice(0, maxLines), trimmed: true };
}

export function extractImages(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)) out.push(m[1]);
	return out;
}

export function extractSounds(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1]);
	return out;
}

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) ?? 0;
	// CJK + full-width ranges occupy 2 cells
	return cp >= 0x1100 &&
		(cp <= 0x115f ||
			cp === 0x2329 ||
			cp === 0x232a ||
			(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe10 && cp <= 0xfe6f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x20000 && cp <= 0x3fffd))
		? 2
		: 1;
}

export function visibleLen(s: string): number {
	let n = 0;
	for (const ch of s) n += charWidth(ch);
	return n;
}

/** Wrap text to lines each no wider than `width` terminal cells (CJK-aware). */
export function wrap(text: string, width: number): string[] {
	// Image protocol payloads must never be split or interpreted as text.
	if (text.includes("\x1b_G") || text.includes("\x1bPq") || text.includes("\x1b]1337;")) return [text];
	return wrapTextWithAnsi(text, Math.max(1, width));
}

export function wrapLines(lines: string[], width: number): string[] {
	return lines.flatMap((line) => wrap(line, width));
}

/** The standard Anki back contains FrontSide followed by <hr id=answer>. */
export function answerOnly(question: string, answer: string): string {
	const separator = /<hr\b[^>]*\bid\s*=\s*(?:"answer"|'answer'|answer(?=\s|\/?>))[^>]*>/i.exec(answer);
	if (!separator) return answer;
	const front = answer.slice(0, separator.index);
	// Only remove a known repeated front; custom backs/cloze answers remain intact.
	if (stripHtml(front).join("\n") !== stripHtml(question).join("\n")) return answer;
	return answer.slice(separator.index + separator[0].length);
}

/** Minimal inline emphasis for Markdown authored notes, after HTML extraction. */
export function styleCardLine(line: string): string {
	return line.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[22m").replace(/^[-*] /, "• ");
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export function playSounds(html: string, pi: ExtensionAPI, config: AnkiFlashConfig): void {
	if (!config.media.playAudio) return;
	const sound = extractSounds(html)[0];
	if (!sound) return;
	void (async () => {
		try {
			const b64 = await retrieveMediaFile(sound);
			const path = join(tmpdir(), `pi-anki-flash-${sound}`);
			writeFileSync(path, Buffer.from(b64, "base64"));
			await pi.exec("afplay", [path]);
		} catch {
			// audio is best-effort
		}
	})();
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function imageDimensions(base64: string, filename: string): { widthPx: number; heightPx: number } | null {
	const ext = filename.toLowerCase().split(".").pop() ?? "";
	if (ext === "png") return getPngDimensions(base64);
	if (ext === "jpg" || ext === "jpeg") return getJpegDimensions(base64);
	if (ext === "gif") return getGifDimensions(base64);
	if (ext === "webp") return getWebpDimensions(base64);
	return getPngDimensions(base64) ?? getJpegDimensions(base64);
}

/**
 * Render the first image found in the card HTML. Returns terminal lines
 * (escape sequence plus blank reservation rows) or a placeholder when the
 * terminal can't show images. Capped at config.media.maxImageHeightCells.
 */
export async function renderFirstImage(
	html: string,
	config: AnkiFlashConfig,
): Promise<{ lines: string[]; capped: boolean }> {
	const name = extractImages(html)[0];
	if (!name) return { lines: [], capped: false };
	if (!config.media.renderImages || !getCapabilities().images) {
		return { lines: [`[image: ${name}]`], capped: false };
	}
	try {
		const b64 = await retrieveMediaFile(name);
		const dims = imageDimensions(b64, name);
		if (!dims) return { lines: [`[image: ${name}]`], capped: false };
		const result = renderImage(b64, dims, {
			maxWidthCells: config.media.maxImageWidthCells,
			maxHeightCells: config.media.maxImageHeightCells,
			imageId: allocateImageId(),
		});
		if (!result) return { lines: [`[image: ${name}]`], capped: false };
		const lines = [result.sequence];
		for (let i = 1; i < result.rows; i++) lines.push("");
		return { lines, capped: result.rows >= config.media.maxImageHeightCells };
	} catch {
		return { lines: [`[image: ${name} (unavailable)]`], capped: false };
	}
}

// ---------------------------------------------------------------------------
// Full card → lines
// ---------------------------------------------------------------------------

export interface CardRenderResult {
	questionLines: string[];
	answerLines: string[];
	truncated: boolean;
}

export async function renderCard(
	questionHtml: string,
	answerHtml: string,
	config: AnkiFlashConfig,
): Promise<CardRenderResult> {
	answerHtml = answerOnly(questionHtml, answerHtml);
	const tQ = textLines(questionHtml);
	const tA = textLines(answerHtml);
	const imgQ = await renderFirstImage(questionHtml, config);
	const imgA = await renderFirstImage(answerHtml, config);

	const questionLines = [...(imgQ.lines.length > 0 ? [...imgQ.lines, ...tQ.lines] : tQ.lines)];

	// Answer repeats the same image in most templates — only add its image when different.
	const sameImage = extractImages(answerHtml)[0] && extractImages(answerHtml)[0] === extractImages(questionHtml)[0];
	const answerLines: string[] = [];

	if (!sameImage && imgA.lines.length > 0) {
		answerLines.push(...imgA.lines);
	}
	answerLines.push(...tA.lines);

	const truncated = tQ.trimmed || tA.trimmed || imgQ.capped || (!sameImage && imgA.capped);
	return { questionLines, answerLines, truncated };
}

/** Upload a local media file to Anki's media dir; returns the stored filename. */
export async function storeLocalMedia(path: string): Promise<string> {
	const filename = path.split("/").pop() ?? "media.bin";
	const data = readFileSync(path).toString("base64");
	const stored = await storeMediaFile(filename, data);
	return stored ?? filename;
}
