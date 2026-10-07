/**
 * Removes things that must never be shown or logged from an error message: URLs (webhook and
 * Discord destinations carry their secret in the URL), API tokens, GitHub tokens, Slack-style
 * tokens, long opaque strings (keys, signatures) and stack traces. Keeps the message readable.
 */
export function redact(message: string, max = 500): string {
	return message
		.split('\n')[0]
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
		.replace(/\b(tkt_(?:pat|prj)_|gh[pousr]_|github_pat_|xox[abpr]-)[A-Za-z0-9_-]+/g, '[secret]')
		.replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [secret]')
		.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]')
		.slice(0, max);
}
