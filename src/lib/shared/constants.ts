/**
 * Domain constants shared by the client and the server.
 * Keep labels and colours here so every view renders statuses consistently.
 */

export const TICKET_STATUSES = [
	'open',
	'planned',
	'in_progress',
	'completed',
	'on_hold',
	'declined',
	'duplicate'
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_META: Record<
	TicketStatus,
	{ label: string; description: string; tone: string; resolved: boolean }
> = {
	open: {
		label: 'Open',
		description: 'Newly submitted or awaiting review',
		tone: 'tone-open',
		resolved: false
	},
	planned: {
		label: 'Planned',
		description: 'Accepted for a future update',
		tone: 'tone-planned',
		resolved: false
	},
	in_progress: {
		label: 'In Progress',
		description: 'Currently being worked on',
		tone: 'tone-progress',
		resolved: false
	},
	completed: {
		label: 'Completed',
		description: 'Implemented or fixed',
		tone: 'tone-completed',
		resolved: true
	},
	on_hold: {
		label: 'On Hold',
		description: 'Postponed or undecided',
		tone: 'tone-hold',
		resolved: false
	},
	declined: {
		label: 'Declined',
		description: 'Not needed or rejected',
		tone: 'tone-declined',
		resolved: true
	},
	duplicate: {
		label: 'Duplicate',
		description: 'Already tracked by another ticket',
		tone: 'tone-duplicate',
		resolved: true
	}
};

export const UNRESOLVED_STATUSES = TICKET_STATUSES.filter((s) => !STATUS_META[s].resolved);
export const RESOLVED_STATUSES = TICKET_STATUSES.filter((s) => STATUS_META[s].resolved);

/** Statuses where an optional explanation is offered when switching to them. */
export const STATUSES_WITH_NOTE: TicketStatus[] = ['declined', 'on_hold', 'duplicate', 'completed'];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const PRIORITY_META: Record<TicketPriority, { label: string; tone: string; rank: number }> =
	{
		low: { label: 'Low', tone: 'tone-low', rank: 0 },
		medium: { label: 'Medium', tone: 'tone-medium', rank: 1 },
		high: { label: 'High', tone: 'tone-high', rank: 2 },
		critical: { label: 'Critical', tone: 'tone-critical', rank: 3 }
	};

export const TICKET_TYPES = ['bug', 'feature', 'improvement', 'feedback'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TYPE_META: Record<
	TicketType,
	{
		label: string;
		short: string;
		tagline: string;
		descriptionLabel: string;
		descriptionHint: string;
		titlePlaceholder: string;
	}
> = {
	bug: {
		label: 'Bug Report',
		short: 'Bug',
		tagline: "Something isn't working correctly.",
		descriptionLabel: 'What happened?',
		descriptionHint: 'Describe the problem you ran into.',
		titlePlaceholder: "The episode progress doesn't update after marking it watched"
	},
	feature: {
		label: 'Feature Request',
		short: 'Feature',
		tagline: 'Suggest something new.',
		descriptionLabel: 'What would you like to see?',
		descriptionHint: 'Describe the functionality you have in mind.',
		titlePlaceholder: 'Let me export my watch history as CSV'
	},
	improvement: {
		label: 'Improvement',
		short: 'Improvement',
		tagline: 'Something already works, but could be better.',
		descriptionLabel: 'What could be improved?',
		descriptionHint: 'Explain what is inconvenient today.',
		titlePlaceholder: 'Remember the last selected filter on the shows page'
	},
	feedback: {
		label: 'General Feedback',
		short: 'Feedback',
		tagline: 'Anything else you want to share.',
		descriptionLabel: 'Your feedback',
		descriptionHint: 'Tell us what is on your mind.',
		titlePlaceholder: 'Thoughts on the new dashboard'
	}
};

/** Optional, type-specific context fields shown with progressive disclosure. */
export const CONTEXT_FIELDS: Record<
	TicketType,
	{ key: ContextKey; label: string; placeholder: string; kind: 'text' | 'url' }[]
> = {
	bug: [
		{
			key: 'expected',
			label: 'What did you expect to happen?',
			placeholder: 'The progress bar should update immediately.',
			kind: 'text'
		},
		{
			key: 'steps',
			label: 'How can we reproduce it?',
			placeholder:
				'1. Open the dashboard\n2. Select a TV show\n3. Mark an episode as watched\n4. Refresh the page',
			kind: 'text'
		},
		{
			key: 'affectedUrl',
			label: 'Affected URL',
			placeholder: 'https://example.com/shows/123',
			kind: 'url'
		}
	],
	feature: [
		{
			key: 'motivation',
			label: 'Why would it be useful?',
			placeholder: 'Explain the problem it would solve for you.',
			kind: 'text'
		}
	],
	improvement: [
		{
			key: 'proposal',
			label: 'How would you improve it?',
			placeholder: 'Describe the solution you would suggest.',
			kind: 'text'
		}
	],
	feedback: []
};

export const CONTEXT_KEYS = ['expected', 'steps', 'affectedUrl', 'motivation', 'proposal'] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type TicketContext = Partial<Record<ContextKey, string>>;

export const CONTEXT_LABELS: Record<ContextKey, string> = {
	expected: 'Expected behaviour',
	steps: 'Steps to reproduce',
	affectedUrl: 'Affected URL',
	motivation: 'Why it would be useful',
	proposal: 'Suggested improvement'
};

export const GLOBAL_ROLES = ['admin', 'user'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const PROJECT_ROLES = ['owner', 'moderator', 'member'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export const PROJECT_ROLE_META: Record<ProjectRole, { label: string; description: string }> = {
	owner: { label: 'Owner', description: 'Full management access within the project' },
	moderator: { label: 'Moderator', description: 'Reviews and manages tickets and discussions' },
	member: { label: 'Member', description: 'Submits tickets, comments and votes' }
};

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const SUBMISSION_POLICIES = ['any_user', 'members'] as const;
export type SubmissionPolicy = (typeof SUBMISSION_POLICIES)[number];

export const EDIT_POLICIES = ['never', 'while_open', 'always'] as const;
export type EditPolicy = (typeof EDIT_POLICIES)[number];
export const EDIT_POLICY_META: Record<EditPolicy, string> = {
	never: 'Authors cannot edit after submitting',
	while_open: 'Authors can edit while the ticket is Open',
	always: 'Authors can always edit their tickets'
};

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const NOTIFICATION_TYPES = [
	'new_ticket',
	'comment',
	'status',
	'mention',
	'assigned',
	'update',
	'release',
	'milestone'
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_PREF_META: Record<NotificationType, { label: string; hint: string }> = {
	new_ticket: { label: 'New tickets', hint: 'A ticket is submitted to a project you manage' },
	comment: { label: 'New comments', hint: 'Someone comments on a ticket you follow' },
	status: { label: 'Status changes', hint: 'Including completed and declined tickets' },
	mention: { label: 'Mentions', hint: 'Someone mentions you with @username' },
	assigned: { label: 'Assignments', hint: 'A ticket is assigned to you' },
	update: { label: 'Other updates', hint: 'Priority changes, duplicates and edits' },
	release: {
		label: 'Releases',
		hint: 'A release containing a ticket you follow is published'
	},
	milestone: {
		label: 'Milestones',
		hint: 'A ticket you follow moves to another milestone, or its milestone is completed'
	}
};
export type NotificationPrefs = Record<NotificationType, boolean>;
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
	new_ticket: true,
	comment: true,
	status: true,
	mention: true,
	assigned: true,
	update: false,
	release: true,
	milestone: false
};

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = 'tikket_theme';

export const PROJECT_COLORS = [
	'indigo',
	'violet',
	'sky',
	'teal',
	'emerald',
	'amber',
	'orange',
	'rose',
	'slate'
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const LABEL_COLORS = PROJECT_COLORS;

export const PAGE_SIZE = 25;

// ── Phase 2 ─────────────────────────────────────────────────────────────────

export const WIDGET_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

/** Page/browser context the widget may attach (after the user reviewed it). */
export interface TicketEnvironment {
	pageUrl?: string;
	pageTitle?: string;
	browser?: string;
	browserVersion?: string;
	os?: string;
	viewport?: string;
	capturedAt?: string;
	origin?: string;
}

export const TEMPLATE_FIELD_KINDS = [
	'short_text',
	'long_text',
	'select',
	'checkbox',
	'url'
] as const;
export type TemplateFieldKind = (typeof TEMPLATE_FIELD_KINDS)[number];
export const TEMPLATE_FIELD_META: Record<TemplateFieldKind, { label: string }> = {
	short_text: { label: 'Short text' },
	long_text: { label: 'Long text' },
	select: { label: 'Dropdown' },
	checkbox: { label: 'Checkbox' },
	url: { label: 'URL' }
};

/** Answer stored with a ticket, including the question as it was asked. */
export interface TemplateAnswer {
	key: string;
	label: string;
	kind: TemplateFieldKind;
	value: string | boolean;
}

export const RELATION_KINDS = ['relates', 'blocks'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
/** What staff choose in the UI; "blocked_by" is stored as the inverse "blocks". */
export const RELATION_CHOICES = {
	relates: 'Related to',
	blocks: 'Blocks',
	blocked_by: 'Blocked by'
} as const;
export type RelationChoice = keyof typeof RELATION_CHOICES;

// ── Releases, milestones and saved views (v0.4) ─────────────────────────

export const RELEASE_STATUSES = ['planned', 'in_progress', 'released', 'cancelled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export const RELEASE_STATUS_META: Record<ReleaseStatus, { label: string; tone: string }> = {
	planned: { label: 'Planned', tone: 'tone-planned' },
	in_progress: { label: 'In Progress', tone: 'tone-progress' },
	released: { label: 'Released', tone: 'tone-completed' },
	cancelled: { label: 'Cancelled', tone: 'tone-hold' }
};

export const MILESTONE_STATUSES = ['open', 'completed', 'archived'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const MILESTONE_STATUS_META: Record<MilestoneStatus, { label: string; tone: string }> = {
	open: { label: 'Open', tone: 'tone-open' },
	completed: { label: 'Completed', tone: 'tone-completed' },
	archived: { label: 'Archived', tone: 'tone-hold' }
};

/** Columns of the ticket list that can be shown or hidden. */
export const TICKET_COLUMNS = [
	'ref',
	'type',
	'status',
	'priority',
	'project',
	'assignee',
	'reporter',
	'labels',
	'votes',
	'comments',
	'release',
	'milestone',
	'created',
	'updated'
] as const;
export type TicketColumn = (typeof TICKET_COLUMNS)[number];
export const TICKET_COLUMN_META: Record<TicketColumn, { label: string }> = {
	ref: { label: 'Ticket ID' },
	type: { label: 'Type' },
	status: { label: 'Status' },
	priority: { label: 'Priority' },
	project: { label: 'Project' },
	assignee: { label: 'Assignee' },
	reporter: { label: 'Reporter' },
	labels: { label: 'Labels' },
	votes: { label: 'Votes' },
	comments: { label: 'Comments' },
	release: { label: 'Target release' },
	milestone: { label: 'Milestone' },
	created: { label: 'Created' },
	updated: { label: 'Updated' }
};
/** The title is always shown; these are the defaults for the rest. */
export const DEFAULT_TICKET_COLUMNS: TicketColumn[] = [
	'ref',
	'status',
	'priority',
	'labels',
	'votes',
	'assignee',
	'updated'
];

/** Remembers the last chosen ticket list columns (a preference, not a secret). */
export const COLUMNS_COOKIE = 'tikket_cols';

/** Remembers whether the desktop sidebar is collapsed (a preference, not a secret). */
export const SIDEBAR_COOKIE = 'tikket_sidebar';

// ── v0.5: integrations ─────────────────────────────────────────────────────

/** Email defaults: the things people usually want in their inbox (only used when SMTP is on). */
export const DEFAULT_EMAIL_PREFS: NotificationPrefs = {
	new_ticket: false,
	comment: true,
	status: true,
	mention: true,
	assigned: true,
	update: false,
	release: true,
	milestone: false
};

export const HOOK_KINDS = ['discord', 'webhook'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export const JOB_KINDS = ['email', 'discord', 'webhook'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ['pending', 'running', 'done', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Events of generic outbound webhooks (payload schema version 1). */
export const WEBHOOK_EVENTS = [
	'ticket.created',
	'ticket.updated',
	'ticket.status_changed',
	'ticket.assigned',
	'ticket.completed',
	'comment.created',
	'release.published',
	'milestone.completed'
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_META: Record<WebhookEvent, string> = {
	'ticket.created': 'A ticket is submitted',
	'ticket.updated': 'Title, description, type or priority changes',
	'ticket.status_changed': 'The status of a ticket changes',
	'ticket.assigned': 'A ticket is assigned or unassigned',
	'ticket.completed': 'A ticket is marked completed',
	'comment.created': 'A public comment is posted (never internal notes)',
	'release.published': 'A release is published',
	'milestone.completed': 'A milestone is completed'
};

/** Events a Discord destination can subscribe to. */
export const DISCORD_EVENTS = [
	'new_ticket',
	'new_bug',
	'new_feature',
	'high_priority',
	'status_changed',
	'completed',
	'public_comment',
	'release_published'
] as const;
export type DiscordEvent = (typeof DISCORD_EVENTS)[number];
export const DISCORD_EVENT_META: Record<DiscordEvent, string> = {
	new_ticket: 'Any new ticket',
	new_bug: 'New bug reports',
	new_feature: 'New feature requests',
	high_priority: 'High or critical priority tickets',
	status_changed: 'Status changes',
	completed: 'Completed tickets',
	public_comment: 'New public comments',
	release_published: 'Published releases'
};

export const MERGE_ACTIONS = ['none', 'in_progress', 'completed'] as const;
export type MergeAction = (typeof MERGE_ACTIONS)[number];
export const MERGE_ACTION_LABEL: Record<MergeAction, string> = {
	none: 'Do nothing',
	in_progress: 'Move the ticket to In Progress',
	completed: 'Mark the ticket Completed'
};
export const DEV_LINK_KINDS = ['pull_request', 'commit', 'issue'] as const;
export type DevLinkKind = (typeof DEV_LINK_KINDS)[number];

export const SMTP_SECURITY = ['none', 'starttls', 'tls'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

// ── v0.5: roadmap ──────────────────────────────────────────────────────────

export const ROADMAP_AUDIENCES = ['staff', 'members', 'viewers'] as const;
export type RoadmapAudience = (typeof ROADMAP_AUDIENCES)[number];
export const ROADMAP_AUDIENCE_LABEL: Record<RoadmapAudience, string> = {
	staff: 'Staff only',
	members: 'Project members',
	viewers: 'Anyone who can view the project'
};
export interface RoadmapSettings {
	audience: RoadmapAudience;
	showReleases: boolean;
	showReleaseDates: boolean;
	showMilestones: boolean;
	showPriorities: boolean;
	showVotes: boolean;
	showAssignees: boolean;
}
/**
 * Defaults keep exactly what the roadmap showed before v0.5 (ticket titles, types and votes to
 * everyone who can view the project – the same tickets they can already open) and keep all
 * planning details (releases, dates, milestones, priorities, assignees) private.
 */
export const DEFAULT_ROADMAP_SETTINGS: RoadmapSettings = {
	audience: 'viewers',
	showReleases: false,
	showReleaseDates: false,
	showMilestones: false,
	showPriorities: false,
	showVotes: true,
	showAssignees: false
};
