/** Built-in ticket views, available in every project without saving anything. */
export interface BuiltInView {
	key: string;
	name: string;
	query: string;
	/** Only meaningful for signed-in users ("me"). */
	signedIn?: boolean;
	/** Only for project staff. */
	staff?: boolean;
}

const UNRESOLVED = 'status=open&status=planned&status=in_progress&status=on_hold';

export const BUILT_IN_VIEWS: BuiltInView[] = [
	{ key: 'all', name: 'All tickets', query: '' },
	{ key: 'open', name: 'Open tickets', query: UNRESOLVED },
	{ key: 'mine', name: 'Assigned to me', query: `${UNRESOLVED}&assignee=me`, signedIn: true },
	{ key: 'reported', name: 'Reported by me', query: 'reporter=me', signedIn: true },
	{ key: 'following', name: 'Following', query: 'following=1', signedIn: true },
	{ key: 'unassigned', name: 'Unassigned', query: `${UNRESOLVED}&assignee=none`, staff: true },
	{
		key: 'urgent',
		name: 'High priority',
		query: `${UNRESOLVED}&priority=high&priority=critical`
	},
	{ key: 'requested', name: 'Most requested', query: `${UNRESOLVED}&sort=votes` },
	{ key: 'done', name: 'Recently completed', query: 'status=completed&sort=recent' }
];
