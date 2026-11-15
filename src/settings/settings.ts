import type { GroupKey, SortKey } from "../query/annotation-query.ts";
import { DEFAULT_PARSE_LABELS } from "../parser/types.ts";
import type { ParseLabels } from "../parser/types.ts";

export interface ColorDef {
	zotero: string; // Zotero colour name shown as "original colour"
	alias: string; // configurable semantic alias
}
export type ColorTable = Record<string, ColorDef>;

export const DEFAULT_COLORS: ColorTable = {
	"hltr-yellow": { zotero: "Yellow", alias: "Core ideas" },
	"hltr-orange": { zotero: "Orange", alias: "Contributions" },
	"hltr-pink": { zotero: "Magenta", alias: "Problems" },
	"hltr-red": { zotero: "Red", alias: "Critical analysis" },
	"hltr-purple": { zotero: "Purple", alias: "Research opportunities" },
	"hltr-cyan": { zotero: "Cyan", alias: "Experimental evidence" },
	"hltr-grey": { zotero: "Gray", alias: "Foundations" },
	"hltr-blue": { zotero: "Blue", alias: "Connections" },
	"hltr-green": { zotero: "Green", alias: "Methods" },
};

export interface RASettings {
	colors: ColorTable;
	/** Folder prefixes to index. Empty = whole vault. */
	scopeFolders: string[];
	/** Comma-separated labels used before a comment, without the colon. */
	commentLabels: string;
	/** Comma-separated labels used before tags, without the colon. */
	tagsLabels: string;
	/** Frontmatter key holding project links. */
	projectsKey: string;
	/** Use colour emoji in tags (🔴 …) when an annotation has no highlight colour. */
	inferColorFromTags: boolean;
	defaultSort: SortKey;
	defaultGroup: GroupKey;
}

export const DEFAULT_SETTINGS: RASettings = {
	colors: DEFAULT_COLORS,
	scopeFolders: [],
	commentLabels: DEFAULT_PARSE_LABELS.commentLabels.join(", "),
	tagsLabels: DEFAULT_PARSE_LABELS.tagsLabels.join(", "),
	projectsKey: "projects",
	inferColorFromTags: true,
	defaultSort: "paper",
	defaultGroup: "none",
};

/** Deep-merges saved data over defaults so a settings file from an older version can't drop colour keys. */
export function mergeSettings(saved: unknown): RASettings {
	const base: RASettings = structuredClone(DEFAULT_SETTINGS);
	if (!saved || typeof saved !== "object") return base;
	const s = saved as Partial<RASettings>;
	const out: RASettings = { ...base, ...s, colors: base.colors };
	for (const [cls, def] of Object.entries(s.colors ?? {})) {
		if (out.colors[cls] && typeof def?.alias === "string") out.colors[cls].alias = def.alias;
	}
	if (!Array.isArray(out.scopeFolders)) out.scopeFolders = [];
	if (typeof out.commentLabels !== "string" || !out.commentLabels.trim()) out.commentLabels = base.commentLabels;
	if (typeof out.tagsLabels !== "string" || !out.tagsLabels.trim()) out.tagsLabels = base.tagsLabels;
	return out;
}

/** Parses the comma-separated label settings into the parser's label lists. */
export function toParseLabels(s: RASettings): ParseLabels {
	const list = (value: string, fallback: string[]) => {
		const labels = value.split(",").map((x) => x.trim().replace(/:+$/, "").trim()).filter(Boolean);
		return labels.length ? labels : fallback;
	};
	return {
		commentLabels: list(s.commentLabels, DEFAULT_PARSE_LABELS.commentLabels),
		tagsLabels: list(s.tagsLabels, DEFAULT_PARSE_LABELS.tagsLabels),
	};
}
