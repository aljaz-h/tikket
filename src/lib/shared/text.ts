/** Returns a normalised http(s) URL or null when the value is not a safe web link. */
export function safeHttpUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 2048) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}

export type TextSegment = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const LINK_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Splits plain text into text and safe-link segments for rendering without {@html}. */
export function linkify(text: string): TextSegment[] {
	const out: TextSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(LINK_RE)) {
		const index = match.index ?? 0;
		if (index > last) out.push({ type: 'text', value: text.slice(last, index) });
		const href = safeHttpUrl(match[0]);
		out.push(href ? { type: 'link', value: match[0], href } : { type: 'text', value: match[0] });
		last = index + match[0].length;
	}
	if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
	return out;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	const first = parts[0][0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
	return (first + last).toUpperCase();
}

export function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9_][a-zA-Z0-9_.-]{1,31})/g;

/** Usernames mentioned as @username in plain text (lower-cased, unique). */
export function extractMentions(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(MENTION_RE)) names.add(match[2].replace(/[.-]+$/, '').toLowerCase());
	return [...names];
}
