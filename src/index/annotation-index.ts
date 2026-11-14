import { parseNote } from "../parser/annotation-parser.ts";
import { inferColorFromTags } from "../parser/color-infer.ts";
import type { ParseWarning, ResearchAnnotation } from "../parser/types.ts";

export interface IndexedAnnotation {
	/** `${path}::${id}` – unique across the vault. */
	key: string;
	a: ResearchAnnotation;
	/** Lower-cased search text. Derived, memory-only; never written to the vault or to disk. */
	search: string;
	/** Position within its note. */
	order: number;
}
export interface NoteEntry { path: string; items: IndexedAnnotation[]; warnings: ParseWarning[] }
export interface IndexConfig { persistName: string; inferColor: boolean }

const CANDIDATE = /zotero:\/\/|%%\s*ra:begin/;

/**
 * Per-note incremental index. The vault file stays the source of truth: only a changed note is re-parsed,
 * and a note with no annotations is not stored at all.
 */
export class AnnotationIndex {
	config: IndexConfig = { persistName: "annotations", inferColor: true };
	private notes = new Map<string, NoteEntry>();
	private flat: IndexedAnnotation[] | null = null;

	/** Returns the number of annotations now indexed for this note. */
	updateNote(path: string, text: string): number {
		if (!CANDIDATE.test(text)) { this.removeNote(path); return 0; }
		const parsed = parseNote(text, path, this.config.persistName);
		if (!parsed.annotations.length) { this.removeNote(path); return 0; }
		const items = parsed.annotations.map((a, order): IndexedAnnotation => {
			if (!a.colorClass && this.config.inferColor) {
				const c = inferColorFromTags(a.tags);
				if (c) { a.colorClass = c; a.colorInferred = true; }
			}
			return {
				key: `${path}::${a.id}`, a, order,
				search: [a.highlight ?? "", a.comment ?? "", a.tags.join(" ")].join("\n").toLowerCase(),
			};
		});
		this.notes.set(path, { path, items, warnings: parsed.warnings });
		this.flat = null;
		return items.length;
	}
	removeNote(path: string) { if (this.notes.delete(path)) this.flat = null; }
	renameNote(from: string, to: string) {
		const e = this.notes.get(from);
		if (!e) return;
		this.notes.delete(from);
		e.path = to;
		for (const it of e.items) { it.a.sourcePath = to; it.key = `${to}::${it.a.id}`; }
		this.notes.set(to, e);
		this.flat = null;
	}
	clear() { this.notes.clear(); this.flat = null; }
	has(path: string) { return this.notes.has(path); }
	notePaths(): string[] { return [...this.notes.keys()]; }
	noteCount() { return this.notes.size; }
	warnings(): { path: string; warning: ParseWarning }[] {
		return [...this.notes.values()].flatMap((n) => n.warnings.map((warning) => ({ path: n.path, warning })));
	}
	all(): IndexedAnnotation[] {
		return (this.flat ??= [...this.notes.values()].flatMap((n) => n.items));
	}
}
