import { App, PluginSettingTab, Setting, debounce } from "obsidian";
import type RAPlugin from "../main.ts";
import { DEFAULT_COLORS, DEFAULT_SETTINGS } from "./settings.ts";
import type { GroupKey, SortKey } from "../query/annotation-query.ts";

export class RASettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: RAPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl: el } = this;
		const p = this.plugin, s = p.settings;
		el.empty();

		const saveSoft = debounce(() => void p.saveSettings(), 400, true); // aliases etc: refresh views only
		const saveReindex = debounce(() => void p.saveSettings(true), 700, true); // changes what gets parsed

		new Setting(el).setName("Indexing").setHeading();

		new Setting(el)
			.setName("Folders to index")
			.setDesc("One folder path per line, e.g. “04 Literature Notes”. Leave empty to index the whole vault (notes without annotations are skipped automatically).")
			.addTextArea((t) => {
				t.setPlaceholder("04 Literature Notes").setValue(s.scopeFolders.join("\n"));
				t.onChange((v) => { s.scopeFolders = v.split("\n").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean); saveReindex(); });
				t.inputEl.rows = 3;
			});

		new Setting(el)
			.setName("Comment label(s)")
			.setDesc("Comma-separated labels, without the colon. Default: Comment, My comment. Bold and plain forms both match.")
			.addText((t) => t.setValue(s.commentLabels).onChange((v) => { s.commentLabels = v.trim() || DEFAULT_SETTINGS.commentLabels; saveReindex(); }));

		new Setting(el)
			.setName("Tags label(s)")
			.setDesc("Comma-separated labels, without the colon. Default: Tags, Annotation tags. All tags on the line are indexed.")
			.addText((t) => t.setValue(s.tagsLabels).onChange((v) => { s.tagsLabels = v.trim() || DEFAULT_SETTINGS.tagsLabels; saveReindex(); }));

		new Setting(el)
			.setName("Project property")
			.setDesc("Frontmatter key that lists a paper’s research projects as links, e.g. projects: [“[[VG-01 …]]”].")
			.addText((t) => t.setValue(s.projectsKey).onChange((v) => { s.projectsKey = v.trim() || "projects"; saveSoft(); }));

		new Setting(el)
			.setName("Infer color from tag emoji")
			.setDesc("For annotations without a highlight color (e.g. image annotations), use a single color emoji in their tags: 🟡 🟠 🩷 🔴 🟣 🩵 🩶 🔵 🟢. Ambiguous tags are ignored.")
			.addToggle((t) => t.setValue(s.inferColorFromTags).onChange((v) => { s.inferColorFromTags = v; saveReindex(); }));

		new Setting(el).setName("Semantic color aliases").setHeading();
		el.createEl("p", { cls: "setting-item-description", text: "What each highlight color means. Aliases are searchable and filterable." });

		for (const [cls, def] of Object.entries(s.colors)) {
			const row = new Setting(el).setName(def.zotero).setDesc(cls);
			row.nameEl.prepend(createSpan({ cls: "ra-swatch", attr: { "data-ra-color": cls } }));
			row.addText((t) => t.setValue(def.alias).onChange((v) => { def.alias = v.trim() || DEFAULT_COLORS[cls].alias; saveSoft(); }));
		}
		new Setting(el).addButton((b) =>
			b.setButtonText("Reset aliases to defaults").onClick(() => {
				for (const [cls, d] of Object.entries(DEFAULT_COLORS)) s.colors[cls].alias = d.alias;
				void p.saveSettings();
				this.display();
			}),
		);

		new Setting(el).setName("Explorer defaults").setHeading();

		new Setting(el).setName("Default sort").addDropdown((d) => {
			const o: Record<SortKey, string> = { paper: "Paper → page", page: "Page", category: "Category", "note-order": "Note order" };
			d.addOptions(o).setValue(s.defaultSort).onChange((v) => { s.defaultSort = v as SortKey; saveSoft(); });
		});
		new Setting(el).setName("Default grouping").addDropdown((d) => {
			const o: Record<GroupKey, string> = { none: "None", paper: "Paper", category: "Category", project: "Project" };
			d.addOptions(o).setValue(s.defaultGroup).onChange((v) => { s.defaultGroup = v as GroupKey; saveSoft(); });
		});

		new Setting(el).setName("Maintenance").setHeading();
		const idx = p.index;
		new Setting(el)
			.setName("Rebuild index")
			.setDesc(`${idx.all().length} annotations in ${idx.noteCount()} notes. ${idx.warnings().length} parse warning(s) (see developer console after rebuilding).`)
			.addButton((b) => b.setButtonText("Rebuild now").onClick(async () => {
				await p.rescan();
				for (const w of p.index.warnings()) console.warn("[research-annotations]", w.path, w.warning);
				this.display();
			}));
	}
}
