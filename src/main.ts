import { Events, FuzzySuggestModal, Notice, Plugin, TFile, TFolder, debounce } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { AnnotationIndex } from "./index/annotation-index.ts";
import { extractLinkTargets, parseAuthors } from "./index/note-meta.ts";
import type { NoteMeta } from "./index/note-meta.ts";
import { defaultQuery } from "./query/annotation-query.ts";
import type { FacetOption, QueryState } from "./query/annotation-query.ts";
import { DEFAULT_SETTINGS, mergeSettings, toParseLabels } from "./settings/settings.ts";
import type { RASettings } from "./settings/settings.ts";
import { RASettingTab } from "./settings/settings-tab.ts";
import { AnnotationView, VIEW_TYPE } from "./views/annotation-view.ts";

class PickModal extends FuzzySuggestModal<FacetOption> {
	constructor(app: App, private opts: FacetOption[], ph: string, private choose: (o: FacetOption) => void) {
		super(app);
		this.setPlaceholder(ph);
	}
	getItems() { return this.opts; }
	getItemText(o: FacetOption) { return `${o.label} (${o.count})`; }
	onChooseItem(o: FacetOption) { this.choose(o); }
}

export default class RAPlugin extends Plugin {
	settings: RASettings = structuredClone(DEFAULT_SETTINGS);
	index = new AnnotationIndex();
	events = new Events();
	scanning = false;
	private scanToken = 0;
	private notify = debounce(() => this.events.trigger("index-changed"), 250, true);

	async onload() {
		this.settings = mergeSettings(await this.loadData());
		this.applyIndexConfig();

		this.registerView(VIEW_TYPE, (leaf) => new AnnotationView(leaf, this));
		this.addRibbonIcon("highlighter", "Research annotations", () => void this.activateView());
		this.addSettingTab(new RASettingTab(this.app, this));

		this.addCommand({ id: "open-explorer", name: "Open annotation explorer (all papers)", callback: () => void this.activateView({ scope: { kind: "global" } }) });
		this.addCommand({ id: "open-current-paper", name: "Open annotations for current paper", callback: () => void this.openCurrentPaper() });
		this.addCommand({ id: "open-current-project", name: "Open annotations for current project", callback: () => void this.openCurrentProject() });
		this.addCommand({ id: "rebuild-index", name: "Rebuild annotation index", callback: () => void this.rescan() });

		// Incremental updates: only the changed note is re-parsed.
		this.registerEvent(this.app.metadataCache.on("changed", (file, data) => {
			if (file.extension !== "md" || !this.inScope(file.path)) return;
			this.index.updateNote(file.path, data);
			this.notify();
		}));
		this.registerEvent(this.app.vault.on("delete", (f) => {
			if (f instanceof TFile) { this.index.removeNote(f.path); this.notify(); }
			else if (f instanceof TFolder) void this.rescanSoon();
		}));
		this.registerEvent(this.app.vault.on("rename", (f, old) => {
			if (f instanceof TFile) {
				if (this.index.has(old)) this.index.renameNote(old, f.path);
				this.notify();
			} else void this.rescanSoon();
		}));
		// Project links/titles live in frontmatter, resolved lazily at query time – just refresh views.
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.notify()));

		this.app.workspace.onLayoutReady(() => void this.rescan());
	}

	onunload() {
		this.scanToken++;
	}

	private rescanSoon = debounce(() => void this.rescan(), 600, true);

	// ───────────── settings / index plumbing ─────────────

	private applyIndexConfig() {
		this.index.config = { inferColor: this.settings.inferColorFromTags, labels: toParseLabels(this.settings) };
	}

	async saveSettings(reindex = false) {
		await this.saveData(this.settings);
		if (reindex) await this.rescan();
		this.events.trigger("settings-changed");
	}

	inScope(path: string): boolean {
		const f = this.settings.scopeFolders;
		return !f.length || f.some((p) => path === p || path.startsWith(p + "/"));
	}

	async rescan() {
		const token = ++this.scanToken;
		this.scanning = true;
		this.applyIndexConfig();
		this.index.clear();
		this.notify();
		const files = this.app.vault.getMarkdownFiles().filter((f) => this.inScope(f.path));
		for (let i = 0; i < files.length; i++) {
			if (token !== this.scanToken) return;
			this.index.updateNote(files[i].path, await this.app.vault.cachedRead(files[i]));
			if (i % 50 === 49) { this.notify(); await new Promise((r) => setTimeout(r, 0)); }
		}
		if (token === this.scanToken) { this.scanning = false; this.notify(); }
	}

	// ───────────── note metadata (resolved at query time, so never stale) ─────────────

	makeMeta(): (path: string) => NoteMeta {
		const cache = new Map<string, NoteMeta>();
		return (path) => {
			let m = cache.get(path);
			if (!m) cache.set(path, (m = this.buildMeta(path)));
			return m;
		};
	}

	private buildMeta(path: string): NoteMeta {
		const f = this.app.vault.getFileByPath(path);
		const fm = f ? this.app.metadataCache.getFileCache(f)?.frontmatter : undefined;
		const t = fm?.title;
		const projects = extractLinkTargets(fm?.[this.settings.projectsKey]).map((link) => {
			const dest = this.app.metadataCache.getFirstLinkpathDest(link, path);
			return dest ? { key: dest.path, name: dest.basename } : { key: "link:" + link.toLowerCase(), name: link };
		});
		return {
			path,
			title: typeof t === "string" && t.trim() ? t.trim() : f?.basename ?? path,
			authors: parseAuthors(fm?.authors ?? fm?.author),
			projects,
		};
	}

	projectOptions(): FacetOption[] {
		const meta = this.makeMeta();
		const m = new Map<string, FacetOption>();
		for (const path of this.index.notePaths())
			for (const p of meta(path).projects) {
				const o = m.get(p.key);
				if (o) o.count++; else m.set(p.key, { value: p.key, label: p.name, count: 1 });
			}
		return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
	}

	// ───────────── view + commands ─────────────

	async activateView(patch?: Partial<QueryState>) {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		const cur = leaf?.view instanceof AnnotationView ? leaf.view.getQuery() : defaultQuery(this.settings.defaultSort, this.settings.defaultGroup);
		const query = { ...cur, ...(patch ?? {}) };
		if (!leaf) leaf = workspace.getRightLeaf(false);
		if (!leaf) return void new Notice("Could not open a sidebar pane.");
		await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { query } });
		void workspace.revealLeaf(leaf);
	}

	private async openCurrentPaper() {
		const f = this.app.workspace.getActiveFile();
		if (!f) return void new Notice("Open a literature note first.");
		if (!this.index.has(f.path)) return void new Notice(this.scanning ? "Still indexing – try again in a moment." : "No annotations found in this note.");
		await this.activateView({ scope: { kind: "paper", path: f.path, follow: true } });
	}

	private async openCurrentProject() {
		const f = this.app.workspace.getActiveFile();
		if (!f) return void new Notice("Open a project note or a literature note first.");
		const all = this.projectOptions();
		const open = (key: string) => this.activateView({ scope: { kind: "project", key } });
		if (all.some((p) => p.value === f.path)) return void (await open(f.path)); // the active note IS a project
		const own = this.makeMeta()(f.path).projects; // the active note belongs to project(s)
		if (own.length === 1) return void (await open(own[0].key));
		if (own.length > 1) {
			const opts = own.map((p) => all.find((o) => o.value === p.key) ?? { value: p.key, label: p.name, count: 0 });
			return void new PickModal(this.app, opts, "Which project?", (o) => void open(o.value)).open();
		}
		new Notice(`No project found for this note. Project notes are detected through the "${this.settings.projectsKey}" property of literature notes.`);
	}
}
