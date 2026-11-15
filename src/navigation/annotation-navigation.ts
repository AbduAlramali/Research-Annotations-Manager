import { App, Keymap, MarkdownView, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { parseNote } from "../parser/annotation-parser.ts";
import { DEFAULT_PARSE_LABELS } from "../parser/types.ts";
import type { ParseLabels } from "../parser/types.ts";
import type { ResearchAnnotation } from "../parser/types.ts";
import { zoteroTargets } from "./zotero-uri.ts";
import type { ZoteroTarget } from "./zotero-uri.ts";

/**
 * Navigation by STABLE ID, line resolved at click time:
 * re-read the note, re-parse, find the annotation by id, jump to its CURRENT line.
 * Cached line numbers are never trusted (notes change between indexing and clicking).
 */
export async function openAnnotationInNote(app: App, a: ResearchAnnotation, evt?: MouseEvent | KeyboardEvent, labels: ParseLabels = DEFAULT_PARSE_LABELS) {
	clearReadingHighlight();
	const file = app.vault.getAbstractFileByPath(a.sourcePath);
	if (!(file instanceof TFile)) return;
	const fresh = parseNote(await app.vault.cachedRead(file), a.sourcePath, labels).annotations.find((x) => x.id === a.id);
	const startLine = fresh?.range.startLine ?? 0; // fall back to top of note if the annotation vanished
	const endLine = fresh?.range.endLine ?? startLine;
	const leaf = app.workspace.getLeaf(evt ? Keymap.isModEvent(evt) : false);
	const token = ++navigationToken;
	// eState.line is accepted by openFile but is not documented in the public typings.
	await leaf.openFile(file, { eState: { line: startLine } });
	await scrollToLine(leaf, file, startLine, endLine, token);
}

export function bestZoteroTarget(a: ResearchAnnotation): ZoteroTarget | undefined {
	return zoteroTargets(a.zotero)[0];
}

/** zotero:// is handed to the OS; on mobile (no Zotero app) nothing may happen – the UI says what it targets. */
export function openZotero(t: ZoteroTarget) {
	window.open(t.uri);
}

// ───────────────────────── line reveal ─────────────────────────

/**
 * openFile's ephemeral line is consumed too early: the target has not been
 * measured yet, and images/MathJax in a long note keep shifting it while the
 * preview renders progressively. Re-apply the line for a short settling window.
 * Applying the same target repeatedly is idempotent; retries stop on user input,
 * a newer navigation, or when the leaf shows a different note.
 */
const RETRY_AT_MS = [0, 50, 150, 300, 600, 1000, 1500, 2000] as const;
let navigationToken = 0;
let readingHighlightEls: HTMLElement[] = [];

function clearReadingHighlight() {
	for (const el of readingHighlightEls) el.removeClass("ra-note-target");
	readingHighlightEls = [];
}

async function scrollToLine(leaf: WorkspaceLeaf, file: TFile, startLine: number, endLine: number, token: number) {
	const view = await waitForMarkdownView(leaf, file, token);
	if (!view) return;

	let cancelled = false;
	const cancel = () => { cancelled = true; };
	const scroller = scrollContainer(view);
	const targets = scroller && scroller !== view.containerEl ? [scroller, view.containerEl] : [view.containerEl];
	for (const el of targets) {
		el.addEventListener("wheel", cancel, { passive: true });
		el.addEventListener("touchstart", cancel, { passive: true });
		el.addEventListener("pointerdown", cancel, { passive: true });
	}
	view.containerEl.addEventListener("keydown", cancel);

	try {
		let elapsed = 0;
		for (const at of RETRY_AT_MS) {
			if (at > elapsed) {
				await sleep(at - elapsed);
				elapsed = at;
			}
			if (cancelled || !isCurrentTarget(leaf, view, file, token)) return;
			// Unconditional re-apply: CodeMirror's visibleRanges (and partially
			// rendered preview sections) can report the line as visible before the
			// scroll offset has actually been applied. Re-applying is a no-op when
			// the target is already in place.
			applyScroll(view, startLine, endLine);
		}
	} finally {
		for (const el of targets) {
			el.removeEventListener("wheel", cancel);
			el.removeEventListener("touchstart", cancel);
			el.removeEventListener("pointerdown", cancel);
		}
		view.containerEl.removeEventListener("keydown", cancel);
	}
}

/** openFile can briefly leave a DeferredView in the leaf; wait for the real view. */
async function waitForMarkdownView(leaf: WorkspaceLeaf, file: TFile, token: number): Promise<MarkdownView | undefined> {
	const deadline = Date.now() + 1000;
	while (token === navigationToken && Date.now() < deadline) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) return view;
		if (view instanceof MarkdownView && !view.file) return view;
		await nextFrame();
	}
	return undefined;
}

function isCurrentTarget(leaf: WorkspaceLeaf, view: MarkdownView, file: TFile, token: number): boolean {
	if (token !== navigationToken || leaf.view !== view) return false;
	return view.file?.path === file.path && view.containerEl.isConnected;
}

function applyScroll(view: MarkdownView, startLine: number, endLine: number): void {
	if (view.getMode() === "preview") {
		applyReadingScroll(view, startLine, endLine);
		return;
	}
	// Source and Live Preview share the editor. Select the whole ra block so the
	// hidden %% ra:begin … ra:end %% markers are revealed as one range.
	const from = { line: startLine, ch: 0 };
	const to = { line: endLine, ch: view.editor.getLine(endLine)?.length ?? 0 };
	try {
		view.editor.setSelection(from, to);
	} catch {
		/* editor may be between modes; the next retry will try again */
	}
	try {
		view.editor.scrollIntoView({ from, to }, true);
	} catch {
		/* view not measured yet; the next retry will try again */
	}
}

function applyReadingScroll(view: MarkdownView, startLine: number, endLine: number): void {
	const renderer = previewRenderer(view);
	// The ra:begin line is a hidden comment. Target the first rendered section in
	// the block so the visible highlight/comment/tags are what gets centered.
	const line = firstVisibleLine(view, startLine, endLine) ?? startLine;
	let applied = false;

	// Reading mode positions by line via its renderer. `center` is the same option
	// Obsidian uses for search matches; guard it because the method is not in the
	// public typings. It returns false while earlier sections are still unmeasured.
	if (renderer && typeof renderer.applyScroll === "function") {
		try {
			renderer.applyScroll(line, { center: true });
			applied = true;
		} catch {
			/* fall through to the public API */
		}
	}

	if (!applied) {
		// Public API: sets the line after rendering (and flashes the target).
		try {
			view.setEphemeralState({ line });
		} catch {
			/* ignore version differences */
		}
		// Line-based in reading mode, but not in the public typings.
		try {
			const mode = view.currentMode as unknown as { applyScroll?: (line: number) => void };
			if (typeof mode.applyScroll === "function") mode.applyScroll.call(mode, line);
		} catch {
			/* fall back to the rendered section below */
		}
	}

	// If virtual rendering has not produced the section yet, this is a no-op and
	// the next retry handles it. When it has, it guarantees the target is on screen.
	if (!readingLineIsVisible(view, line)) scrollReadingSection(view, line);
	// Highlight the rendered sections belonging to the annotation block. The
	// ra: markers themselves are hidden comments, so highlight the visible parts.
	highlightReadingRange(view, startLine, endLine);
}

interface PreviewSectionLike {
	start?: { line?: number };
	lines?: number;
	el?: HTMLElement;
}

interface PreviewRendererLike {
	previewEl?: HTMLElement;
	sections?: PreviewSectionLike[];
	applyScroll?: (line: number, opts?: { center?: boolean; highlight?: boolean }) => boolean;
}

function previewRenderer(view: MarkdownView): PreviewRendererLike | undefined {
	const mode = view.currentMode as unknown as { renderer?: PreviewRendererLike };
	return mode.renderer;
}

function previewParts(view: MarkdownView): { previewEl?: HTMLElement; sections?: PreviewSectionLike[] } {
	const renderer = previewRenderer(view);
	const previewEl = renderer?.previewEl ?? view.contentEl.querySelector<HTMLElement>(".markdown-preview-view") ?? undefined;
	return { previewEl, sections: renderer?.sections };
}

function firstVisibleLine(view: MarkdownView, startLine: number, endLine: number): number | undefined {
	const { sections } = previewParts(view);
	if (!sections?.length) return undefined;
	for (const section of sections) {
		const start = section.start?.line;
		if (typeof start !== "number") continue;
		const lines = Math.max(1, section.lines ?? 1);
		if (start > endLine || start + lines <= startLine) continue;
		const el = section.el;
		if (el?.isConnected && el.getBoundingClientRect().height > 0) return Math.max(start, startLine);
	}
	return undefined;
}

function highlightReadingRange(view: MarkdownView, startLine: number, endLine: number): void {
	const { sections } = previewParts(view);
	if (!sections?.length) return;

	const els: HTMLElement[] = [];
	for (const section of sections) {
		const start = section.start?.line;
		if (typeof start !== "number") continue;
		const lines = Math.max(1, section.lines ?? 1);
		if (start > endLine || start + lines <= startLine) continue;
		const el = section.el;
		if (el?.isConnected && el.getBoundingClientRect().height > 0) els.push(el);
	}
	if (!els.length) return;

	const same = els.length === readingHighlightEls.length && els.every((el, i) => el === readingHighlightEls[i]);
	if (same) return;
	clearReadingHighlight();
	for (const el of els) el.addClass("ra-note-target");
	readingHighlightEls = els;
}

function readingLineIsVisible(view: MarkdownView, line: number): boolean {
	const { previewEl, sections } = previewParts(view);
	if (!previewEl || !sections?.length) return false;
	const section = findSection(sections, line);
	const el = section?.el;
	if (!el?.isConnected) return false;

	const r = el.getBoundingClientRect();
	const p = previewEl.getBoundingClientRect();
	if (r.height <= 0 || r.bottom <= p.top || r.top >= p.bottom) return false;

	// Approximate the target line inside its section; a section can be taller than
	// the viewport. This is only used for the DOM fallback, not to skip retries.
	const start = section?.start?.line;
	const lines = section?.lines ?? 0;
	if (typeof start === "number" && lines > 0) {
		const frac = Math.min(1, Math.max(0, (line - start + 0.5) / lines));
		const y = r.top + r.height * frac;
		const margin = Math.min(48, Math.max(12, p.height * 0.08));
		return y >= p.top + margin && y <= p.bottom - margin;
	}
	return true;
}

/** DOM fallback when the renderer's line scroll is unavailable or not yet effective. */
function scrollReadingSection(view: MarkdownView, line: number): void {
	const { previewEl, sections } = previewParts(view);
	if (!previewEl || !sections?.length) return;
	const section = findSection(sections, line);
	const el = section?.el;
	if (!el?.isConnected) return;

	const r = el.getBoundingClientRect();
	const p = previewEl.getBoundingClientRect();
	const start = section?.start?.line;
	const lines = section?.lines ?? 0;
	const frac = typeof start === "number" && lines > 0 ? Math.min(1, Math.max(0, (line - start + 0.5) / lines)) : 0.5;
	const lineTop = r.top + r.height * frac;
	const top = previewEl.scrollTop + (lineTop - p.top);
	const centered = top - previewEl.clientHeight / 2;
	previewEl.scrollTop = Math.max(0, centered);
}

function findSection(sections: PreviewSectionLike[], line: number): PreviewSectionLike | undefined {
	let last: PreviewSectionLike | undefined;
	for (const s of sections) {
		const start = s.start?.line;
		if (typeof start !== "number" || start > line) continue;
		last = s;
		if (line < start + Math.max(1, s.lines ?? 1)) return s;
	}
	return last;
}

function scrollContainer(view: MarkdownView): HTMLElement | undefined {
	if (view.getMode() === "preview") return previewParts(view).previewEl;
	try {
		return (view.editor as unknown as { cm?: { scrollDOM?: HTMLElement } }).cm?.scrollDOM;
	} catch {
		return undefined;
	}
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
