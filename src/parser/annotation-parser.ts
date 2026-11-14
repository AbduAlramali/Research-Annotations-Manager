import type { ParsedNote, ParseWarning, ResearchAnnotation } from "./types.ts";
import { parseZoteroUri } from "../navigation/zotero-uri.ts";
import type { ZoteroLink } from "../navigation/zotero-uri.ts";

const BEGIN = /^%%\s*ra:begin\b(.*?)%%\s*$/;
const END = /^%%\s*ra:end\s*%%\s*$/;
const ATTR = /([\w-]+)=(?:"([^"]*)"|(\S+))/g;
const PAGE_LINE = /^\[Page\s+([^\]]*)\]\((zotero:\/\/[^)\s]+)\)\s*$/;
const COMMENT_LABEL = /^\*\*My comment:\*\*[ \t]?/;
const TAGS_LINE = /^\*\*Annotation tags:\*\*\s*(.*)$/;
const MARK_WRAP = /^<mark\s+class="(hltr-[\w-]+)"\s*>([\s\S]*)<\/mark>$/;
const IMG_LINE = /^\s*(?:!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\))\s*$/;
const START_LINE = /^(<mark\s+class="hltr-|!\[\[|!\[[^\]]*\]\(|\*\*My comment:\*\*)/;

const COLOR_TO_CLASS: Record<string, string> = {
	yellow: "hltr-yellow", orange: "hltr-orange", magenta: "hltr-pink", pink: "hltr-pink",
	red: "hltr-red", purple: "hltr-purple", cyan: "hltr-cyan", gray: "hltr-grey",
	grey: "hltr-grey", blue: "hltr-blue", green: "hltr-green",
};

export function toColorClass(v?: string): string | undefined {
	const k = v?.trim().toLowerCase();
	if (!k) return undefined;
	return k.startsWith("hltr-") ? k : COLOR_TO_CLASS[k];
}

function fnv1a(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, "0");
}

function imageTarget(raw: string): string {
	return raw.split("|")[0].split("#")[0].trim();
}

interface Body {
	highlight?: string; comment?: string; images: string[]; tags: string[];
	pageLabel?: string; zotero?: ZoteroLink; htmlClass?: string;
}

/** Shared by both modes: peel page link (last), tags line, comment (from label), then image + highlight head. */
function parseBody(lines: string[]): Body {
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === "") end--;

	let pageLabel: string | undefined, zotero: ZoteroLink | undefined;
	if (end > 0) {
		const m = PAGE_LINE.exec(lines[end - 1].trim());
		if (m) { pageLabel = m[1].trim() || undefined; zotero = parseZoteroUri(m[2]); end--; }
	}

	const tags: string[] = [];
	for (let k = end - 1; k >= 0; k--) {
		const m = TAGS_LINE.exec(lines[k]);
		if (m) {
			for (const t of m[1].matchAll(/#[^\s#]+/g)) tags.push(t[0].slice(1));
			end = k;
			break;
		}
	}

	let commentIdx = -1;
	for (let k = 0; k < end; k++) if (COMMENT_LABEL.test(lines[k])) { commentIdx = k; break; }
	const headEnd = commentIdx >= 0 ? commentIdx : end;

	const images: string[] = [];
	const hl: string[] = [];
	for (let k = 0; k < headEnd; k++) {
		const m = IMG_LINE.exec(lines[k]);
		if (m) images.push(imageTarget(m[1] ?? m[2])); else hl.push(lines[k]);
	}
	let highlight = hl.join("\n").trim();
	let htmlClass: string | undefined;
	const mm = MARK_WRAP.exec(highlight);
	if (mm) { htmlClass = mm[1]; highlight = mm[2].trim(); }

	let comment: string | undefined;
	if (commentIdx >= 0) {
		const cl = lines.slice(commentIdx, end);
		cl[0] = cl[0].replace(COMMENT_LABEL, "");
		comment = cl.join("\n").trim() || undefined;
	}
	return { highlight: highlight || undefined, comment, images, tags, pageLabel, zotero, htmlClass };
}

function parseAttrs(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of s.matchAll(ATTR)) out[m[1]] = m[2] ?? m[3] ?? "";
	return out;
}

export function parseNote(text: string, sourcePath: string, persistName = "annotations"): ParsedNote {
	const lines = text.split(/\r?\n/);
	const warnings: ParseWarning[] = [];
	const found: ResearchAnnotation[] = [];
	const covered = new Array<boolean>(lines.length).fill(false);

	// ── Mode A: explicit blocks (authoritative) ──
	for (let i = 0; i < lines.length; i++) {
		const b = BEGIN.exec(lines[i]);
		if (!b) continue;
		let j = i + 1;
		while (j < lines.length && !END.test(lines[j]) && !BEGIN.test(lines[j])) j++;
		if (j >= lines.length || BEGIN.test(lines[j])) {
			warnings.push({ kind: "unterminated-block", line: i, message: "ra:begin without ra:end; block skipped" });
			continue;
		}
		const attrs = parseAttrs(b[1]);
		const body = parseBody(lines.slice(i + 1, j));
		const colorClass = toColorClass(attrs.color) ?? body.htmlClass;
		let id = attrs.id || body.zotero?.annotationKey;
		if (!id) {
			id = "h-" + fnv1a(lines.slice(i, j + 1).join("\n"));
			warnings.push({ kind: "missing-id", line: i, message: "no id in header; content hash used (unstable)" });
		}
		found.push({
			id, sourcePath, mode: "explicit", confidence: "authoritative",
			highlight: body.highlight, comment: body.comment, images: body.images, tags: body.tags,
			colorName: attrs.color || undefined, colorClass, annotationType: attrs.type || undefined,
			pageLabel: body.pageLabel, zotero: body.zotero,
			range: { startLine: i, endLine: j }, originalMarkdown: lines.slice(i, j + 1).join("\n"),
		});
		for (let k = i; k <= j; k++) covered[k] = true;
		i = j;
	}

	// ── Mode B: legacy segmentation, bounded by the persist markers when present ──
	const pb = lines.findIndex((l) => l.trim() === `%% begin ${persistName} %%`);
	const pe = lines.findIndex((l) => l.trim() === `%% end ${persistName} %%`);
	const rs = pb >= 0 && pe > pb ? pb + 1 : 0;
	const re = pb >= 0 && pe > pb ? pe : lines.length;

	let buf: number[] = [];
	const flush = (closedByPage: boolean) => {
		while (buf.length && !START_LINE.test(lines[buf[0]])) buf.shift();
		if (buf.length) {
			const seg = buf.map((n) => lines[n]);
			const body = parseBody(seg);
			let id = body.zotero?.annotationKey;
			if (!id) {
				id = "h-" + fnv1a(seg.join("\n"));
				warnings.push({ kind: "id-is-hash", line: buf[0], message: closedByPage
					? "legacy annotation without annotation key in link; hash id is unstable"
					: "legacy segment without page link; boundary is a guess" });
			}
			found.push({
				id, sourcePath, mode: "legacy", confidence: "heuristic",
				highlight: body.highlight, comment: body.comment, images: body.images, tags: body.tags,
				colorClass: body.htmlClass, pageLabel: body.pageLabel, zotero: body.zotero,
				range: { startLine: buf[0], endLine: buf[buf.length - 1] }, originalMarkdown: seg.join("\n").trim(),
			});
		}
		buf = [];
	};
	for (let i = rs; i < re; i++) {
		if (covered[i]) { flush(false); continue; }
		buf.push(i);
		if (PAGE_LINE.test(lines[i].trim())) flush(true);
	}
	flush(false);

	// ── unique ids within a note (re-import without a date filter duplicates annotations) ──
	const seen = new Map<string, number>();
	for (const a of found.sort((x, y) => x.range.startLine - y.range.startLine)) {
		const n = (seen.get(a.id) ?? 0) + 1;
		seen.set(a.id, n);
		if (n > 1) {
			warnings.push({ kind: "duplicate-id", line: a.range.startLine, message: `duplicate id ${a.id}` });
			a.id = `${a.id}~${n}`;
		}
	}
	return { annotations: found, warnings };
}
