import { App, Component, FuzzySuggestModal, ItemView, Menu, Notice, WorkspaceLeaf, debounce } from "obsidian";
import type { ViewStateResult } from "obsidian";
import type RAPlugin from "../main.ts";
import { applyScope, buildFacets, defaultQuery, runQuery, UNCATEGORIZED } from "../query/annotation-query.ts";
import type { FacetOption, Group, GroupKey, QueryState, Scope, SortKey, Tri } from "../query/annotation-query.ts";
import type { IndexedAnnotation } from "../index/annotation-index.ts";
import { renderAnnotationCard } from "../renderer/annotation-card.ts";
import { toParseLabels } from "../settings/settings.ts";

export const VIEW_TYPE = "research-annotations-view";
const BATCH = 25;

class ValueModal extends FuzzySuggestModal<FacetOption> {
	constructor(app: App, private options: FacetOption[], placeholder: string, private choose: (o: FacetOption) => void) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems() { return this.options; }
	getItemText(o: FacetOption) { return `${o.label} (${o.count})`; }
	onChooseItem(o: FacetOption) { this.choose(o); }
}

type Row = { t: "group"; g: Group } | { t: "card"; ia: IndexedAnnotation };

export class AnnotationView extends ItemView {
	private q: QueryState;
	private collapsed = new Set<string>();
	private renderComp: Component | null = null;
	private rows: Row[] = [];
	private rendered = 0;
	private token = 0;
	private io: IntersectionObserver | null = null;

	private scopeEl!: HTMLElement;
	private searchEl!: HTMLInputElement;
	private controlsEl!: HTMLElement;
	private catEl!: HTMLElement;
	private tagEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: RAPlugin) {
		super(leaf);
		this.q = defaultQuery(plugin.settings.defaultSort, plugin.settings.defaultGroup);
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "Research annotations"; }
	getIcon() { return "highlighter"; }
	getQuery(): QueryState { return this.q; }

	getState() { return { ...super.getState(), query: this.q }; }
	async setState(state: any, result: ViewStateResult) {
		if (state?.query) this.q = { ...defaultQuery(this.plugin.settings.defaultSort, this.plugin.settings.defaultGroup), ...state.query };
		await super.setState(state, result);
		if (this.searchEl) this.searchEl.value = this.q.text;
		void this.refresh();
	}

	async onOpen() {
		const root = this.contentEl;
		root.empty();
		root.addClass("ra-view");
		const bar = root.createDiv({ cls: "ra-toolbar" });
		this.scopeEl = bar.createDiv({ cls: "ra-row" });
		this.searchEl = bar.createEl("input", { cls: "ra-search", attr: { type: "search", placeholder: "Search highlights, comments, tags, paper titles…" } });
		this.searchEl.value = this.q.text;
		const onSearch = debounce(() => { this.q.text = this.searchEl.value; void this.refresh(); }, 200, true);
		this.searchEl.addEventListener("input", onSearch);
		const details = bar.createEl("details", { cls: "ra-filters" });
		details.open = true;
		details.createEl("summary", { text: "Filters, sorting & grouping" });
		this.controlsEl = details.createDiv({ cls: "ra-row ra-controls" });
		this.catEl = details.createDiv({ cls: "ra-row ra-cats ra-filter-row" });
		this.tagEl = details.createDiv({ cls: "ra-row ra-tags ra-filter-row" });
		this.chipsEl = details.createDiv({ cls: "ra-row ra-chips" });
		this.statusEl = bar.createDiv({ cls: "ra-status" });
		this.listEl = root.createDiv({ cls: "ra-list" });

		const rerun = debounce(() => void this.refresh(), 250, true);
		this.registerEvent(this.plugin.events.on("index-changed", rerun));
		this.registerEvent(this.plugin.events.on("settings-changed", rerun));
		this.registerEvent(this.app.workspace.on("file-open", (f) => {
			const s = this.q.scope;
			if (f && s.kind === "paper" && s.follow && this.plugin.index.has(f.path)) {
				this.q.scope = { kind: "paper", path: f.path, follow: true };
				void this.refresh();
			}
		}));
		await this.refresh();
	}

	async onClose() {
		this.token++;
		this.io?.disconnect();
		if (this.renderComp) this.removeChild(this.renderComp);
		this.renderComp = null;
	}

	// ───────────────────────── chrome ─────────────────────────

	private changed() { void this.refresh(); }

	private setScope(s: Scope) { this.q.scope = s; this.changed(); }

	private btn(parent: HTMLElement, text: string, active: boolean, onClick: (e: MouseEvent) => void, cls = "ra-seg") {
		const b = parent.createEl("button", { cls: cls + (active ? " is-active" : ""), text });
		b.addEventListener("click", onClick);
		return b;
	}

	private select<T extends string>(parent: HTMLElement, label: string, opts: [T, string][], cur: T, on: (v: T) => void) {
		const w = parent.createDiv({ cls: "ra-ctl" });
		w.createSpan({ text: label });
		const s = w.createEl("select", { cls: "dropdown" });
		for (const [v, t] of opts) s.createEl("option", { text: t, attr: { value: v } });
		s.value = cur;
		s.addEventListener("change", () => on(s.value as T));
	}

	private renderScope(meta: (p: string) => { title: string }) {
		const s = this.q.scope, el = this.scopeEl;
		el.empty();
		this.btn(el, "All papers", s.kind === "global", () => this.setScope({ kind: "global" }));
		this.btn(el, "This paper", s.kind === "paper", () => {
			const f = this.app.workspace.getActiveFile();
			if (!f || !this.plugin.index.has(f.path)) return void new Notice("The active note has no indexed annotations.");
			this.setScope({ kind: "paper", path: f.path, follow: true });
		});
		this.btn(el, "Project…", s.kind === "project", () => {
			const opts = this.plugin.projectOptions();
			if (!opts.length) return void new Notice(`No projects found. Notes need a "${this.plugin.settings.projectsKey}" frontmatter property.`);
			new ValueModal(this.app, opts, "Choose a project", (o) => this.setScope({ kind: "project", key: o.value })).open();
		});
		if (s.kind === "paper") {
			el.createSpan({ cls: "ra-scope-label", text: meta(s.path).title });
			const lab = el.createEl("label", { cls: "ra-follow" });
			const cb = lab.createEl("input", { attr: { type: "checkbox" } });
			cb.checked = !!s.follow;
			cb.addEventListener("change", () => { s.follow = cb.checked; });
			lab.createSpan({ text: "follow active note" });
		} else if (s.kind === "project") {
			const name = this.plugin.projectOptions().find((p) => p.value === s.key)?.label ?? s.key;
			el.createSpan({ cls: "ra-scope-label", text: name });
		}
	}

	private tri(parent: HTMLElement, label: string, cur: Tri, on: (v: Tri) => void) {
		const next: Record<Tri, Tri> = { any: "yes", yes: "no", no: "any" };
		const txt = { any: "any", yes: "yes", no: "no" }[cur];
		this.btn(parent, `${label}: ${txt}`, cur !== "any", () => on(next[cur]));
	}

	private renderControls(items: IndexedAnnotation[], ctx: { meta: (p: string) => any; colors: any }) {
		const c = this.controlsEl, q = this.q;
		c.empty();
		this.select<SortKey>(c, "Sort", [["paper", "Paper → page"], ["page", "Page"], ["category", "Category"], ["note-order", "Note order"]], q.sort, (v) => { q.sort = v; this.changed(); });
		this.btn(c, q.sortDir === "asc" ? "▲" : "▼", false, () => { q.sortDir = q.sortDir === "asc" ? "desc" : "asc"; this.changed(); }, "ra-seg ra-dir");
		this.select<GroupKey>(c, "Group", [["none", "None"], ["paper", "Paper"], ["category", "Category"], ["project", "Project"]], q.group, (v) => { q.group = v; this.changed(); });
		this.tri(c, "Comment", q.hasComment, (v) => { q.hasComment = v; this.changed(); });
		this.tri(c, "Image", q.hasImage, (v) => { q.hasImage = v; this.changed(); });
		const pw = c.createDiv({ cls: "ra-ctl" });
		pw.createSpan({ text: "Pages" });
		const pi = pw.createEl("input", { cls: "ra-pages", attr: { type: "text", placeholder: "5, 3-7, iv" } });
		pi.value = q.pages;
		pi.addEventListener("change", () => { q.pages = pi.value; this.changed(); });
		this.btn(c, "+ Filter", false, (e) => {
			const f = buildFacets(applyScope(items, q.scope, ctx), ctx);
			const m = new Menu();
			const add = (title: string, opts: FacetOption[], list: keyof Pick<QueryState, "papers" | "projects" | "tags" | "colors">) =>
				m.addItem((i) => i.setTitle(title).onClick(() => {
					if (!opts.length) return void new Notice(`No ${title.toLowerCase()} in the current scope.`);
					new ValueModal(this.app, opts, title, (o) => { if (!q[list].includes(o.value)) q[list].push(o.value); this.changed(); }).open();
				}));
			add("Paper", f.papers, "papers");
			add("Project", f.projects, "projects");
			add("Tag", f.tags, "tags");
			add("Original color", f.colors, "colors");
			m.showAtMouseEvent(e);
		}, "ra-seg");
		this.btn(c, "Reset filters", false, () => {
			Object.assign(q, { text: "", categories: [], colors: [], tags: [], papers: [], projects: [], pages: "", hasComment: "any", hasImage: "any" });
			this.searchEl.value = "";
			this.changed();
		}, "ra-seg");
	}

	private renderCategories(items: IndexedAnnotation[], ctx: { meta: (p: string) => any; colors: any }) {
		const row = this.catEl, q = this.q;
		row.empty();
		const present = new Map<string, { cls?: string; n: number }>();
		for (const o of buildFacets(applyScope(items, q.scope, ctx), ctx).categories) {
			const cls = Object.keys(ctx.colors).find((c) => ctx.colors[c].alias === o.value);
			present.set(o.value, { cls, n: o.count });
		}
		const order = [...new Set(Object.values<any>(ctx.colors).map((d) => d.alias as string))];
		const names = [...order.filter((a) => present.has(a)), ...(present.has(UNCATEGORIZED) ? [UNCATEGORIZED] : [])];
		row.createSpan({ cls: "ra-filter-label", text: "Category" });
		for (const name of names) {
			const p = present.get(name)!;
			const chip = row.createEl("button", { cls: "ra-chip ra-cat" + (q.categories.includes(name) ? " is-active" : ""), attr: { "data-ra-color": p.cls ?? "none" } });
			chip.createSpan({ cls: "ra-swatch" });
			chip.createSpan({ text: `${name === UNCATEGORIZED ? "Uncategorized" : name} ${p.n}` });
			chip.addEventListener("click", () => this.toggleCategory(name));
		}
	}

	private toggleCategory(name: string) {
		const l = this.q.categories, i = l.indexOf(name);
		if (i >= 0) l.splice(i, 1); else l.push(name);
		this.changed();
	}

	private renderTags(items: IndexedAnnotation[], ctx: { meta: (p: string) => any; colors: any }) {
		const row = this.tagEl, q = this.q;
		row.empty();
		const tags = buildFacets(applyScope(items, q.scope, ctx), ctx).tags;
		// Keep an active tag in the row even if the current scope no longer has it,
		// so it can still be toggled off from here.
		for (const selected of q.tags) {
			if (!tags.some((t) => t.value === selected)) tags.push({ value: selected, label: `#${selected}`, count: 0 });
		}
		row.createSpan({ cls: "ra-filter-label", text: "Tags" });
		if (!tags.length) {
			row.createSpan({ cls: "ra-filter-empty", text: "No tags in the current scope" });
			return;
		}
		for (const t of tags) {
			const chip = row.createEl("button", {
				cls: "ra-chip ra-tag" + (q.tags.includes(t.value) ? " is-active" : ""),
				attr: { title: `Filter by #${t.value}` },
			});
			chip.createSpan({ text: `#${t.value}` });
			chip.createSpan({ cls: "ra-chip__count", text: String(t.count) });
			chip.addEventListener("click", () => this.toggleTag(t.value));
		}
	}

	private toggleTag(name: string) {
		const l = this.q.tags, i = l.indexOf(name);
		if (i >= 0) l.splice(i, 1); else l.push(name);
		this.changed();
	}

	private renderChips(meta: (p: string) => any) {
		const el = this.chipsEl, q = this.q;
		el.empty();
		const chip = (text: string, remove: () => void) => {
			const c = el.createSpan({ cls: "ra-chip ra-active-filter" });
			c.createSpan({ text });
			const x = c.createSpan({ cls: "ra-chip__x", text: "×", attr: { "aria-label": "Remove filter" } });
			x.addEventListener("click", () => { remove(); this.changed(); });
		};
		const rm = (l: string[], v: string) => () => void l.splice(l.indexOf(v), 1);
		for (const p of q.papers) chip(`Paper: ${meta(p).title}`, rm(q.papers, p));
		for (const p of q.projects) chip(`Project: ${this.plugin.projectOptions().find((o) => o.value === p)?.label ?? p}`, rm(q.projects, p));
		for (const c of q.colors) chip(`Color: ${this.plugin.settings.colors[c]?.zotero ?? "No color"}`, rm(q.colors, c));
	}

	// ───────────────────────── results ─────────────────────────

	async refresh() {
		const token = ++this.token;
		this.io?.disconnect();
		const meta = this.plugin.makeMeta();
		const ctx = { meta, colors: this.plugin.settings.colors };
		const items = this.plugin.index.all();
		const res = runQuery(items, this.q, ctx);

		this.renderScope(meta);
		this.renderControls(items, ctx);
		this.renderCategories(items, ctx);
		this.renderTags(items, ctx);
		this.renderChips(meta);
		const idx = this.plugin.scanning ? " · indexing…" : "";
		this.statusEl.setText(`${res.total} annotation${res.total === 1 ? "" : "s"} in ${res.papers} paper${res.papers === 1 ? "" : "s"}${idx}`);

		if (this.renderComp) this.removeChild(this.renderComp);
		this.renderComp = new Component();
		this.addChild(this.renderComp);
		this.listEl.empty();

		this.rows = [];
		for (const g of res.groups) {
			if (this.q.group !== "none") this.rows.push({ t: "group", g });
			if (!this.collapsed.has(g.key)) for (const ia of g.items) this.rows.push({ t: "card", ia });
		}
		this.rendered = 0;
		if (!this.rows.length) {
			this.listEl.createDiv({
				cls: "ra-empty",
				text: this.plugin.scanning ? "Indexing your vault…" : this.plugin.index.all().length ? "No annotations match the current filters." : "No annotations found. Check the folder scope in settings.",
			});
			return;
		}
		await this.renderMore(token);
	}

	private cardCtx() {
		const q = this.q;
		return {
			app: this.app,
			component: this.renderComp!,
			colors: this.plugin.settings.colors,
			getMeta: this.plugin.makeMeta(),
			showPaper: q.group !== "paper" && q.scope.kind !== "paper",
			labels: toParseLabels(this.plugin.settings),
			onTag: (t: string) => { if (!q.tags.includes(t)) { q.tags.push(t); this.changed(); } },
			onCategory: (a: string) => { if (!q.categories.includes(a)) { q.categories.push(a); this.changed(); } },
		};
	}

	private async renderMore(token: number) {
		const ctx = this.cardCtx();
		const end = Math.min(this.rendered + BATCH, this.rows.length);
		while (this.rendered < end) {
			if (token !== this.token) return;
			const row = this.rows[this.rendered++];
			if (row.t === "group") this.renderGroupHead(row.g);
			else await renderAnnotationCard(this.listEl, row.ia.a, ctx);
		}
		if (token !== this.token || this.rendered >= this.rows.length) return;
		const sentinel = this.listEl.createDiv({ cls: "ra-sentinel" });
		this.io = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			this.io?.disconnect();
			sentinel.remove();
			void this.renderMore(token);
		}, { root: this.listEl, rootMargin: "600px" });
		this.io.observe(sentinel);
	}

	private renderGroupHead(g: Group) {
		const open = !this.collapsed.has(g.key);
		const h = this.listEl.createDiv({ cls: "ra-group", attr: { "data-ra-color": g.swatch ?? "none" } });
		h.createSpan({ cls: "ra-group__chev", text: open ? "▾" : "▸" });
		if (this.q.group === "category") h.createSpan({ cls: "ra-swatch" });
		h.createSpan({ cls: "ra-group__label", text: g.label });
		h.createSpan({ cls: "ra-group__count", text: String(g.items.length) });
		h.addEventListener("click", () => {
			if (open) this.collapsed.add(g.key); else this.collapsed.delete(g.key);
			void this.refresh();
		});
	}
}
