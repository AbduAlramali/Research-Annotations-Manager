/**
 * Obsidian natively renders $…$ and $$…$$ only. In plain Markdown, "\(" and "\[" are backslash
 * escapes and would render as literal "(" / "[". So delimiters are rewritten in a RENDER-ONLY copy;
 * the original Markdown is never modified. Code spans and fences are left alone.
 */
export function normalizeMath(md: string): string {
	const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
	return parts
		.map((p, i) => {
			if (i % 2) return p;
			return p
				.replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_m, x: string) => `\n$$\n${x.trim()}\n$$\n`)
				.replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_m, x: string) => `$${x.trim()}$`);
		})
		.join("");
}
