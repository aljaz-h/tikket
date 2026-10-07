import type { ConditionField, ConditionOp } from './constants';

/** Which operators each condition field supports (server validation and the editor agree). */
export const FIELD_OPS: Record<ConditionField, ConditionOp[]> = {
	type: ['is', 'is_not'],
	status: ['is', 'is_not'],
	priority: ['is', 'is_not', 'gte', 'lte'],
	assignee: ['is', 'is_not', 'is_empty', 'is_not_empty'],
	reporter: ['is', 'is_not'],
	label: ['has', 'has_not'],
	milestone: ['is', 'is_not', 'is_empty', 'is_not_empty'],
	release: ['is', 'is_not', 'is_empty', 'is_not_empty'],
	votes: ['gte', 'lte'],
	has_attachment: ['is_true', 'is_false'],
	via_widget: ['is_true', 'is_false'],
	project: ['is'],
	title: ['contains', 'not_contains'],
	description: ['contains', 'not_contains'],
	age_days: ['gte', 'lte'],
	reporter_role: ['is', 'is_not']
};

export const FIELD_LABEL: Record<ConditionField, string> = {
	type: 'Type',
	status: 'Status',
	priority: 'Priority',
	assignee: 'Assignee',
	reporter: 'Reporter',
	label: 'Label',
	milestone: 'Milestone',
	release: 'Release',
	votes: 'Votes',
	has_attachment: 'Has attachments',
	via_widget: 'Submitted via widget',
	project: 'Project',
	title: 'Title',
	description: 'Description',
	age_days: 'Age (days)',
	reporter_role: 'Reporter role'
};

export const OP_LABEL: Record<ConditionOp, string> = {
	is: 'is',
	is_not: 'is not',
	is_empty: 'is empty',
	is_not_empty: 'is set',
	has: 'has',
	has_not: 'does not have',
	gte: 'is at least',
	lte: 'is at most',
	contains: 'contains',
	not_contains: 'does not contain',
	is_true: 'yes',
	is_false: 'no'
};

export const REPORTER_ROLES = ['owner', 'moderator', 'member', 'admin', 'none'] as const;
export const REPORTER_ROLE_LABEL: Record<(typeof REPORTER_ROLES)[number], string> = {
	owner: 'Project owner',
	moderator: 'Moderator',
	member: 'Member',
	admin: 'Administrator',
	none: 'Not a member'
};
export const PEOPLE_TARGETS = ['assignee', 'reporter', 'owners', 'staff', 'followers'] as const;
export const PEOPLE_TARGET_LABEL: Record<(typeof PEOPLE_TARGETS)[number], string> = {
	assignee: 'The assignee',
	reporter: 'The reporter',
	owners: 'Project owners',
	staff: 'Project staff',
	followers: 'Followers'
};
