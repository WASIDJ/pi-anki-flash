/**
 * FSRS retention simulation ("choose your desired retention, see the workload").
 *
 * Aggregate model (deliberately simple and read-only):
 *   - Pull every card in a deck, use its current interval as baseline.
 *   - FSRS-4.5 forgetting curve: R(t,S) = (1 + FACTOR * t / S)^DECAY
 *       FACTOR = 19/81, DECAY = -0.5
 *       Inverting for the interval that yields target retention DR:
 *       I(S, DR) = S * (DR^(1/DECAY) - 1) / FACTOR = S * (DR^-2 - 1) * 81/19
 *   - A card currently scheduled to show R0 = deck's configured desiredRetention
 *     (or 0.9 when unknown) has stability S ≈ I0 / g(DR0), so under a new
 *     target DRn the next interval becomes I_n = I0 * g(DRn)/g(DR0) (stability
 *     unchanged, first-order approximation).
 *   - Expected daily review load L = Σ 1 / I_n  (each review card shows every
 *     I_n days). Daily forgotten ≈ L * (1 - DRn).
 *
 * This is a planning aid, not a scheduler — pi never writes these intervals.
 */

import {
	findCards,
	cardsInfo,
	getDeckConfig,
	getNumCardsReviewedByDay,
} from "./connect";

const FACTOR = 19 / 81;

/** g(DR): days-of-stability multiplier for a target retention (FSRS-4.5). */
function g(retention: number, decay = -0.5, factor = FACTOR): number {
	return (Math.pow(retention, 1 / decay) - 1) / factor;
}

export interface SimRow {
	retention: number;
	avgIntervalDays: number;
	dailyReviews: number;
	dailyForgotten: number;
	monthlyReviews: number;
}

export interface SimResult {
	deck: string;
	cardCount: number;
	reviewCardCount: number;
	learnCardCount: number;
	currentRetention: number;
	currentDailyReviews: number;
	rows: SimRow[];
	history: { days: number; total: number; dailyAvg: number } | null;
	notes: string[];
}

export async function simulateDeck(deck: string, retentions: number[], historyDays = 30): Promise<SimResult> {
	const ids = await findCards(`deck:"${deck}"`);
	const notes: string[] = [];
	if (ids.length === 0) throw new Error(`Deck "${deck}" has no cards`);

	// Get current desiredRetention from the deck config; fall back to 0.9.
	let currentRetention = 0.9;
	try {
		const cfg = await getDeckConfig(deck);
		const dr = (cfg?.["rev"] as Record<string, unknown> | undefined)?.["desiredRetention"];
		if (typeof dr === "number" && dr > 0.5 && dr < 1) {
			currentRetention = dr;
		} else {
			const direct = cfg?.["desiredRetention"];
			if (typeof direct === "number" && direct > 0.5 && direct < 1) currentRetention = direct;
		}
	} catch {
		notes.push("Deck config unreadable — assumed current retention 0.90");
	}

	const info = await cardsInfo(ids);
	const review = info.filter((c) => c.type === 2 || c.type === 3);
	const learn = info.filter((c) => c.type < 2);

	const g0 = g(currentRetention);

	// Learning cards keep showing up whatever the retention target; treat their
	// throughput as a fixed daily addend (rough: each learn card reviewed the
	// day it's due, i.e. 1/day while in learning).
	const learnDaily = learn.length * 0.5;

	const rows: SimRow[] = retentions
		.map((dr) => {
			const gNew = g(dr);
			const factor = gNew / g0;
			let meanInterval = 0;
			let load = 0;
			for (const c of review) {
				const iv = Math.max(1, c.interval ?? 1);
				const scaled = iv * factor;
				meanInterval += scaled;
				load += 1 / scaled;
			}
			if (review.length > 0) meanInterval /= review.length;
			const daily = load + learnDaily;
			return {
				retention: dr,
				avgIntervalDays: Math.round(meanInterval * 10) / 10,
				dailyReviews: Math.round(daily * 10) / 10,
				dailyForgotten: Math.round(daily * (1 - dr) * 10) / 10,
				monthlyReviews: Math.round(daily * 30),
			};
		})
		.sort((a, b) => a.retention - b.retention);

	const currentRow = rows.reduce((best, r) =>
		Math.abs(r.retention - currentRetention) < Math.abs(best.retention - currentRetention) ? r : best,
	);

	let history: SimResult["history"] = null;
	try {
		const perDay = await getNumCardsReviewedByDay();
		const last = perDay.slice(-historyDays);
		const total = last.reduce((s, d) => s + d[1], 0);
		history = { days: last.length, total, dailyAvg: Math.round((total / Math.max(1, last.length)) * 10) / 10 };
	} catch {
		// history is optional
	}

	if (learn.length > 0) {
		notes.push(`${learn.length} learning/new cards included as a fixed ~${learnDaily.toFixed(1)} reviews/day addend`);
	}
	notes.push("Assumes stability is unchanged by the retention target (first-order FSRS approximation)");

	return {
		deck,
		cardCount: info.length,
		reviewCardCount: review.length,
		learnCardCount: learn.length,
		currentRetention,
		currentDailyReviews: currentRow.dailyReviews,
		rows,
		history,
		notes,
	};
}

export function formatSimTable(result: SimResult): string[] {
	const lines: string[] = [];
	lines.push(`FSRS retention simulation — deck "${result.deck}"`);
	lines.push(
		`${result.cardCount} cards (${result.reviewCardCount} in review, ${result.learnCardCount} learning) · current target ≈ ${(result.currentRetention * 100).toFixed(0)}%`,
	);
	lines.push("");
	lines.push("  retention | avg interval | reviews/day | forgotten/day | reviews/30d");
	lines.push("  ----------+--------------+--------------+---------------+------------");
	for (const r of result.rows) {
		const marker = Math.abs(r.retention - result.currentRetention) < 0.001 ? "→" : " ";
		lines.push(
			`${marker}   ${(r.retention * 100).toFixed(0).padStart(3)}%   | ${String(r.avgIntervalDays).padStart(10)}d |${String(r.dailyReviews).padStart(11)} |${String(r.dailyForgotten).padStart(13)} |${String(r.monthlyReviews).padStart(11)}`,
		);
	}
	if (result.history) {
		lines.push("");
		lines.push(
			`Actual history (all decks): ${result.history.total} reviews over last ${result.history.days} days (≈${result.history.dailyAvg}/day)`,
		);
	}
	if (result.notes.length > 0) {
		lines.push("");
		for (const n of result.notes) lines.push(`· ${n}`);
	}
	return lines;
}
