// Opt-in real model + real Anki smoke test. All card previews are declined.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const mode of ["auto", "manual"]) {
	const child = spawn("pi", [
		"--mode", "rpc", "--no-session", "--no-extensions", "--no-context-files",
		"-e", `${root}extensions/anki-flash/index.ts`,
		"-e", `${homedir()}/.pi/agent/npm/node_modules/@xzzpig/pi-permission-system/src/index.ts`,
		"--tools", "anki_note_context,anki_add_note", "--thinking", "low",
	], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
	const send = (value) => child.stdin.write(JSON.stringify(value) + "\n");
	let previewed = false, selectedTemplate = false, discovered = false;
	let requestedRevision = false, revised = false;
	const feedback = "答案缩短成一句中文，保留 KV cache 这个词";
	let errorOutput = "";
	child.stderr.on("data", (data) => { errorOutput += data; });
	const lines = createInterface({ input: child.stdout });
	try {
		await new Promise((done, reject) => {
			const timeout = setTimeout(() => reject(new Error(`${mode}: timeout waiting for card preview`)), 150_000);
			const finish = (error) => { clearTimeout(timeout); error ? reject(error) : done(); };
			child.on("error", finish);
			child.on("exit", (code) => { if (!previewed) finish(new Error(`Pi exited (${code}): ${errorOutput.slice(-800)}`)); });
			lines.on("line", (line) => {
				let event;
				try { event = JSON.parse(line); } catch { return; }
				try {
					if (event.type === "tool_execution_end") {
						assert.ok(!event.isError, `${event.toolName} failed: ${JSON.stringify(event.result)}`);
						if (event.toolName === "anki_note_context") discovered = true;
						if (event.toolName === "anki_add_note") {
							if (event.result.details.status === "needs_revision") {
								assert.equal(event.result.details.feedback, feedback);
								return;
							}
							assert.equal(event.result.details.status, "cancelled");
							assert.ok(previewed && discovered);
							assert.ok(mode !== "manual" || selectedTemplate);
							assert.ok(mode !== "auto" || revised);
							finish();
						}
					}
					if (event.type === "extension_ui_request" && event.method === "editor") {
						send({ type: "extension_ui_response", id: event.id, value: feedback });
					}
					if (event.type === "extension_ui_request" && event.method === "select") {
						assert.ok(!/Permission Required|Allow tool/i.test(event.title), "Generic permission dialog hides card preview");
						if (event.options.includes("n · 跳过")) {
							assert.match(event.title, /建议标签/);
							if (mode === "manual") assert.match(event.title, /模板: Anki Markdown Cloze/);
							previewed = true;
							if (mode === "auto" && !requestedRevision) {
								requestedRevision = true;
								send({ type: "extension_ui_response", id: event.id, value: "r · 提修改建议，让 Pi 重写" });
								return;
							}
							if (mode === "auto") {
								assert.ok(event.title.includes(`你的修改建议: ${feedback}`));
								revised = true;
							}
							console.log(`${mode}: card preview received; choosing n`);
							send({ type: "extension_ui_response", id: event.id, value: "n · 跳过" });
						} else if (event.options.includes("Anki Markdown Cloze") && /模板/.test(event.title)) {
							selectedTemplate = true;
							send({ type: "extension_ui_response", id: event.id, value: "Anki Markdown Cloze" });
						} else {
							// Unexpected dialogs are declined; this test never approves a write.
							send({ type: "extension_ui_response", id: event.id, cancelled: true });
						}
					}
					if (event.type === "agent_end" && !previewed) finish(new Error(`${mode}: agent ended without a preview`));
				} catch (error) { finish(error); }
			});
			send({ id: `smoke-${mode}`, type: "prompt", message:
				`帮我 make card，只做一张，放进 AIInfra 牌组：KV cache 保存之前 token 的 key/value，避免生成时重复计算。${mode === "manual" ? "我要手动选择 template。" : "请自动选择合适的 template。"} 请直接打开制卡预览，给出相关 tag 建议。` });
		});
		console.log(`${mode}: real Pi model → context → preview → cancel passed`);
	} finally {
		lines.close();
		child.kill("SIGTERM");
	}
}
