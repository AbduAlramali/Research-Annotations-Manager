import { DEFAULT_PARSE_LABELS } from "./types.ts";
import type { ParsedNote, ParseLabels, ParseWarning, ResearchAnnotation } from "./types.ts";
import { parseZoteroUri } from "../navigation/zotero-uri.ts";
import type { ZoteroLink } from "../navigation/zotero-uri.ts";

const BEGIN = /^%%\s*ra:begin\b(.*?)%%\s*$/;
const END = /^%%\s*ra:end\s*%%\s*$/;
const ATTR = /([\w-]+)=(?:"([^"]*)"|(\S+))/g;
const PAGE_LINE = /^\[Page\s+([^\]]*)\]\((zotero:\/\/[^)\s]+)\)\s*$/;
const MARK_WRAP = /^<mark\s+class="(hltr-[\w-]+)"\s*>([\s\S]*)<\/mark>$/;
const IMG_LINE = /^\s*(?:!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\))\s*$/;

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

function escapeLabel(label: string): string {
	return label.trim().replace(/:+$/, "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelAlternatives(labels: string[]): string {
	return labels.map(escapeLabel).filter(Boolean).join("|");
}

function commentMatcher(labels: string[]): RegExp {
	return new RegExp(`^(?:\\*\\*)?(?:${labelAlternatives(labels)}):(?:\\*\\*)?[ \\t]?`, "i");
}

function tagsMatcher(labels: string[]): RegExp {
	return new RegExp(`^(?:\\*\\*)?(?:${labelAlternatives(labels)}):(?:\\*\\*)?\\s*(.*)$`, "i");
}

/** Peel page link (last), tags line, comment (from label), then image + highlight head. */
function parseBody(lines: string[], labels: ParseLabels): Body {
	const commentRe = commentMatcher(labels.commentLabels);
	const tagsRe = tagsMatcher(labels.tagsLabels);
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === "") end--;

	let pageLabel: string | undefined, zotero: ZoteroLink | undefined;
	if (end > 0) {
		const m = PAGE_LINE.exec(lines[end - 1].trim());
		if (m) { pageLabel = m[1].trim() || undefined; zotero = parseZoteroUri(m[2]); end--; }
	}

	const tags: string[] = [];
	for (let k = end - 1; k >= 0; k--) {
		const m = tagsRe.exec(lines[k]);
		if (m) {
			for (const t of m[1].matchAll(/#([^\s#,;]+)/g)) tags.push(t[1]);
			end = k;
			break;
		}
	}

	let commentIdx = -1;
	for (let k = 0; k < end; k++) if (commentRe.test(lines[k])) { commentIdx = k; break; }
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
		cl[0] = cl[0].replace(commentRe, "");
		comment = cl.join("\n").trim() || undefined;
	}
	return { highlight: highlight || undefined, comment, images, tags, pageLabel, zotero, htmlClass };
}

function parseAttrs(s: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of s.matchAll(ATTR)) out[m[1]] = m[2] ?? m[3] ?? "";
	return out;
}

export function parseNote(text: string, sourcePath: string, labels: ParseLabels = DEFAULT_PARSE_LABELS): ParsedNote {
	const lines = text.split(/\r?\n/);
	const warnings: ParseWarning[] = [];
	const found: ResearchAnnotation[] = [];
	// ── Explicit blocks only: an annotation without ra: markers is ignored. ──
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
		const body = parseBody(lines.slice(i + 1, j), labels);
		const colorClass = toColorClass(attrs.color) ?? body.htmlClass;
		let id = attrs.id || body.zotero?.annotationKey;
		if (!id) {
			id = "h-" + fnv1a(lines.slice(i, j + 1).join("\n"));
			warnings.push({ kind: "missing-id", line: i, message: "no id in header; content hash used (unstable)" });
		}
		found.push({
			id, sourcePath,
			highlight: body.highlight, comment: body.comment, images: body.images, tags: body.tags,
			colorName: attrs.color || undefined, colorClass, annotationType: attrs.type || undefined,
			pageLabel: body.pageLabel, zotero: body.zotero,
			range: { startLine: i, endLine: j }, originalMarkdown: lines.slice(i, j + 1).join("\n"),
		});
		i = j;
	}

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
