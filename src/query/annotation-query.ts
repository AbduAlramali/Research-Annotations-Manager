import type { IndexedAnnotation } from "../index/annotation-index.ts";
import type { NoteMeta } from "../index/note-meta.ts";
import type { ResearchAnnotation } from "../parser/types.ts";
import type { ColorTable } from "../settings/settings.ts";

export type SortKey = "paper" | "page" | "category" | "note-order";
export type GroupKey = "none" | "paper" | "category" | "project";
export type Tri = "any" | "yes" | "no";
export type Scope =
	| { kind: "global" }
	| { kind: "paper"; path: string; follow?: boolean }
	| { kind: "project"; key: string };

export const UNCATEGORIZED = "__none__";

export interface QueryState {
	scope: Scope;
	text: string;
	/** Semantic aliases (the configurable meaning). OR within the facet. */
	categories: string[];
	/** Highlight colour classes (the original colour). OR within the facet. */
	colors: string[];
	/** Tags; "note" also matches "note/x". OR within the facet. */
	tags: string[];
	papers: string[];
	projects: string[];
	/** "5", "3-7", "iv", comma separated. */
	pages: string;
	hasComment: Tri;
	hasImage: Tri;
	sort: SortKey;
	sortDir: "asc" | "desc";
	group: GroupKey;
}

export function defaultQuery(sort: SortKey = "paper", group: GroupKey = "none"): QueryState {
	return {
		scope: { kind: "global" }, text: "", categories: [], colors: [], tags: [], papers: [], projects: [],
		pages: "", hasComment: "any", hasImage: "any", sort, sortDir: "asc", group,
	};
}

export interface QueryCtx { meta: (path: string) => NoteMeta; colors: ColorTable }
export interface Group { key: string; label: string; swatch?: string; items: IndexedAnnotation[] }
export interface QueryResult { groups: Group[]; total: number; papers: number }

export function parseSearch(s: string): string[] {
	const out: string[] = [];
	for (const m of s.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) out.push((m[1] ?? m[2]).trim());
	return out.filter(Boolean);
}

export function parsePages(s: string): ((a: ResearchAnnotation) => boolean) | null {
	const toks = s.split(/[,;\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
	if (!toks.length) return null;
	const tests = toks.map((t): ((label: string) => boolean) => {
		const r = /^(\d+)-(\d+)$/.exec(t);
		if (r) {
			const lo = Math.min(+r[1], +r[2]), hi = Math.max(+r[1], +r[2]);
			return (l) => /^\d+$/.test(l) && +l >= lo && +l <= hi;
		}
		return (l) => l === t;
	});
	return (a) => {
		const l = a.pageLabel?.trim().toLowerCase();
		return !!l && tests.some((t) => t(l));
	};
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanValue(s: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const v = ROMAN[s[i]], nx = ROMAN[s[i + 1]] ?? 0;
		n += v < nx ? -v : v;
	}
	return n;
}
/** Front matter (roman numerals) sorts before page 1; unknown pages last. */
export function pageKey(a: ResearchAnnotation): number {
	const l = a.pageLabel?.trim().toLowerCase();
	if (l && /^\d+$/.test(l)) return +l;
	if (l && /^[ivxlcdm]+$/.test(l)) return -10000 + romanValue(l);
	const p = a.zotero?.page;
	if (p && /^\d+$/.test(p)) return +p;
	return Infinity;
}

function tagMatches(tags: string[], wanted: string[]): boolean {
	return wanted.some((w) => tags.some((t) => t === w || t.startsWith(w + "/")));
}

export function categoryOf(a: ResearchAnnotation, colors: ColorTable): string {
	return (a.colorClass && colors[a.colorClass]?.alias) || UNCATEGORIZED;
}

export function applyScope(items: IndexedAnnotation[], scope: Scope, ctx: QueryCtx): IndexedAnnotation[] {
	if (scope.kind === "paper") { const p = scope.path; return items.filter((i) => i.a.sourcePath === p); }
	if (scope.kind === "project") { const k = scope.key; return items.filter((i) => ctx.meta(i.a.sourcePath).projects.some((p) => p.key === k)); }
	return items;
}

export function runQuery(all: IndexedAnnotation[], q: QueryState, ctx: QueryCtx): QueryResult {
	const order = Object.keys(ctx.colors);
	const terms = parseSearch(q.text);
	const pageTest = parsePages(q.pages);
	const cats = new Set(q.categories), cols = new Set(q.colors);
	const papers = new Set(q.papers), projs = new Set(q.projects);

	const items = applyScope(all, q.scope, ctx).filter((ia) => {
		const a = ia.a, meta = ctx.meta(a.sourcePath), cat = categoryOf(a, ctx.colors);
		if (cats.size && !cats.has(cat)) return false;
		if (cols.size && !cols.has(a.colorClass ?? UNCATEGORIZED)) return false;
		if (q.tags.length && !tagMatches(a.tags, q.tags)) return false;
		if (papers.size && !papers.has(a.sourcePath)) return false;
		if (projs.size && !meta.projects.some((p) => projs.has(p.key))) return false;
		if (pageTest && !pageTest(a)) return false;
		if (q.hasComment !== "any" && !!a.comment !== (q.hasComment === "yes")) return false;
		if (q.hasImage !== "any" && a.images.length > 0 !== (q.hasImage === "yes")) return false;
		if (terms.length) {
			const hay = `${ia.search}\n${cat === UNCATEGORIZED ? "" : cat.toLowerCase()}\n${meta.title.toLowerCase()}`;
			if (!terms.every((t) => hay.includes(t))) return false;
		}
		return true;
	});

	const title = (x: IndexedAnnotation) => ctx.meta(x.a.sourcePath).title;
	const byPaper = (x: IndexedAnnotation, y: IndexedAnnotation) =>
		title(x).localeCompare(title(y), undefined, { numeric: true, sensitivity: "base" }) ||
		x.a.sourcePath.localeCompare(y.a.sourcePath);
	const catIdx = (x: IndexedAnnotation) => {
		const i = x.a.colorClass ? order.indexOf(x.a.colorClass) : -1;
		return i < 0 ? 999 : i;
	};
	const byPage = (x: IndexedAnnotation, y: IndexedAnnotation) => {
		const d = pageKey(x.a) - pageKey(y.a);
		return Number.isNaN(d) ? 0 : d; // Infinity - Infinity
	};
	const cmps: Record<SortKey, (x: IndexedAnnotation, y: IndexedAnnotation) => number> = {
		paper: (x, y) => byPaper(x, y) || byPage(x, y) || x.order - y.order,
		"note-order": (x, y) => byPaper(x, y) || x.order - y.order,
		page: (x, y) => byPage(x, y) || byPaper(x, y) || x.order - y.order,
		category: (x, y) => catIdx(x) - catIdx(y) || byPaper(x, y) || byPage(x, y) || x.order - y.order,
	};
	const dir = q.sortDir === "desc" ? -1 : 1;
	const cmp = (x: IndexedAnnotation, y: IndexedAnnotation) => dir * cmps[q.sort](x, y);
	items.sort(cmp);

	const paperCount = new Set(items.map((i) => i.a.sourcePath)).size;
	if (q.group === "none") {
		return { groups: items.length ? [{ key: "all", label: "", items }] : [], total: items.length, papers: paperCount };
	}

	const groups = new Map<string, Group & { rank: number }>();
	const add = (key: string, label: string, rank: number, it: IndexedAnnotation, swatch?: string) => {
		let g = groups.get(key);
		if (!g) groups.set(key, (g = { key, label, rank, swatch, items: [] }));
		g.items.push(it);
	};
	for (const it of items) {
		if (q.group === "paper") add(it.a.sourcePath, title(it), 0, it);
		else if (q.group === "category") {
			const cat = categoryOf(it.a, ctx.colors);
			add(cat, cat === UNCATEGORIZED ? "Uncategorized" : cat, cat === UNCATEGORIZED ? 999 : order.findIndex((c) => ctx.colors[c]?.alias === cat), it, it.a.colorClass);
		} else {
			const ps = ctx.meta(it.a.sourcePath).projects;
			if (!ps.length) add("__noproject__", "No project", 999, it);
			for (const p of ps) add(p.key, p.name, 0, it);
		}
	}
	const list = [...groups.values()].sort(
		(x, y) => x.rank - y.rank || x.label.localeCompare(y.label, undefined, { numeric: true, sensitivity: "base" }),
	);
	if (dir < 0 && (q.sort === q.group || (q.sort === "category" && q.group === "category"))) list.reverse();
	return { groups: list, total: items.length, papers: paperCount };
}

export interface FacetOption { value: string; label: string; count: number }
export interface Facets { papers: FacetOption[]; projects: FacetOption[]; tags: FacetOption[]; colors: FacetOption[]; categories: FacetOption[] }

/** Option lists for the "add filter" pickers, counted over the already-scoped items. */
export function buildFacets(items: IndexedAnnotation[], ctx: QueryCtx): Facets {
	const maps = { papers: new Map<string, FacetOption>(), projects: new Map<string, FacetOption>(), tags: new Map<string, FacetOption>(), colors: new Map<string, FacetOption>(), categories: new Map<string, FacetOption>() };
	const bump = (m: Map<string, FacetOption>, value: string, label: string) => {
		const o = m.get(value);
		if (o) o.count++; else m.set(value, { value, label, count: 1 });
	};
	for (const { a } of items) {
		const meta = ctx.meta(a.sourcePath);
		bump(maps.papers, a.sourcePath, meta.title);
		for (const p of meta.projects) bump(maps.projects, p.key, p.name);
		for (const t of a.tags) bump(maps.tags, t, `#${t}`);
		const def = a.colorClass ? ctx.colors[a.colorClass] : undefined;
		bump(maps.colors, a.colorClass ?? UNCATEGORIZED, def ? `${def.zotero}` : "No color");
		bump(maps.categories, categoryOf(a, ctx.colors), categoryOf(a, ctx.colors) === UNCATEGORIZED ? "Uncategorized" : categoryOf(a, ctx.colors));
	}
	const sorted = (m: Map<string, FacetOption>) => [...m.values()].sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
	return { papers: sorted(maps.papers), projects: sorted(maps.projects), tags: sorted(maps.tags), colors: sorted(maps.colors), categories: sorted(maps.categories) };
}
