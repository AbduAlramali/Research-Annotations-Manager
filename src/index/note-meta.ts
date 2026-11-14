export interface NoteMeta {
	path: string;
	title: string;
	authors: string[];
	projects: { key: string; name: string }[];
}

function clean(s: string): string {
	return s.split("|")[0].split("#")[0].trim();
}

/**
 * Frontmatter link lists arrive in several shapes: ["[[A]]","[[B|alias]]"], a single string, or – when the
 * user wrote unquoted [[A]] – a nested array [["A"]]. All are flattened to link targets.
 */
export function extractLinkTargets(v: unknown): string[] {
	const out: string[] = [];
	const walk = (x: unknown) => {
		if (Array.isArray(x)) x.forEach(walk);
		else if (typeof x === "string") {
			const links = [...x.matchAll(/\[\[([^\]]+)\]\]/g)];
			if (links.length) for (const m of links) out.push(clean(m[1]));
			else if (x.trim()) out.push(x.trim());
		}
	};
	walk(v);
	return [...new Set(out.filter(Boolean))];
}

export function parseAuthors(v: unknown): string[] {
	const flat = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap(flat) : x == null ? [] : [String(x)]);
	return flat(v)
		.flatMap((s) => s.split(/;|\s+and\s+/))
		.map((s) => s.trim())
		.filter(Boolean);
}
