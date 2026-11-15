import type { ZoteroLink } from "../navigation/zotero-uri.ts";

export interface ResearchAnnotation {
	/** Zotero annotation key (stable). Falls back to a content hash (unstable) only when no key exists. */
	id: string;
	sourcePath: string;
	/** Inner Markdown of the highlight, <mark> wrapper removed. Everything else untouched. */
	highlight?: string;
	comment?: string;
	/** Link targets of embedded images (wikilink target or Markdown path), alias/size stripped. */
	images: string[];
	tags: string[];
	/** Zotero colorCategory as written in the ra header. */
	colorName?: string;
	/** Normalised CSS class, e.g. hltr-pink. Key into the semantic-alias table. */
	colorClass?: string;
	/** True when colorClass was inferred from a tag emoji (set by the index, never by the parser). */
	colorInferred?: boolean;
	annotationType?: string;
	pageLabel?: string;
	zotero?: ZoteroLink;
	/** 0-based inclusive line range in the file AT PARSE TIME. Never persist as an identifier. */
	range: { startLine: number; endLine: number };
	originalMarkdown: string;
}

export interface ParseWarning {
	kind: "duplicate-id" | "unterminated-block" | "missing-id";
	line: number;
	message: string;
}

export interface ParsedNote {
	annotations: ResearchAnnotation[];
	warnings: ParseWarning[];
}

/** Labels used in the annotation Markdown. Stored without the trailing colon. */
export interface ParseLabels {
	commentLabels: string[];
	tagsLabels: string[];
}

export const DEFAULT_PARSE_LABELS: ParseLabels = {
	commentLabels: ["Comment", "My comment"],
	tagsLabels: ["Tags", "Annotation tags"],
};
