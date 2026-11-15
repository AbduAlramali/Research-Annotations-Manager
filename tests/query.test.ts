import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnnotationIndex } from "../src/index/annotation-index.ts";
import { extractLinkTargets, parseAuthors } from "../src/index/note-meta.ts";
import type { NoteMeta } from "../src/index/note-meta.ts";
import { buildFacets, defaultQuery, pageKey, parsePages, parseSearch, runQuery } from "../src/query/annotation-query.ts";
import type { QueryState } from "../src/query/annotation-query.ts";
import { DEFAULT_COLORS, mergeSettings } from "../src/settings/settings.ts";
import { inferColorFromTags } from "../src/parser/color-infer.ts";

const sample = readFileSync(new URL("../fixtures/sample-note.md", import.meta.url), "utf8");
const userNote = readFileSync(new URL("../fixtures/user-note.md", import.meta.url), "utf8");

const P1 = { key: "03 Projects/VG-01.md", name: "VG-01" };
const P2 = { key: "03 Projects/VG-02.md", name: "VG-02" };
const metas: Record<string, NoteMeta> = {
	"a.md": { path: "a.md", title: "Alpha Paper", authors: [], projects: [P1, P2] },
	"b.md": { path: "b.md", title: "Beta Paper", authors: [], projects: [P2] },
	"c.md": { path: "c.md", title: "Gamma Paper", authors: [], projects: [] },
};
const ctx = { meta: (p: string) => metas[p], colors: DEFAULT_COLORS };

function build() {
	const idx = new AnnotationIndex();
	idx.updateNote("a.md", sample); // 4 annotations
	idx.updateNote("b.md", userNote); // 4 annotations, user's real shape
	idx.updateNote("c.md", "no annotations here");
	return idx;
}
const run = (patch: Partial<QueryState>) => runQuery(build().all(), { ...defaultQuery(), ...patch }, ctx);
const ids = (r: ReturnType<typeof run>) => r.groups.flatMap((g) => g.items.map((i) => i.a.id));

test("index: skips non-annotation notes, counts, rename, remove", () => {
	const idx = build();
	assert.equal(idx.noteCount(), 2);
	assert.equal(idx.all().length, 8);
	idx.renameNote("b.md", "b2.md");
	assert.ok(idx.all().every((i) => i.key.startsWith(i.a.sourcePath + "::")));
	assert.ok(idx.has("b2.md") && !idx.has("b.md"));
	idx.removeNote("a.md");
	assert.equal(idx.all().length, 4);
});

test("user's real note shape: 4 annotations, image annotation colour inferred from 🟡 tag", () => {
	const items = build().all().filter((i) => i.a.sourcePath === "b.md");
	assert.equal(items.length, 4);
	const img = items.find((i) => i.a.id === "QHFX86CF")!.a;
	assert.equal(img.highlight, undefined);
	assert.equal(img.colorClass, "hltr-yellow");
	assert.equal(img.colorInferred, true);
	assert.match(img.comment!, /\$\\alpha \+ 1\$/);
	assert.equal(items.find((i) => i.a.id === "5J3S4AIN")!.a.comment, "$$\\frac{1}{n}$$ is easy");
});

test("filter: every tag on an annotation is visible and filterable", () => {
	const idx = new AnnotationIndex();
	idx.updateNote("m.md", '%% ra:begin id="MULTI" color="Yellow" %%\n<mark class="hltr-yellow">multi</mark>\n**Tags:** #first #second\n%% ra:end %%');
	const mctx = { meta: () => ({ path: "m.md", title: "Multi", authors: [], projects: [] }), colors: DEFAULT_COLORS };
	assert.deepEqual(buildFacets(idx.all(), mctx).tags.map((t) => t.value).sort(), ["first", "second"]);
	assert.equal(runQuery(idx.all(), { ...defaultQuery(), tags: ["second"] }, mctx).total, 1);
});

test("colour inference: only unambiguous", () => {
	assert.equal(inferColorFromTags(["note/🔴critical"]), "hltr-red");
	assert.equal(inferColorFromTags(["note/🔴a", "note/🟡b"]), undefined);
	assert.equal(inferColorFromTags(["plain"]), undefined);
});

test("filter: category (alias), colour, combined facets are AND", () => {
	assert.deepEqual(ids(run({ categories: ["Problems"] })).sort(), ["LEGACY02", "LRYFGNJT"]);
	assert.equal(run({ colors: ["hltr-red"] }).total, 1);
	assert.equal(run({ categories: ["Problems"], papers: ["b.md"] }).total, 1);
	assert.equal(run({ categories: ["Problems", "Methods"] }).total, 3);
});

test("filter: tags (hierarchical), comment, image, pages, text", () => {
	assert.equal(run({ tags: ["note"] }).total, 4); // matches note/… in user's note only
	assert.equal(run({ tags: ["eval"] }).total, 1); // eval/refcoco
	assert.equal(run({ hasComment: "no" }).total, 2); // IMG00001, LEGACY02
	assert.equal(run({ hasImage: "yes" }).total, 3);
	assert.equal(run({ pages: "iv" }).total, 1);
	assert.equal(run({ pages: "5" }).total, 1);
	assert.equal(run({ pages: "1-1" }).total, 4);
	assert.equal(run({ text: "frac" }).total, 1);
	assert.equal(run({ text: '"important stuff" easy' }).total, 1);
	assert.equal(run({ text: "problems" }).total, 2); // alias is searchable
	assert.equal(run({ text: "beta" }).total, 4); // paper title is searchable
});

test("scope: paper and project (multi-project papers appear in each)", () => {
	assert.equal(run({ scope: { kind: "paper", path: "a.md" } }).total, 4);
	assert.equal(run({ scope: { kind: "project", key: P1.key } }).total, 4);
	assert.equal(run({ scope: { kind: "project", key: P2.key } }).total, 8);
	assert.equal(run({ scope: { kind: "project", key: P2.key }, categories: ["Problems"] }).total, 2);
});

test("group: paper / category / project with explicit ordering", () => {
	const gp = run({ group: "paper" });
	assert.deepEqual(gp.groups.map((g) => g.label), ["Alpha Paper", "Beta Paper"]);
	const idx = build();
	idx.updateNote("c.md", '%% ra:begin id="NOCOL" color="" %%\n**My comment:** x\n%% ra:end %%');
	const gc = runQuery(idx.all(), { ...defaultQuery(), group: "category" }, ctx);
	assert.equal(gc.groups[0].label, "Core ideas"); // taxonomy order, not alphabetical
	assert.equal(gc.groups.at(-1)!.label, "Uncategorized");
	const gj = run({ group: "project" });
	assert.deepEqual(gj.groups.map((g) => g.label), ["VG-01", "VG-02"]);
	assert.equal(gj.groups[1].items.length, 8); // alpha (both projects) + beta
});

test("sort: page puts roman front matter first; desc reverses", () => {
	const asc = ids(run({ sort: "page", scope: { kind: "paper", path: "a.md" } }));
	assert.equal(asc[0], "LEGACY01"); // page iv < 5 < 7
	const desc = ids(run({ sort: "page", sortDir: "desc", scope: { kind: "paper", path: "a.md" } }));
	assert.deepEqual(desc, [...asc].reverse());
	const bycat = run({ sort: "category" }).groups[0].items[0].a.colorClass;
	assert.equal(bycat, "hltr-yellow");
	assert.ok(pageKey({ pageLabel: "iv" } as any) < pageKey({ pageLabel: "1" } as any));
});

test("facets, helpers, settings merge, frontmatter shapes", () => {
	const f = buildFacets(build().all(), ctx);
	assert.deepEqual(f.papers.map((p) => p.label).sort(), ["Alpha Paper", "Beta Paper"]);
	assert.equal(f.categories.find((c) => c.label === "Problems")!.count, 2);
	assert.deepEqual(parseSearch('a "b c" D'), ["a", "b c", "d"]);
	assert.equal(parsePages("")!, null);
	assert.deepEqual(extractLinkTargets(['[[VG-01 - X]]', "[[Y|alias]]", [["Z"]], "plain"]), ["VG-01 - X", "Y", "Z", "plain"]);
	assert.deepEqual(parseAuthors("Doe, J; Roe, R and Poe, P"), ["Doe, J", "Roe, R", "Poe, P"]);
	const m = mergeSettings({ colors: { "hltr-red": { alias: "Bad" } }, scopeFolders: "x" });
	assert.equal(m.colors["hltr-red"].alias, "Bad");
	assert.equal(m.colors["hltr-red"].zotero, "Red");
	assert.equal(Object.keys(m.colors).length, 9);
	assert.deepEqual(m.scopeFolders, []);
});
