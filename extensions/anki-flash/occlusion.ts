/** Native Anki Image Occlusion: normalized coordinates and rendered cloze masks. */
import sharp from "sharp";

export interface OcclusionDraft {
	image: string;
	masks: { left: number; top: number; width: number; height: number; group?: number }[];
	hideOthers?: boolean;
}
export function occlusionFields(draft: OcclusionDraft): Record<string, string> {
	if (!draft.image.trim() || !draft.masks.length || draft.masks.length > 500) throw new Error("Image Occlusion requires an image and 1–500 masks");
	const masks = draft.masks.map((m, index) => {
		for (const value of [m.left, m.top, m.width, m.height]) {
			if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("遮罩坐标须为图片宽高的 0–1 比例");
		}
		if (m.width <= 0 || m.height <= 0 || m.left + m.width > 1.000001 || m.top + m.height > 1.000001) throw new Error("遮罩尺寸须为正数，且位于图片内部");
		const group = m.group ?? index + 1;
		if (!Number.isInteger(group) || group < 1 || group > 500) throw new Error("遮罩 group 须为 1–500 的整数；同组生成一张卡");
		return `{{c${group}::image-occlusion:rect:left=${m.left}:top=${m.top}:width=${m.width}:height=${m.height}:oi=${draft.hideOthers === false ? 0 : 1}}}`;
	});
	const src = draft.image.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
	return { Occlusion: masks.join("<br>"), Image: `<img src="${src}">` };
}
export const isImageOcclusion = (html: string) => /image-occlusion-(?:canvas|container)/i.test(html);

function attributes(tag: string): Record<string, string> {
	return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
		.map((m) => [m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")]));
}
function numeric(attrs: Record<string, string>, key: string, fallback?: number): number {
	const value = attrs[`data-${key}`] === undefined ? fallback : Number(attrs[`data-${key}`]);
	if (value === undefined || !Number.isFinite(value)) throw new Error(`Invalid occlusion ${key}`);
	return value;
}

/** Read Anki's rendered classes, never execute its scripts or show an unmasked front. */
export async function compositeOcclusion(base64: string, html: string): Promise<string> {
	const image = sharp(Buffer.from(base64, "base64"));
	const { width, height } = await image.metadata();
	if (!width || !height) throw new Error("Invalid image dimensions");
	const tags = [...html.matchAll(/<div\b[^>]*\bdata-shape\s*=[^>]*>/gi)];
	if (!tags.length) throw new Error("未找到原生遮罩数据，请在 Anki 中查看此卡");
	const shapes: string[] = [];
	for (const [tag] of tags) {
		const attrs = attributes(tag);
		const classes = (attrs.class ?? "").split(/\s+/);
		const active = classes.includes("cloze"), highlight = classes.includes("cloze-highlight"), inactive = classes.includes("cloze-inactive");
		if (!active && !highlight && !inactive) throw new Error("Unknown occlusion state");
		if (inactive && attrs["data-occludeinactive"] !== "1") continue;
		const x = numeric(attrs, "left", 0) * width, y = numeric(attrs, "top", 0) * height;
		const angle = numeric(attrs, "angle", 0) / 10000 * 360;
		const style = `fill="${highlight ? "none" : active ? "#ff8e8e" : "#ffeba2"}" stroke="${highlight ? "#ff8e8e" : "#212121"}" stroke-width="1"`;
		let shape: string;
		switch (attrs["data-shape"]) {
			case "rect": {
				const w = numeric(attrs, "width") * width, h = numeric(attrs, "height") * height;
				if (w <= 0 || h <= 0) throw new Error("Invalid mask dimensions");
				shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${style}/>`; break;
			}
			case "ellipse": {
				const rx = numeric(attrs, "rx") * width, ry = numeric(attrs, "ry") * height;
				if (rx <= 0 || ry <= 0) throw new Error("Invalid ellipse dimensions");
				shape = `<ellipse cx="${x + rx}" cy="${y + ry}" rx="${rx}" ry="${ry}" ${style}/>`; break;
			}
			case "polygon": {
				const points = (attrs["data-points"] ?? "").trim().split(/\s+/).map(p => p.split(",").map(Number));
				if (points.length < 3 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v)))) throw new Error("Invalid polygon");
				const left = Math.min(...points.map(p => p[0])), top = Math.min(...points.map(p => p[1]));
				shape = `<polygon points="${points.map(p => `${x + (p[0] - left) * width},${y + (p[1] - top) * height}`).join(" ")}" ${style}/>`; break;
			}
			default: throw new Error(`暂不支持的遮罩形状：${attrs["data-shape"]}`);
		}
		shapes.push(`<g transform="rotate(${angle} ${x} ${y})">${shape}</g>`);
	}
	const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join("")}</svg>`);
	return (await image.composite([{ input: overlay }]).png().toBuffer()).toString("base64");
}
export function occlusionText(html: string): string {
	return html.replace(/<div\b[^>]*\bdata-shape\s*=[^>]*>[\s\S]*?<\/div>/gi, "")
		.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "");
}
