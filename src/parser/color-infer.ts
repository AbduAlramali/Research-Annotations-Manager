/** Maps colour emoji used in tags (e.g. "#note/🔴critical_analysis") to highlight classes. Opt-in via settings. */
const EMOJI_TO_CLASS: Record<string, string> = {
	"🟡": "hltr-yellow", "🟠": "hltr-orange", "🩷": "hltr-pink", "🔴": "hltr-red", "🟣": "hltr-purple",
	"🩵": "hltr-cyan", "🩶": "hltr-grey", "⚪": "hltr-grey", "⚫": "hltr-grey", "🔵": "hltr-blue", "🟢": "hltr-green",
};

export function inferColorFromTags(tags: string[]): string | undefined {
	const found = new Set<string>();
	for (const t of tags) for (const ch of t) { const c = EMOJI_TO_CLASS[ch]; if (c) found.add(c); }
	return found.size === 1 ? [...found][0] : undefined; // ambiguous (several colours) → don't guess
}
