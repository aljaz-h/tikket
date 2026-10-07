/**
 * Transactional email layout in Tikket's charcoal + lime branding.
 *
 * - Table layout with inline styles (what email clients reliably support).
 * - No remote images, web fonts or tracking pixels: the logo is drawn with styled text, so every
 *   message is complete with images blocked.
 * - Every message has a plain-text alternative with the same content.
 * - All user-provided text is escaped.
 */

export interface EmailContent {
	/** Hidden preview text shown by inbox lists. */
	preheader?: string;
	/** Small label above the heading, e.g. "Spool · SPL-42". */
	eyebrow?: string;
	heading: string;
	paragraphs?: string[];
	/** Key/value facts (status, priority …). */
	details?: [string, string][];
	/** Quoted user text (already plain text, will be escaped and truncated). */
	quote?: string;
	action?: { label: string; url: string };
	/** Why the recipient got this email and how to change it. */
	footer?: string;
	appName?: string;
}

const C = {
	charcoal: '#0d0f11',
	panel: '#ffffff',
	page: '#f2f3f1',
	text: '#1b1e22',
	muted: '#5f656d',
	border: '#e2e4e0',
	lime: '#b8f779',
	limeDark: '#3d6b10'
};

export function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Collapses whitespace and truncates on a word boundary. */
export function truncate(value: string, max: number) {
	const clean = value.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

function safeUrl(url: string) {
	return /^https?:\/\//i.test(url) ? url : '';
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
	const app = content.appName || 'Tikket';
	const font =
		"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
	const p = (text: string) =>
		`<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.text}">${escapeHtml(text)}</p>`;
	const details = content.details?.length
		? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse">${content.details
				.map(
					([k, v]) =>
						`<tr><td style="padding:3px 16px 3px 0;font-size:13px;color:${C.muted};white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:3px 0;font-size:13px;color:${C.text};font-weight:600">${escapeHtml(v)}</td></tr>`
				)
				.join('')}</table>`
		: '';
	const quote = content.quote
		? `<div style="margin:0 0 18px;padding:12px 14px;border-left:3px solid ${C.lime};background:#f7f8f5;border-radius:4px;font-size:14px;line-height:1.5;color:${C.text};white-space:pre-wrap">${escapeHtml(truncate(content.quote, 600))}</div>`
		: '';
	const actionUrl = content.action ? safeUrl(content.action.url) : '';
	const action =
		content.action && actionUrl
			? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="border-radius:8px;background:${C.lime}"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:11px 20px;font-family:${font};font-size:14px;font-weight:600;color:${C.charcoal};text-decoration:none;border-radius:8px">${escapeHtml(content.action.label)}</a></td></tr></table>
<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${C.muted}">Or open this link: <a href="${escapeHtml(actionUrl)}" style="color:${C.limeDark};word-break:break-all">${escapeHtml(actionUrl)}</a></p>`
			: '';
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${font}">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:${C.charcoal};border-radius:12px 12px 0 0;padding:16px 24px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:22px;height:22px;background:${C.lime};border-radius:6px;font-size:13px;font-weight:800;color:${C.charcoal};text-align:center;line-height:22px">✓</td>
<td style="padding-left:10px;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:-0.2px">${escapeHtml(app)}</td>
</tr></table></td></tr>
<tr><td style="background:${C.panel};padding:26px 24px 22px;border:1px solid ${C.border};border-top:0;border-radius:0 0 12px 12px">
${content.eyebrow ? `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.3px;color:${C.muted};text-transform:uppercase">${escapeHtml(content.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${C.charcoal}">${escapeHtml(content.heading)}</h1>
${(content.paragraphs ?? []).map(p).join('\n')}
${details}${quote}${action}
</td></tr>
${content.footer ? `<tr><td style="padding:16px 24px 0;font-size:12px;line-height:1.5;color:${C.muted};text-align:center">${escapeHtml(content.footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;

	const lines = [
		content.eyebrow,
		content.heading,
		'',
		...(content.paragraphs ?? []).flatMap((x) => [x, '']),
		...(content.details ?? []).map(([k, v]) => `${k}: ${v}`),
		content.details?.length ? '' : undefined,
		content.quote ? `> ${truncate(content.quote, 600).replace(/\n/g, '\n> ')}\n` : undefined,
		content.action && actionUrl ? `${content.action.label}: ${actionUrl}` : undefined,
		content.footer ? `\n--\n${content.footer}` : undefined
	];
	const text =
		lines
			.filter((l) => l !== undefined)
			.join('\n')
			.trim() + '\n';
	return { html, text };
}
