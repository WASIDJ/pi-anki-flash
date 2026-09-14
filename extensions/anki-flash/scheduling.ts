/** Deck-scoped scheduling changes through AnkiConnect's preset API. */
import { anki, deckNames, getDeckConfig } from "./connect";

export interface StudyPlanChanges {
	desiredRetention?: number;
	newCardsPerDay?: number;
	reviewsPerDay?: number;
	learningStepsMinutes?: number[];
	relearningStepsMinutes?: number[];
}

type Config = Record<string, any>;
const paths: Record<keyof StudyPlanChanges, string[]> = {
	desiredRetention: ["desiredRetention"],
	newCardsPerDay: ["new", "perDay"],
	reviewsPerDay: ["rev", "perDay"],
	learningStepsMinutes: ["new", "delays"],
	relearningStepsMinutes: ["lapse", "delays"],
};
const notices = [
	"FSRS enabled state is unknown: enable FSRS in Anki first. Saving desired retention does not enable FSRS or optimize its parameters.",
	"Limits are preset values; Anki's per-deck/today overrides and parent limits may change the effective daily limit.",
	"Only the named deck is assigned this preset; subdecks are not reassigned. Existing cards are not bulk-rescheduled.",
];

function readValues(config: Config): StudyPlanChanges {
	return Object.fromEntries(Object.entries(paths).map(([key, path]) =>
		[key, path.reduce((value, part) => value?.[part], config)]));
}

function validate(changes: StudyPlanChanges): void {
	const entries = Object.entries(changes);
	if (!entries.length) throw new Error("Specify at least one study-plan setting.");
	for (const [key, value] of entries) {
		if (!Object.hasOwn(paths, key)) throw new Error(`Unknown setting: ${key}`);
		if (key === "desiredRetention") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0.7 || value > 0.99)
				throw new Error("desiredRetention must be 0.70–0.99; use 0.9 for 90%.");
		} else if (key.endsWith("PerDay")) {
			if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 9999)
				throw new Error(`${key} must be an integer from 0 to 9999.`);
		} else if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v >= 1440)) {
			throw new Error(`${key} must be an array of positive minutes below 1440; [] lets FSRS handle short-term scheduling on supported Anki versions.`);
		}
	}
}

async function snapshot(deck: string) {
	const names = await deckNames();
	if (!names.includes(deck)) throw new Error(`Deck not found: ${deck}`);
	const configs = await Promise.all(names.map(async (name) => ({ name, config: await getDeckConfig(name) })));
	const config = configs.find((entry) => entry.name === deck)!.config as Config;
	if (!config || !Number.isSafeInteger(Number(config.id)) || Number(config.id) <= 0 || config.dyn)
		throw new Error("This deck has no supported regular-deck preset (filtered decks are unsupported).");
	// Filtered decks may not have a preset. A failed API call, however, aborts discovery.
	const sharedWith = configs.filter((entry) => entry.name !== deck && entry.config && String(entry.config.id) === String(config.id)).map((entry) => entry.name);
	return { config, sharedWith };
}

export async function getStudyPlan(deck: string) {
	const { config, sharedWith } = await snapshot(deck);
	return { deck, presetId: config.id, presetName: config.name, sharedWith, settings: readValues(config), fsrsEnabled: "unknown", notices };
}

// Serialize mutations in this plugin so two agent calls cannot overwrite each other.
let pending: Promise<unknown> = Promise.resolve();
export function setStudyPlan(deck: string, changes: StudyPlanChanges, apply = false) {
	const task = pending.then(() => changePlan(deck, changes, apply));
	pending = task.catch(() => {});
	return task;
}

async function changePlan(deck: string, changes: StudyPlanChanges, apply: boolean) {
	validate(changes);
	const { config, sharedWith } = await snapshot(deck);
	const next = structuredClone(config);
	for (const [key, value] of Object.entries(changes)) {
		const path = paths[key as keyof StudyPlanChanges];
		let node = next;
		for (const part of path.slice(0, -1)) node = node?.[part];
		const leaf = path[path.length - 1];
		if (!node || !(leaf in node)) throw new Error(`Installed Anki does not expose ${key}; no changes saved.`);
		node[leaf] = value;
	}
	const before = readValues(config);
	const after = readValues(next);
	const changed = JSON.stringify(before) !== JSON.stringify(after);
	// Default preset is also used by future decks; never mutate it in place.
	const isolate = sharedWith.length > 0 || Number(config.id) === 1;
	const result = { deck, before, after, sharedWith, clonePreset: changed && isolate, notices };
	if (!apply || !changed) return { ...result, applied: false, status: changed ? "preview" : "unchanged" };
	const current = await getDeckConfig(deck);
	if (JSON.stringify(current) !== JSON.stringify(config)) throw new Error("Deck configuration changed during preview; retry with fresh settings.");
	let clonedId: number | undefined;
	const presetName = `pi: ${deck} (${Date.now()})`;
	try {
		if (isolate) {
			const id = await anki<number | false>("cloneDeckConfigId", { name: presetName, cloneFrom: String(config.id) });
			if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id === Number(config.id)) throw new Error("Anki refused to clone the preset.");
			clonedId = id;
			next.id = id;
			next.name = presetName;
		}
		if (await anki<boolean>("saveDeckConfig", { config: next }) !== true) throw new Error("Anki refused to save the preset.");
		if (clonedId !== undefined && await anki<boolean>("setDeckConfigId", { decks: [deck], configId: clonedId }) !== true)
			throw new Error("Anki refused to assign the preset.");
		const saved = await getDeckConfig(deck) as Config;
		if (String(saved.id) !== String(next.id)) throw new Error("Preset assignment verification failed.");
		const actual = readValues(saved);
		for (const key of Object.keys(changes) as (keyof StudyPlanChanges)[]) {
			const a = actual[key], b = after[key];
			const matches = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : JSON.stringify(a) === JSON.stringify(b);
			if (!matches) throw new Error(`Anki did not retain ${key}.`);
		}
		return { ...result, after: actual, applied: true, status: "saved", presetId: saved.id, presetName: saved.name };
	} catch (error) {
		let restored = false;
		try {
			const ok = clonedId !== undefined
				? await anki<boolean>("setDeckConfigId", { decks: [deck], configId: Number(config.id) })
				: await anki<boolean>("saveDeckConfig", { config });
			const restoredConfig = await getDeckConfig(deck) as Config;
			restored = ok === true && String(restoredConfig.id) === String(config.id)
				&& JSON.stringify(readValues(restoredConfig)) === JSON.stringify(before);
		} catch { /* Report uncertain state instead of claiming success. */ }
		throw new Error(`${error instanceof Error ? error.message : error} ${restored ? "Original deck settings restored." : "Restoration could not be verified; inspect the deck in Anki."}${clonedId !== undefined ? ` Unused preset ${clonedId} may remain in Anki.` : ""}`);
	}
}
