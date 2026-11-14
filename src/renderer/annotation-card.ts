import { App, Component, MarkdownRenderChild, MarkdownRenderer, Menu } from "obsidian";
import type { ResearchAnnotation } from "../parser/types.ts";
import type { ColorTable } from "../settings/settings.ts";
import type { NoteMeta } from "../index/note-meta.ts";
import { normalizeMath } from "./math.ts";
import { openAnnotationInNote, openZotero } from "../navigation/annotation-navigation.ts";
import { zoteroTargets } from "../navigation/zotero-uri.ts";

export interface CardContext {
	app: App;
	/** Owner of rendered children (MathJax etc.). Unload it to dispose the cards. */
	component: Component;
	colors: ColorTable;
	getMeta: (path: string) => NoteMeta;
	/** Hide the paper title (e.g. when grouped by paper). */
	showPaper?: boolean;
	showLegacyBadge?: boolean;
	onTag?: (tag: string) => void;
	onCategory?: (alias: string) => void;
}

const PRECISION_LABEL = { annotation: "annotation", page: "page only", pdf: "PDF only", item: "item only" } as const;

async function renderMd(ctx: CardContext, md: string, el: HTMLElement, sourcePath: string) {
	const child = new MarkdownRenderChild(el);
	ctx.component.addChild(child);
	// Render-only copy; originalMarkdown is untouched. sourcePath resolves links/embeds relative to the note.
	await MarkdownRenderer.render(ctx.app, normalizeMath(md), el, sourcePath, child);
}

export async function renderAnnotationCard(parent: HTMLElement, a: ResearchAnnotation, ctx: CardContext) {
	const def = a.colorClass ? ctx.colors[a.colorClass] : undefined;
	const meta = ctx.getMeta(a.sourcePath);
	const card = parent.createDiv({ cls: "ra-card", attr: { "data-ra-color": a.colorClass ?? "none" } });

	// 1 ─ paper info + semantic classification (text, not colour alone)
	const head = card.createDiv({ cls: "ra-card__head" });
	if (ctx.showPaper !== false) {
		const link = head.createEl("a", { cls: "ra-card__paper", text: meta.title, href: "#" });
		link.addEventListener("click", (e) => { e.preventDefault(); void openAnnotationInNote(ctx.app, a, e); });
	}
	if (a.pageLabel) head.createSpan({ cls: "ra-card__page", text: `p. ${a.pageLabel}` });
	if (a.colorClass) {
		const tag = head.createSpan({
			cls: "ra-card__alias" + (ctx.onCategory && def ? " is-clickable" : ""),
			attr: { title: a.colorInferred ? "Color inferred from a tag emoji" : "Filter by this category" },
		});
		tag.createSpan({ cls: "ra-swatch" });
		tag.createSpan({ text: def ? `${def.alias} · ${def.zotero}` : a.colorName ?? a.colorClass });
		if (a.colorInferred) tag.createSpan({ cls: "ra-card__muted", text: "(from tag)" });
		if (ctx.onCategory && def) tag.addEventListener("click", () => ctx.onCategory!(def.alias));
	}
	if (ctx.showPaper !== false && meta.authors.length) {
		const shown = meta.authors.slice(0, 3).join(", ") + (meta.authors.length > 3 ? " et al." : "");
		head.createDiv({ cls: "ra-card__authors", text: shown });
	}
	if (a.mode === "legacy" && ctx.showLegacyBadge)
		head.createSpan({ cls: "ra-card__flag", text: "legacy parse", attr: { title: "Boundaries inferred; add ra: markers for authoritative parsing" } });

	// 2 ─ highlight: block container, NOT an inline <mark>, so display math and paragraphs are legal
	if (a.highlight) await renderMd(ctx, a.highlight, card.createDiv({ cls: "ra-card__hl markdown-rendered" }), a.sourcePath);

	// 3 ─ images resolved through the metadata cache (independent of embed support in the renderer)
	if (a.images.length) {
		const box = card.createDiv({ cls: "ra-card__imgs" });
		for (const target of a.images) {
			const f = ctx.app.metadataCache.getFirstLinkpathDest(target, a.sourcePath);
			if (f) box.createEl("img", { attr: { src: ctx.app.vault.getResourcePath(f), alt: f.basename, loading: "lazy" } });
			else box.createDiv({ cls: "ra-card__missing", text: `Image not found: ${target}` });
		}
	}

	// 4 ─ comment
	if (a.comment) await renderMd(ctx, a.comment, card.createDiv({ cls: "ra-card__comment markdown-rendered" }), a.sourcePath);

	// 5 ─ tags + navigation
	const foot = card.createDiv({ cls: "ra-card__foot" });
	const tags = foot.createDiv({ cls: "ra-card__tags" });
	for (const t of a.tags) {
		const chip = tags.createSpan({ cls: "ra-card__tag" + (ctx.onTag ? " is-clickable" : ""), text: `#${t}` });
		if (ctx.onTag) chip.addEventListener("click", () => ctx.onTag!(t));
	}
	const nav = foot.createDiv({ cls: "ra-card__nav" });
	nav.createEl("button", { text: "Open in note" }).addEventListener("click", (e) => void openAnnotationInNote(ctx.app, a, e));
	const targets = zoteroTargets(a.zotero);
	if (targets.length) {
		const btn = nav.createEl("button", { text: `Zotero · ${PRECISION_LABEL[targets[0].precision]}` });
		btn.addEventListener("click", () => openZotero(targets[0]));
		btn.addEventListener("contextmenu", (e) => { // explicit coarser fallbacks
			const m = new Menu();
			for (const t of targets) m.addItem((i) => i.setTitle(`Open ${PRECISION_LABEL[t.precision]}`).onClick(() => openZotero(t)));
			m.showAtMouseEvent(e);
		});
	} else {
		nav.createSpan({ cls: "ra-card__muted", text: "No Zotero link" });
	}
	return card;
}
