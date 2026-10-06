import sanitizeHtml from 'sanitize-html';
import { safeHttpUrl } from '../shared/text';

/**
 * Rich-text policy: a small, explicit allow-list matching the editor's capabilities.
 * Anything else – scripts, styles, iframes, images, event handlers, data: URLs – is removed.
 */
const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: [
		'p',
		'br',
		'h2',
		'h3',
		'strong',
		'em',
		's',
		'u',
		'code',
		'pre',
		'blockquote',
		'ul',
		'ol',
		'li',
		'a',
		'hr'
	],
	allowedAttributes: { a: ['href', 'rel', 'target'], ol: ['start'] },
	allowedSchemes: ['http', 'https', 'mailto'],
	allowedSchemesAppliedToAttributes: ['href'],
	allowProtocolRelative: false,
	disallowedTagsMode: 'discard',
	enforceHtmlBoundary: false,
	transformTags: {
		h1: 'h2',
		h4: 'h3',
		h5: 'h3',
		h6: 'h3',
		b: 'strong',
		i: 'em',
		strike: 's',
		del: 's',
		div: 'p',
		a: (_tagName, attribs): sanitizeHtml.Tag => {
			const href = attribs.href?.startsWith('mailto:') ? attribs.href : safeHttpUrl(attribs.href);
			// Unsafe targets keep their text but lose the link.
			if (!href) return { tagName: 'a', attribs: {} as sanitizeHtml.Attributes };
			return {
				tagName: 'a',
				attribs: { href, rel: 'noopener noreferrer nofollow ugc', target: '_blank' }
			};
		}
	}
};

export function sanitizeRichText(html: string): string {
	const clean = sanitizeHtml(html, OPTIONS).trim();
	// Collapse documents that contain nothing but empty paragraphs.
	return htmlToText(clean).trim() ? clean : '';
}

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&#x27;': "'",
	'&nbsp;': ' '
};

/** Plain-text projection of sanitised HTML (for search, previews and notifications). */
export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|h2|h3|li|blockquote|pre)>/gi, '\n')
		.replace(/<li>/gi, '• ')
		.replace(/<[^>]*>/g, '')
		.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENTITIES[m] ?? m)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Converts plain text (no-JS fallback editor) into safe paragraphs with auto-linked URLs. */
export function plainTextToHtml(text: string): string {
	const paragraphs = text
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
	const html = paragraphs
		.map((p) => {
			const escaped = escapeHtml(p).replace(URL_RE, (url) => {
				const href = safeHttpUrl(url.replace(/&amp;/g, '&'));
				return href ? `<a href="${escapeHtml(href)}">${url}</a>` : url;
			});
			return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
		})
		.join('');
	return sanitizeRichText(html);
}

/**
 * Normalises editor input. Rich HTML comes from the editor; the textarea fallback (no JS)
 * submits plain text.
 */
export function normaliseRichInput(
	value: string,
	format: string | null
): { html: string; text: string } {
	const html = format === 'html' ? sanitizeRichText(value) : plainTextToHtml(value);
	return { html, text: htmlToText(html) };
}
