/**
 * Plugin configuration, stored under the top-level "ankiFlash" key of
 * ~/.pi/agent/settings.json. pi's SettingsManager only round-trips fields it
 * modified during the session, so unknown top-level keys survive pi saves.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AnkiFlashConfig {
	connectUrl: string;
	/** null = auto-pick (priority list, then most-due deck) */
	defaultDeck: string | null;
	/** deck names (substring, case-insensitive) tried in order before most-due fallback */
	deckPriority: string[];
	autoOpen: {
		enabled: boolean;
		cooldownMin: number;
		onlyWhenDue: boolean;
	};
	media: {
		playAudio: boolean;
		renderImages: boolean;
		maxImageWidthCells: number;
		maxImageHeightCells: number;
	};
	review: {
		allowBrowsingInModal: boolean;
		showCounts: boolean;
		showCardState: boolean;
		showNextReviews: boolean;
	};
	sim: {
		/** retention targets shown by /anki-sim */
		retentions: number[];
		/** days of history pulled for the sanity row */
		historyDays: number;
	};
}

export const DEFAULT_CONFIG: AnkiFlashConfig = {
	connectUrl: "http://127.0.0.1:8765",
	defaultDeck: null,
	deckPriority: [],
	autoOpen: { enabled: false, cooldownMin: 30, onlyWhenDue: true },
	media: { playAudio: true, renderImages: true, maxImageWidthCells: 40, maxImageHeightCells: 30 },
	review: { allowBrowsingInModal: true, showCounts: true, showCardState: true, showNextReviews: true },
	sim: { retentions: [0.8, 0.85, 0.9, 0.95], historyDays: 30 },
};

export function settingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

function readSettingsFile(): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: unknown): T {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return override === undefined ? base : (override as T);
	}
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [k, v] of Object.entries(override)) {
		if (v === undefined) continue;
		out[k] = k in out ? deepMerge(out[k], v) : v;
	}
	return out as T;
}

export function loadConfig(): AnkiFlashConfig {
	return deepMerge(structuredClone(DEFAULT_CONFIG), readSettingsFile()["ankiFlash"]);
}

export function saveConfig(config: AnkiFlashConfig): void {
	const path = settingsPath();
	if (!existsSync(path)) throw new Error(`Settings file not found: ${path}`);
	const file = readSettingsFile();
	file["ankiFlash"] = config;
	writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf-8");
}

/** Set a dotted key (e.g. "autoOpen", "autoOpen.enabled"). Returns the new config. */
export function setConfigKey(dottedKey: string, value: unknown): AnkiFlashConfig {
	const cfg = loadConfig();
	const parts = dottedKey.split(".");
	let node: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = node[parts[i]];
		if (!isPlainObject(next)) throw new Error(`Not a config group: ${parts.slice(0, i + 1).join(".")}`);
		node = next;
	}
	const leaf = parts[parts.length - 1];
	if (!(leaf in node)) throw new Error(`Unknown config key: ${dottedKey}`);
	node[leaf] = value;
	saveConfig(cfg);
	return cfg;
}

/** Parse a CLI value: true/false/null, numbers, JSON, otherwise raw string. */
export function parseConfigValue(raw: string): unknown {
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null") return null;
	const n = Number(raw);
	if (!Number.isNaN(n) && raw.trim() !== "") return n;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}
