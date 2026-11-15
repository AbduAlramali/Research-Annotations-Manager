import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNote } from "../src/parser/annotation-parser.ts";
import { normalizeMath } from "../src/renderer/math.ts";
import { parseZoteroUri, zoteroTargets } from "../src/navigation/zotero-uri.ts";

const note = readFileSync(new URL("../fixtures/sample-note.md", import.meta.url), "utf8");
const { annotations: A, warnings } = parseNote(note, "n.md");
const byId = (id: string) => A.find((a) => a.id === id)!;

test("finds 4 explicit annotations, no warnings", () => {
	assert.equal(A.length, 4);
	assert.deepEqual(A.map((a) => a.id), ["AKAGJ6KP", "IMG00001", "LEGACY01", "LEGACY02"]);
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

test("ra blocks parse without a persist wrapper; prose is not glued", () => {
	const bare = note.replace(/%% (begin|end) annotations %%\n/g, "");
	const r = parseNote(bare, "n.md").annotations;
	assert.equal(r.length, 4);
	assert.ok(!r.some((a) => a.originalMarkdown.includes("Intro prose")));
});

test("annotations outside ra blocks are ignored", () => {
	const unmarked = `%% begin annotations %%
<mark class="hltr-green">Old annotation.</mark>
**My comment:** old comment
[Page 4](zotero://open-pdf/library/items/BEPMNZ42?page=4&annotation=OLDKEY)
%% end annotations %%`;
	const r = parseNote(unmarked, "n.md");
	assert.deepEqual(r.annotations, []);
	assert.deepEqual(r.warnings, []);
});

test("Comment/Tags labels work by default", () => {
	const r = parseNote('%% ra:begin id="LABELS" color="Cyan" %%\n<mark class="hltr-cyan">x</mark>\n**Comment:** note text\n**Tags:** #one #two, #three\n%% ra:end %%', "n.md");
	assert.equal(r.annotations[0].comment, "note text");
	assert.deepEqual(r.annotations[0].tags, ["one", "two", "three"]);
});

test("custom comment/tags labels are configurable", () => {
	const text = '%% ra:begin id="CUSTOM" color="Cyan" %%\n<mark class="hltr-cyan">x</mark>\n**Note:** custom text\n**Labels:** #alpha #beta\n%% ra:end %%';
	const r = parseNote(text, "n.md", { commentLabels: ["Note"], tagsLabels: ["Labels"] });
	assert.equal(r.annotations[0].comment, "custom text");
	assert.deepEqual(r.annotations[0].tags, ["alpha", "beta"]);
});

test("duplicate ids (re-import) are disambiguated and warned", () => {
	const dup = parseNote(note + "\n" + note, "n.md");
	assert.ok(dup.warnings.some((w) => w.kind === "duplicate-id"));
	assert.equal(new Set(dup.annotations.map((a) => a.id)).size, dup.annotations.length);
});

test("malformed: unterminated block, empty header attrs don't throw", () => {
	const r = parseNote('%% ra:begin id="X" color="" %%\n<mark class="hltr-red">a</mark>\n', "n.md");
	assert.ok(r.warnings.some((w) => w.kind === "unterminated-block"));
	assert.deepEqual(r.annotations, []);
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
