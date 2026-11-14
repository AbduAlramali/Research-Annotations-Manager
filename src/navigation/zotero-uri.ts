/**
 * Only URI shapes observed in real Zotero Integration output / Zotero forum reports are handled:
 *   zotero://open-pdf/library/items/<ATTACHMENT_KEY>?page=<P>&annotation=<ANN_KEY>
 *   zotero://select/library/items/<ITEM_KEY>
 * Group libraries (zotero://open-pdf/groups/<id>/items/...) are accepted but UNVERIFIED against real data.
 */
export interface ZoteroLink {
	raw: string;
	kind: "open-pdf" | "select";
	library: string; // "library" | "groups/<id>"
	itemKey: string; // attachment key for open-pdf
	page?: string; // opaque: may be a page LABEL or an index depending on reader/version
	annotationKey?: string;
}

const RE = /^zotero:\/\/(open-pdf|select)\/(library|groups\/\d+)\/items\/([A-Za-z0-9]+)(?:\?(.*))?$/;

export function parseZoteroUri(raw: string): ZoteroLink | undefined {
	const m = RE.exec(raw.trim());
	if (!m) return undefined;
	const q = new URLSearchParams(m[4] ?? "");
	return {
		raw: raw.trim(),
		kind: m[1] as ZoteroLink["kind"],
		library: m[2],
		itemKey: m[3],
		page: q.get("page") ?? undefined,
		annotationKey: q.get("annotation") ?? undefined,
	};
}

export type ZoteroPrecision = "annotation" | "page" | "pdf" | "item";
export interface ZoteroTarget {
	uri: string;
	precision: ZoteroPrecision;
}

/**
 * Ordered most-precise → least-precise. The first entry is the default click target; the rest are
 * offered as explicit alternatives, because Obsidian cannot probe whether Zotero can resolve a URI.
 * Page is passed through untouched – never reconstructed from pageLabel (roman-numeral labels break).
 */
export function zoteroTargets(link?: ZoteroLink): ZoteroTarget[] {
	if (!link) return [];
	const base = `zotero://open-pdf/${link.library}/items/${link.itemKey}`;
	if (link.kind === "select") return [{ uri: link.raw, precision: "item" }];
	const out: ZoteroTarget[] = [];
	if (link.annotationKey && link.page) out.push({ uri: link.raw, precision: "annotation" });
	if (link.page) out.push({ uri: `${base}?page=${encodeURIComponent(link.page)}`, precision: "page" });
	out.push({ uri: base, precision: "pdf" });
	out.push({ uri: `zotero://select/${link.library}/items/${link.itemKey}`, precision: "item" });
	return out;
}
