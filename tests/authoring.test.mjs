import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Load with Pi's actual extension loader, including its TypeScript/module aliases.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
let piRoot = process.env.PI_PACKAGE_DIR;
if (!piRoot) {
	try { piRoot = dirname(require.resolve("@earendil-works/pi-coding-agent/package.json")); }
	catch { piRoot = resolve(dirname(process.execPath), "../lib/node_modules/@earendil-works/pi-coding-agent"); }
}
const { loadExtensions } = await import(pathToFileURL(resolve(piRoot, "dist/core/extensions/loader.js")));
const loaded = await loadExtensions([resolve(root, "extensions/anki-flash/index.ts")], root);
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
const invoke = (name, params, ctx, signal) => extension.tools.get(name).definition.execute("test", params, signal, undefined, ctx);
const resultData = (result) => JSON.parse(result.content[0].text);
const realFetch = globalThis.fetch;
const schemas = {
	Basic: ["Front", "Back"], Cloze: ["Text", "Extra"], Vocabulary: ["Word", "Meaning", "Example"],
};
let requests, writes, addable, decks;

beforeEach(() => {
	requests = []; writes = []; addable = true;
	decks = ["Default", "English"];
	globalThis.fetch = async (_url, options) => {
		const request = JSON.parse(options.body);
		requests.push(request);
		const { action, params } = request;
		let result;
		switch (action) {
			case "modelNames": result = Object.keys(schemas); break;
			case "modelFieldNames": result = schemas[params.modelName]; break;
			case "modelTemplates": result = { Card: { Front: params.modelName === "Cloze" ? "{{cloze:Text}}" : "{{Front}}", Back: "{{Back}}" } }; break;
			case "deckNames": result = [...decks]; break;
			case "createDeck": decks.push(params.deck); result = 42; break;
			case "getTags": result = ["english", "phrase"]; break;
			case "canAddNotes": result = [addable]; break;
			case "addNote": writes.push(params.note); result = 123456; break;
			default: throw new Error(`Unexpected action ${action}`);
		}
		return new Response(JSON.stringify({ result, error: null }), { status: 200 });
	};
});
afterEach(() => { globalThis.fetch = realFetch; });

function uiContext({ keys = [], selections = [], edits = [], inputs = [], mode = "tui", hasUI = true, onPreview } = {}) {
	const previews = [], errors = [], scrolled = [];
	return {
		mode, hasUI, previews, errors, scrolled,
		ui: {
			input: async () => inputs.shift(),
			select: async (_title, options) => {
				const choice = selections.shift();
				assert.ok(choice === undefined || options.includes(choice), `Unavailable selection: ${choice}`);
				return choice;
			},
			editor: async () => edits.shift(),
			notify: (message) => errors.push(message),
			custom: async (factory) => {
				let component;
				try {
					return await new Promise((done) => {
						component = factory({ terminal: { rows: 30 }, requestRender() {} }, { fg: (_color, text) => text, bold: (text) => text }, {}, done);
						previews.push(component.render(80).join("\n"));
						assert.ok(component.render(32).length > 0);
						onPreview?.();
						const input = keys.shift();
						assert.ok(input, "Missing preview input");
						for (const key of input) { component.handleInput(key); scrolled.push(component.render(80).join("\n")); }
					});
				} finally { component?.dispose(); }
			},
		},
	};
}

const basic = { deck: "English", front: "Question", back: "Answer", tags: ["phrase"] };

test("initial picker creates and selects a new nested deck before card confirmation", async () => {
	const ctx = uiContext({ selections: ["＋ 新建牌组…"], inputs: ["English::Phrases"], keys: ["y"] });
	await invoke("anki_add_note", { front: "Question", back: "Answer" }, ctx);
	assert.equal(writes[0].deckName, "English::Phrases");
	assert.match(ctx.previews[0], /牌组: English::Phrases/);
	assert.equal(requests.filter((r) => r.action === "createDeck").length, 1);
});

test("preview deck picker can create a deck; declining the card leaves it empty", async () => {
	await invoke("anki_add_note", basic, uiContext({ keys: ["d", "n"], selections: ["＋ 新建牌组…"], inputs: ["New deck"] }));
	assert.ok(decks.includes("New deck"));
	assert.equal(writes.length, 0);
});

test("cancelled deck name returns to picker; existing names are reused", async () => {
	await invoke("anki_add_note", basic, uiContext({ keys: ["d", "n"], selections: ["＋ 新建牌组…", "＋ 新建牌组…"], inputs: [undefined, "english"] }));
	assert.equal(requests.filter((r) => r.action === "createDeck").length, 0);
});

test("natural-language revision returns feedback and draft without writing", async () => {
	const ctx = uiContext({ keys: ["rn"], edits: ["答案缩短，保留中文并增加一个例子"] });
	const result = resultData(await invoke("anki_add_note", basic, ctx));
	assert.equal(result.status, "needs_revision");
	assert.equal(result.feedback, "答案缩短，保留中文并增加一个例子");
	assert.equal(result.draft.fields.Front, "Question");
	assert.equal(result.draft.deck, "English");
	assert.equal(result.draft.model, "Basic");
	assert.equal(result.draft.revision, "答案缩短，保留中文并增加一个例子");
	assert.equal(writes.length, 0);
});

test("long HTML cards keep template, tags and revision visible while scrolling", async () => {
	const ctx = uiContext({ keys: ["j".repeat(60) + "n"] });
	await invoke("anki_add_note", { ...basic, front: "<b>有限理性</b><br>核心问题", back: "长答案\n".repeat(100), revision: "请缩短答案" }, ctx);
	assert.match(ctx.previews[0], /有限理性/);
	assert.doesNotMatch(ctx.previews[0], /<b>|<br>/);
	assert.match(ctx.scrolled.at(-1), /模板: Basic/);
	assert.match(ctx.scrolled.at(-1), /建议标签: pi  ·  phrase/);
	assert.match(ctx.scrolled.at(-1), /你的修改建议: 请缩短答案/);
	assert.match(ctx.scrolled.at(-1), /\[r\] 提修改建议/);
	assert.equal(writes.length, 0);
});

test("real Pi loader registers the tool and automatic/manual commands", async () => {
	assert.deepEqual(
		[...extension.tools.keys()].sort(),
		[
			"anki_add_note", "anki_card_info", "anki_deck_stats", "anki_delete_notes",
			"anki_find_cards", "anki_get_study_plan", "anki_list_decks", "anki_note_context",
			"anki_set_config", "anki_set_study_plan", "anki_simulate_retention", "anki_suspend_cards",
		].sort(),
	);
	const messages = [];
	loaded.runtime.sendUserMessage = (text) => messages.push(text);
	await extension.commands.get("make-card").handler("manual 最近的短语", {});
	await extension.commands.get("make-card").handler("", {});
	assert.match(messages[0], /templateMode=manual/);
	assert.match(messages[0], /最近的短语/);
	assert.match(messages[1], /templateMode=auto/);
});

test("discovers actual field schemas, cloze fields and existing tags", async () => {
	const context = resultData(await invoke("anki_note_context", {}, uiContext()));
	assert.deepEqual(context.templates.find((t) => t.name === "Cloze").clozeFields, ["Text"]);
	assert.deepEqual(context.tags, ["english", "phrase"]);
	assert.equal(writes.length, 0);
});

test("manual template selection returns the user's chosen model; Esc cancels", async () => {
	const chosen = await invoke("anki_note_context", { templateMode: "manual" }, uiContext({ selections: ["Vocabulary"] }));
	assert.equal(resultData(chosen).selectedTemplate, "Vocabulary");
	const cancelled = await invoke("anki_note_context", { templateMode: "manual" }, uiContext());
	assert.equal(cancelled.details.status, "cancelled");
});

test("y writes exactly the previewed card and normalized tags", async () => {
	const ctx = uiContext({ keys: ["jy"], onPreview: () => assert.equal(writes.length, 0) });
	const result = resultData(await invoke("anki_add_note", { ...basic, tags: ["phrase", "phrase", "english, grammar"] }, ctx));
	assert.equal(result.status, "created");
	assert.equal(writes.length, 1);
	assert.deepEqual(writes[0].fields, { Front: "Question", Back: "Answer" });
	assert.deepEqual(writes[0].tags, ["pi", "phrase", "english", "grammar"]);
	assert.match(ctx.previews[0], /Question/);
});

test("n and Esc never call preflight or write", async () => {
	for (const key of ["n", "\x1b"]) {
		assert.equal(resultData(await invoke("anki_add_note", basic, uiContext({ keys: [key] }))).status, "cancelled");
	}
	assert.ok(requests.every((r) => !["canAddNotes", "addNote"].includes(r.action)));
});

test("field/tag/deck edits receive a new preview before saving, including Default deck", async () => {
	const ctx = uiContext({ keys: ["e", "g", "d", "y"], edits: ['{"Front":"Edited","Back":"New answer"}', "new-tag, phrase"], selections: ["Default"] });
	await invoke("anki_add_note", basic, ctx);
	assert.equal(writes[0].deckName, "Default");
	assert.equal(writes[0].fields.Front, "Edited");
	assert.deepEqual(writes[0].tags, ["pi", "new-tag", "phrase"]);
	assert.match(ctx.previews.at(-1), /Edited/);
});

test("malformed edits retain the draft and allow retry", async () => {
	const ctx = uiContext({ keys: ["e", "y"], edits: ["not JSON"] });
	await invoke("anki_add_note", basic, ctx);
	assert.equal(ctx.errors.length, 1);
	assert.equal(writes[0].fields.Front, "Question");
});

test("deck and template switches persist in the continuation draft", async () => {
	const result = resultData(await invoke("anki_add_note", basic, uiContext({
		keys: ["d", "t"], selections: ["Default", "Cloze"],
	})));
	assert.equal(result.status, "needs_revision");
	assert.deepEqual(result.template.fields, ["Text", "Extra"]);
	assert.equal(result.draft.deck, "Default");
	assert.equal(result.draft.model, "Cloze");
	assert.deepEqual(result.draft.tags, ["pi", "phrase"]);
	assert.deepEqual(result.sourceFields, { Front: "Question", Back: "Answer" });
	assert.equal(writes.length, 0);

	await invoke("anki_add_note", {
		...result.draft,
		fields: { Text: "A {{c1::Question}}", Extra: "Answer" },
	}, uiContext({ keys: ["y"] }));
	assert.equal(writes[0].deckName, "Default");
	assert.equal(writes[0].modelName, "Cloze");
	assert.deepEqual(writes[0].tags, ["pi", "phrase"]);
});

test("automatic Cloze selection and named custom fields survive to Anki", async () => {
	await invoke("anki_add_note", { deck: "Default", fields: { Text: "A {{c1::fact}}", Extra: "context" } }, uiContext({ keys: ["y"] }));
	await invoke("anki_add_note", { deck: "English", model: "Vocabulary", fields: { Word: "recall", Meaning: "remember", Example: "Recall the answer." } }, uiContext({ keys: ["y"] }));
	assert.equal(writes[0].modelName, "Cloze");
	assert.equal(writes[1].fields.Example, "Recall the answer.");
});

test("invalid fields, missing cloze, unknown templates and no UI cannot write", async () => {
	for (const draft of [
		{ ...basic, model: "Missing" },
		{ ...basic, fields: { Wrong: "answer" } },
		{ ...basic, model: "Cloze", fields: { Text: "No deletion" } },
		{ ...basic, model: "Vocabulary" },
	]) assert.equal((await invoke("anki_add_note", draft, uiContext())).isError, true);
	assert.equal((await invoke("anki_add_note", basic, uiContext({ hasUI: false }))).isError, true);
	assert.equal(writes.length, 0);
});

test("duplicate rejection after confirmation never writes", async () => {
	addable = false;
	assert.equal((await invoke("anki_add_note", basic, uiContext({ keys: ["y"] }))).isError, true);
	assert.equal(writes.length, 0);
});

test("abort before or during preview cancels without writing", async () => {
	const controller = new AbortController();
	controller.abort();
	assert.equal(resultData(await invoke("anki_add_note", basic, uiContext(), controller.signal)).status, "cancelled");
	const active = new AbortController();
	const ctx = uiContext({ keys: ["y"], onPreview: () => active.abort() });
	assert.equal(resultData(await invoke("anki_add_note", basic, ctx, active.signal)).status, "cancelled");
	assert.equal(writes.length, 0);
});

test("RPC uses confirmation selection and safely handles cancellation", async () => {
	await invoke("anki_add_note", basic, uiContext({ mode: "rpc", selections: ["y · 保存"] }));
	assert.equal(writes.length, 1);
	const cancelled = resultData(await invoke("anki_add_note", basic, uiContext({ mode: "rpc" })));
	assert.equal(cancelled.status, "cancelled");
	assert.equal(writes.length, 1);
});

test("live Anki discovery, cancellation and preflight (no writes)", { skip: process.env.PI_ANKI_LIVE !== "1" }, async () => {
	globalThis.fetch = async (url, options) => {
		const { action } = JSON.parse(options.body);
		assert.ok(["modelNames", "modelFieldNames", "modelTemplates", "deckNames", "getTags", "canAddNotes"].includes(action));
		return realFetch(url, options);
	};
	const context = resultData(await invoke("anki_note_context", {}, uiContext()));
	assert.ok(context.templates.length > 0);
	for (const model of ["Basic", "Cloze", "Anki Markdown", "Anki Markdown Cloze"]) {
		const schema = context.templates.find((t) => t.name === model);
		if (!schema) continue;
		const fields = Object.fromEntries(schema.fields.map((key, i) => [key, i === 0 ? `pi integration ${Date.now()} ${schema.clozeFields.length ? "{{c1::answer}}" : "question"}` : "answer"]));
		const draft = { deck: context.decks[0], model, fields };
		assert.equal(resultData(await invoke("anki_add_note", draft, uiContext({ keys: ["n"] }))).status, "cancelled");
		const preflight = await globalThis.fetch("http://127.0.0.1:8765", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "canAddNotes", version: 6, params: { notes: [{ deckName: draft.deck, modelName: model, fields, tags: ["pi"] }] } }) });
		const checked = await preflight.json();
		assert.equal(checked.error, null);
		assert.deepEqual(checked.result, [true], model);
	}
});
