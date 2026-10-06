/** One-line description of a project activity entry (actor name is prepended by the UI). */
export function describeProjectActivity(type: string, data: Record<string, unknown>): string {
	switch (type) {
		case 'created':
			return 'created it';
		case 'renamed':
			return `renamed it from “${data.from}” to “${data.to}”`;
		case 'edited':
			return `edited the ${((data.fields as string[] | undefined) ?? ['details']).join(', ')}`;
		case 'status':
			return `changed the status from ${data.from} to ${data.to}`;
		case 'published':
			return `published it (${data.completed} completed, ${data.unresolved} unresolved${data.detached ? `, ${data.detached} moved out` : ''})`;
		case 'notes':
			return 'edited the release notes';
		case 'deleted':
			return 'deleted it';
		case 'completed':
			return 'marked it as completed';
		case 'reopened':
			return 'reopened it';
		case 'archived':
			return 'archived it';
		case 'tickets':
			return `${data.added ? `added ${data.added}` : ''}${data.added && data.removed ? ' and ' : ''}${data.removed ? `removed ${data.removed}` : ''} ticket${Number(data.added ?? 0) + Number(data.removed ?? 0) === 1 ? '' : 's'}`;
		default:
			return 'updated it';
	}
}
