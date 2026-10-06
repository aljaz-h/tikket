const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['week', 7 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60]
];

export function timeAgo(date: Date | string | number, now = Date.now()): string {
	const d = new Date(date);
	const seconds = Math.round((d.getTime() - now) / 1000);
	if (Math.abs(seconds) < 45) return 'just now';
	for (const [unit, size] of UNITS) {
		if (Math.abs(seconds) >= size || unit === 'minute') {
			return rtf.format(Math.round(seconds / size), unit);
		}
	}
	return 'just now';
}

const dateFmt = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en', {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

export function formatDate(date: Date | string | number | null | undefined): string {
	if (!date) return '—';
	return dateFmt.format(new Date(date));
}

export function formatDateTime(date: Date | string | number | null | undefined): string {
	if (!date) return '—';
	return dateTimeFmt.format(new Date(date));
}

export function ticketRef(projectKey: string, number: number): string {
	return `${projectKey}-${number}`;
}

export function ticketPath(projectKey: string, number: number): string {
	return `/p/${projectKey.toLowerCase()}/tickets/${number}`;
}

export function projectPath(projectKey: string, sub = ''): string {
	return `/p/${projectKey.toLowerCase()}${sub ? `/${sub}` : ''}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}
