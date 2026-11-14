import type { GroupKey, SortKey } from "../query/annotation-query.ts";

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
	/** Name of the Zotero Integration persist block; its %% begin/end %% markers bound legacy parsing. */
	persistBlockName: string;
	/** Folder prefixes to index. Empty = whole vault. */
	scopeFolders: string[];
	/** Frontmatter key holding project links. */
	projectsKey: string;
	/** Use colour emoji in tags (🔴 …) when an annotation has no highlight colour. */
	inferColorFromTags: boolean;
	showLegacyBadge: boolean;
	defaultSort: SortKey;
	defaultGroup: GroupKey;
}

export const DEFAULT_SETTINGS: RASettings = {
	colors: DEFAULT_COLORS,
	persistBlockName: "annotations",
	scopeFolders: [],
	projectsKey: "projects",
	inferColorFromTags: true,
	showLegacyBadge: false,
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
	return out;
}
