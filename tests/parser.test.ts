import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNote } from "../src/parser/annotation-parser.ts";
import { normalizeMath } from "../src/renderer/math.ts";
import { parseZoteroUri, zoteroTargets } from "../src/navigation/zotero-uri.ts";

const note = readFileSync(new URL("../fixtures/sample-note.md", import.meta.url), "utf8");
const { annotations: A, warnings } = parseNote(note, "n.md");
const byId = (id: string) => A.find((a) => a.id === id)!;

test("finds 4 annotations, both modes, no warnings", () => {
	assert.equal(A.length, 4);
	assert.deepEqual(A.map((a) => a.mode), ["explicit", "explicit", "legacy", "legacy"]);
	assert.deepEqual(warnings, []);
});

test("explicit: full annotation, multiline comment + math preserved verbatim", () => {
	const a = byId("AKAGJ6KP");
	assert.equal(a.highlight, "The model attains $\\alpha = 0.83$ on RefCOCO.");
	assert.equal(a.colorClass, "hltr-cyan");
	assert.deepEqual(a.tags, ["grounding", "eval/refcoco"]);
	assert.deepEqual(a.images, ["media/fig3.png"]);
	assert.equal(a.pageLabel, "5");
	assert.equal(a.zotero?.annotationKey, "AKAGJ6KP");
	assert.match(a.comment!, /\\\(x\^2 \+ y\^2\\\)\.\n\nSecond paragraph/); // blank line kept
	assert.match(a.comment!, /\$\$\n\\mathcal\{L\}[^\n]*\n\$\$/); // display block intact
	assert.match(a.comment!, /- a list item$/);
});

test("explicit: image-only, no page link, colour from header", () => {
	const a = byId("IMG00001");
	assert.equal(a.highlight, undefined);
	assert.equal(a.comment, undefined);
	assert.equal(a.zotero, undefined);
	assert.equal(a.colorClass, "hltr-orange");
	assert.deepEqual(a.images, ["media/fig4.png"]); // |400 stripped
});

test("legacy: segmented by page link, id from URI, roman page label kept", () => {
	const a = byId("LEGACY01");
	assert.equal(a.confidence, "heuristic");
	assert.equal(a.pageLabel, "iv");
	assert.equal(a.zotero?.page, "4"); // opaque, differs from label
	assert.equal(a.colorClass, "hltr-green");
	assert.equal(a.comment, "Method detail: \\[ W' = W + BA \\]");
	assert.equal(byId("LEGACY02").comment, undefined);
});

test("legacy without persist markers: leading prose is not glued", () => {
	const bare = note.replace(/%% (begin|end) annotations %%\n/g, "");
	const r = parseNote(bare, "n.md").annotations;
	assert.equal(r.length, 4);
	assert.ok(!r.some((a) => a.originalMarkdown.includes("Intro prose")));
});

test("duplicate ids (re-import) are disambiguated and warned", () => {
	const dup = parseNote(note + "\n" + note, "n.md");
	assert.ok(dup.warnings.some((w) => w.kind === "duplicate-id"));
	assert.equal(new Set(dup.annotations.map((a) => a.id)).size, dup.annotations.length);
});

test("malformed: unterminated block, empty header attrs don't throw", () => {
	const r = parseNote('%% ra:begin id="X" color="" %%\n<mark class="hltr-red">a</mark>\n', "n.md");
	assert.ok(r.warnings.some((w) => w.kind === "unterminated-block"));
	// salvaged by the legacy path, flagged as heuristic, never authoritative
	assert.deepEqual(r.annotations.map((a) => a.confidence), ["heuristic"]);
	const ok = parseNote('%% ra:begin id="Y" color="" type="" %%\nplain\n%% ra:end %%', "n.md");
	assert.equal(ok.annotations[0].colorClass, undefined);
});

test("math normalisation: \\( \\) and \\[ \\] → $ / $$, code untouched, \\\\( untouched", () => {
	assert.equal(normalizeMath("a \\( x \\) b"), "a $x$ b");
	assert.equal(normalizeMath("\\[ y \\]"), "\n$$\ny\n$$\n");
	assert.equal(normalizeMath("`\\(x\\)`"), "`\\(x\\)`");
	assert.equal(normalizeMath("$a$ and $$b$$"), "$a$ and $$b$$");
});

test("zotero URIs: parse, ladder, no invention", () => {
	const l = parseZoteroUri("zotero://open-pdf/library/items/BEPMNZ42?page=9&annotation=5AXG562R")!;
	const t = zoteroTargets(l);
	assert.deepEqual(t.map((x) => x.precision), ["annotation", "page", "pdf", "item"]);
	assert.equal(t[0].uri, l.raw);
	assert.equal(parseZoteroUri("https://example.com"), undefined);
	assert.equal(zoteroTargets(parseZoteroUri("zotero://open-pdf/library/items/AAAA1111")).length, 2);
});
