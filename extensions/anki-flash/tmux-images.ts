/** Text-bound kitty placements: tmux moves/clips the cells, not a window image. */
import { execFileSync } from "node:child_process";
import { allocateImageId, encodeKitty, getCellDimensions, deleteKittyImage } from "@earendil-works/pi-tui";
import { KITTY_DIACRITICS } from "./kitty-diacritics";

interface Image {
	id: number;
	name: string;
	base64: string;
	widthPx: number;
	heightPx: number;
	maxWidth: number;
	maxHeight: number;
	uploadedSize?: string;
}
const images = new Map<string, Image>();
export const inTmux = () => Boolean(process.env.TMUX);
export function tmuxWrap(sequence: string): string {
	return `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

/** Query the originating server explicitly; default/vibe sockets can coexist. */
export function tmuxImagesVisible(): boolean {
	if (!process.env.TMUX || !process.env.TMUX_PANE) return false;
	try {
		const socket = process.env.TMUX.slice(0, process.env.TMUX.lastIndexOf(",", process.env.TMUX.lastIndexOf(",") - 1));
		const state = execFileSync("tmux", ["-S", socket, "display-message", "-p", "-t", process.env.TMUX_PANE,
			"#{pane_active}:#{window_active}:#{session_attached}:#{pane_in_mode}"], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).trim();
		return /^1:1:[1-9]\d*:0$/.test(state);
	} catch {
		return false;
	}
}

export function createTmuxImage(image: Omit<Image, "id">): string {
	const id = allocateImageId();
	const token = `[ANKI_IMAGE:${id}]`;
	images.set(token, { ...image, id });
	return token;
}

/** Resolve at layout time, so resizing and focus changes don't reuse stale geometry. */
export function layoutTmuxImage(token: string, width: number, visible: boolean): string[] | null {
	const image = images.get(token);
	if (!image) return null;
	if (!visible) {
		image.uploadedSize = undefined;
		return [`[image: ${image.name}]`];
	}
	const cell = getCellDimensions();
	const maxWidth = Math.max(1, Math.min(256, Math.floor(width), image.maxWidth));
	const maxHeight = Math.max(1, Math.min(256, image.maxHeight));
	const scale = Math.min(maxWidth * cell.widthPx / image.widthPx, maxHeight * cell.heightPx / image.heightPx);
	const columns = Math.max(1, Math.min(maxWidth, Math.ceil(image.widthPx * scale / cell.widthPx)));
	const rows = Math.max(1, Math.min(maxHeight, Math.ceil(image.heightPx * scale / cell.heightPx)));
	const size = `${columns}x${rows}`;
	if (image.uploadedSize !== size) {
		// Control data stays out of TUI text: its ANSI parser cannot measure DCS envelopes.
		// Bound each DCS envelope to one kitty chunk instead of the entire media file.
		// Don't register this upload with pi-tui's ordinary placement/cropping machinery.
		const upload = encodeKitty(image.base64, { imageId: image.id, columns, rows, moveCursor: false })
			.replace("a=T,", "a=T,U=1,p=1,");
		process.stdout.write((upload.match(/\x1b_G[\s\S]*?\x1b\\/g) ?? []).map(tmuxWrap).join(""));
		image.uploadedSize = size;
	}
	const red = (image.id >>> 16) & 255, green = (image.id >>> 8) & 255, blue = image.id & 255;
	const high = KITTY_DIACRITICS[image.id >>> 24];
	return Array.from({ length: rows }, (_, row) => {
		let text = `\x1b[38;2;${red};${green};${blue}m`;
		for (let column = 0; column < columns; column++) {
			text += `\u{10eeee}${KITTY_DIACRITICS[row]}${KITTY_DIACRITICS[column]}${high}`;
		}
		return text + "\x1b[39m";
	});
}

export function releaseTmuxImages(lines: string[]): void {
	for (const token of lines) {
		const image = images.get(token);
		if (!image) continue;
		process.stdout.write(tmuxWrap(deleteKittyImage(image.id)));
		images.delete(token);
	}
}
