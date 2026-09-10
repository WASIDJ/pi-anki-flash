/**
 * AnkiConnect client — thin typed wrapper over the JSON HTTP API.
 * Requires Anki desktop running with the AnkiConnect add-on (code 2055492159).
 */

export const DEFAULT_CONNECT_URL = "http://127.0.0.1:8765";

let connectUrl = DEFAULT_CONNECT_URL;

export function setConnectUrl(url: string): void {
	connectUrl = url;
}

export async function anki<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
	const res = await fetch(connectUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, version: 6, params }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
	const json = (await res.json()) as { result: T; error: string | null };
	if (json.error) throw new Error(String(json.error));
	return json.result;
}

export async function ping(): Promise<boolean> {
	try {
		await anki<number>("version");
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuiCard {
	answer: string;
	question: string;
	deckName: string;
	modelName: string;
	buttons: number[];
	nextReviews: string[];
	cardId: number;
}

export interface DeckStat {
	name: string;
	deck_id: number;
	new_count: number;
	learn_count: number;
	review_count: number;
	total_in_deck: number;
}

export interface CardInfo {
	cardId: number;
	note: number;
	deckName: string;
	modelName: string;
	question: string;
	answer: string;
	css: string;
	fields: Record<string, { value: string; order: number }>;
	type: number; // 0=new, 1=learn, 2=review, 3=relearn
	interval: number | null; // days (negative = seconds for learning)
	reps: number;
	lapses: number;
	ease: number;
	ord: number;
	mod: number;
}

export interface AddNoteMedia {
	filename: string;
	/** local file path (will be read + stored) or "https://..." URL */
	path?: string;
	url?: string;
	fields?: string[];
}

export interface AddNoteParams {
	deckName: string;
	modelName: string;
	fields: Record<string, string>;
	tags?: string[];
	audio?: AddNoteMedia[];
	picture?: AddNoteMedia[];
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export const deckNames = () => anki<string[]>("deckNames");
export const createDeck = (deck: string) => anki<number>("createDeck", { deck });
export const getDeckStats = (decks: string[]) => anki<Record<string, DeckStat>>("getDeckStats", { decks });
export const getDeckConfig = (deck: string) => anki<Record<string, unknown>>("getDeckConfig", { deck });

// ---------------------------------------------------------------------------
// Cards & review
// ---------------------------------------------------------------------------

export const findCards = (query: string) => anki<number[]>("findCards", { query });
export const cardsInfo = (cards: number[]) => anki<CardInfo[]>("cardsInfo", { cards });
export const guiDeckReview = (name: string) => anki<unknown>("guiDeckReview", { name });
export const guiCurrentCard = () => anki<GuiCard | null>("guiCurrentCard");
export const guiShowAnswer = () => anki<unknown>("guiShowAnswer");
export const guiAnswerCard = (ease: number) => anki<boolean[]>("guiAnswerCard", { ease });
export const undo = () => anki<string>("undo");
export const suspendCards = (cards: number[]) => anki<boolean[]>("suspendCards", { cards });
export const unsuspendCards = (cards: number[]) => anki<unknown>("unsuspendCards", { cards });
export const suspended = (card: number) => anki<boolean | null>("suspended", { card });

export async function toggleSuspend(cardIds: number[]): Promise<boolean[]> {
	const states = await anki<boolean[]>("areSuspended", { cards: cardIds });
	if (states.every(Boolean)) {
		await unsuspendCards(cardIds);
		return cardIds.map(() => false);
	}
	return suspendCards(cardIds);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const addNote = (params: AddNoteParams) => anki<number>("addNote", { note: params });
export const notesInfo = (notes: number[]) => anki<Array<Record<string, unknown>>>("notesInfo", { notes });
export const deleteNotes = (notes: number[]) => anki<unknown>("deleteNotes", { notes });
export const findNotes = (query: string) => anki<number[]>("findNotes", { query });
export const modelNames = () => anki<string[]>("modelNames");
export const modelFieldNames = (modelName: string) => anki<string[]>("modelFieldNames", { modelName });
export const modelTemplates = (modelName: string) =>
	anki<Record<string, { Front: string; Back: string }>>("modelTemplates", { modelName });
export const getTags = () => anki<string[]>("getTags");
export const canAddNotes = (notes: AddNoteParams[]) => anki<boolean[]>("canAddNotes", { notes });

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const retrieveMediaFile = (filename: string) => anki<string>("retrieveMediaFile", { filename });
export const storeMediaFile = (filename: string, dataBase64: string) =>
	anki<string>("storeMediaFile", { filename, data: dataBase64 });
export const deleteMediaFile = (filename: string) => anki<boolean>("deleteMediaFile", { filename });

// ---------------------------------------------------------------------------
// Review history
// ---------------------------------------------------------------------------

export interface ReviewRecord {
	cardID: number;
	usn: number;
	buttonPressed: number; // 1-4
	newInterval: number;
	previousInterval: number;
	newFactor: number;
	time: number; // epoch ms
	type: number; // 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 study-ahead
}

export const getReviewsOfCards = (cards: number[]) =>
	anki<Record<string, ReviewRecord[]>>("getReviewsOfCards", { cards });

export const getNumCardsReviewedByDay = () =>
	anki<Array<[string, number]>>("getNumCardsReviewedByDay");

// ---------------------------------------------------------------------------
// Convenience: pick the deck with the most due cards
// ---------------------------------------------------------------------------

export async function pickDeck(preferred: string | undefined, priority: string[] = []): Promise<string | null> {
	const all = (await deckNames()).filter((d) => d !== "Default");
	if (preferred) {
		const match = all.find((d) => d === preferred) ?? all.find((d) => d.toLowerCase() === preferred.toLowerCase()) ?? null;
		if (!match) throw new Error(`Deck not found: ${preferred} (have: ${all.join(", ") || "none"})`);
		return match;
	}
	if (all.length === 0) return null;

	// Priority list: first matching deck with due cards wins.
	for (const want of priority) {
		const found = all.find((d) => d.toLowerCase().includes(want.toLowerCase()));
		if (found) {
			const stats = await getDeckStats([found]);
			const s = Object.values(stats)[0];
			if (s && s.new_count + s.learn_count + s.review_count > 0) return found;
		}
	}

	const stats = await getDeckStats(all);
	let best: string | null = null;
	let bestDue = -1;
	for (const s of Object.values(stats)) {
		const due = (s.new_count ?? 0) + (s.learn_count ?? 0) + (s.review_count ?? 0);
		if (due > bestDue) {
			bestDue = due;
			best = s.name;
		}
	}
	return bestDue > 0 ? best : null;
}
