import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import type {
	EditPolicy,
	MilestoneStatus,
	ReleaseStatus,
	TicketColumn,
	TemplateFieldKind,
	TicketEnvironment,
	TemplateAnswer,
	RelationKind,
	WidgetPosition,
	GlobalRole,
	NotificationPrefs,
	NotificationType,
	ProjectRole,
	SubmissionPolicy,
	Theme,
	TicketContext,
	TicketPriority,
	TicketStatus,
	TicketType,
	Visibility
} from '../../shared/constants';

/** Unix epoch milliseconds stored as INTEGER, exposed as Date. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const now = sql`(unixepoch('subsec') * 1000)`;

/*
 * Foreign keys default to RESTRICT so important ticket data cannot be wiped out by an
 * accidental cascade. Only purely derived rows (sessions, votes, follows, notifications…)
 * cascade from their parent.
 */

export const users = sqliteTable(
	'users',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		username: text('username').notNull(),
		email: text('email').notNull(),
		displayName: text('display_name').notNull(),
		passwordHash: text('password_hash').notNull(),
		role: text('role').$type<GlobalRole>().notNull().default('user'),
		status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
		avatarId: text('avatar_id'),
		bio: text('bio'),
		theme: text('theme').$type<Theme>(),
		notificationPrefs: text('notification_prefs', { mode: 'json' }).$type<NotificationPrefs>(),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now),
		lastLoginAt: timestamp('last_login_at'),
		passwordChangedAt: timestamp('password_changed_at')
	},
	(t) => [
		uniqueIndex('users_username_unique').on(sql`lower(${t.username})`),
		uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
		check('users_role_check', sql`${t.role} in ('admin','user')`),
		check('users_status_check', sql`${t.status} in ('active','disabled')`)
	]
);

export const sessions = sqliteTable(
	'sessions',
	{
		/** HMAC of the session token; the raw token only ever lives in the cookie. */
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull().default(now),
		lastSeenAt: timestamp('last_seen_at').notNull().default(now),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent')
	},
	(t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]
);

export const projects = sqliteTable(
	'projects',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		description: text('description'),
		icon: text('icon'),
		/** Uploaded or fetched project logo (an attachment of kind 'project_logo'). */
		logoId: text('logo_id').references((): AnySQLiteColumn => attachments.id, {
			onDelete: 'set null'
		}),
		color: text('color').notNull().default('indigo'),
		url: text('url'),
		visibility: text('visibility').$type<Visibility>().notNull().default('private'),
		allowAnonymousRead: integer('allow_anonymous_read', { mode: 'boolean' })
			.notNull()
			.default(false),
		submissionPolicy: text('submission_policy')
			.$type<SubmissionPolicy>()
			.notNull()
			.default('any_user'),
		votingEnabled: integer('voting_enabled', { mode: 'boolean' }).notNull().default(true),
		attachmentsEnabled: integer('attachments_enabled', { mode: 'boolean' }).notNull().default(true),
		commentsEnabled: integer('comments_enabled', { mode: 'boolean' }).notNull().default(true),
		editPolicy: text('edit_policy').$type<EditPolicy>().notNull().default('while_open'),
		/** Monotonic counter used for atomic ticket number allocation. */
		ticketCounter: integer('ticket_counter').notNull().default(0),
		createdById: integer('created_by_id').references(() => users.id),
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now)
	},
	(t) => [
		uniqueIndex('projects_key_unique').on(t.key),
		check('projects_visibility_check', sql`${t.visibility} in ('public','private')`)
	]
);

export const projectMembers = sqliteTable(
	'project_members',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role').$type<ProjectRole>().notNull().default('member'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		uniqueIndex('project_members_unique').on(t.projectId, t.userId),
		index('project_members_user_idx').on(t.userId),
		check('project_members_role_check', sql`${t.role} in ('owner','moderator','member')`)
	]
);

export const invitations = sqliteTable(
	'invitations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tokenHash: text('token_hash').notNull(),
		email: text('email'),
		role: text('role').$type<GlobalRole>().notNull().default('user'),
		projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
		projectRole: text('project_role').$type<ProjectRole>(),
		createdById: integer('created_by_id')
			.notNull()
			.references(() => users.id),
		expiresAt: timestamp('expires_at').notNull(),
		usedAt: timestamp('used_at'),
		usedById: integer('used_by_id').references(() => users.id),
		revokedAt: timestamp('revoked_at'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [uniqueIndex('invitations_token_unique').on(t.tokenHash)]
);

export const passwordResets = sqliteTable(
	'password_resets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tokenHash: text('token_hash').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdById: integer('created_by_id').references(() => users.id),
		expiresAt: timestamp('expires_at').notNull(),
		usedAt: timestamp('used_at'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [uniqueIndex('password_resets_token_unique').on(t.tokenHash)]
);

export const tickets = sqliteTable(
	'tickets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'restrict' }),
		number: integer('number').notNull(),
		type: text('type').$type<TicketType>().notNull(),
		title: text('title').notNull(),
		descriptionHtml: text('description_html').notNull(),
		descriptionText: text('description_text').notNull(),
		context: text('context', { mode: 'json' }).$type<TicketContext>().notNull().default({}),
		status: text('status').$type<TicketStatus>().notNull().default('open'),
		priority: text('priority').$type<TicketPriority>().notNull().default('medium'),
		reporterId: integer('reporter_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
		duplicateOfId: integer('duplicate_of_id').references((): AnySQLiteColumn => tickets.id, {
			onDelete: 'set null'
		}),
		resolutionNote: text('resolution_note'),
		/** Where the ticket was submitted: the web app or the embeddable widget. */
		source: text('source').$type<'web' | 'widget'>().notNull().default('web'),
		/** Sanitised, user-reviewed page/browser context sent by the widget (untrusted input). */
		environment: text('environment', { mode: 'json' }).$type<TicketEnvironment>(),
		/** Target release (at most one); same project enforced by a trigger and the service layer. */
		releaseId: integer('release_id').references((): AnySQLiteColumn => changelogEntries.id, {
			onDelete: 'set null'
		}),
		/** Milestone (at most one); same project enforced by a trigger and the service layer. */
		milestoneId: integer('milestone_id').references((): AnySQLiteColumn => milestones.id, {
			onDelete: 'set null'
		}),
		voteCount: integer('vote_count').notNull().default(0),
		commentCount: integer('comment_count').notNull().default(0),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now),
		completedAt: timestamp('completed_at'),
		closedAt: timestamp('closed_at')
	},
	(t) => [
		uniqueIndex('tickets_project_number_unique').on(t.projectId, t.number),
		index('tickets_project_status_updated_idx').on(t.projectId, t.status, t.updatedAt),
		index('tickets_project_updated_idx').on(t.projectId, t.updatedAt),
		index('tickets_reporter_idx').on(t.reporterId),
		index('tickets_assignee_idx').on(t.assigneeId),
		index('tickets_release_idx').on(t.releaseId, t.status),
		index('tickets_milestone_idx').on(t.milestoneId, t.status),
		check(
			'tickets_status_check',
			sql`${t.status} in ('open','planned','in_progress','completed','on_hold','declined','duplicate')`
		),
		check('tickets_priority_check', sql`${t.priority} in ('low','medium','high','critical')`),
		check('tickets_type_check', sql`${t.type} in ('bug','feature','improvement','feedback')`),
		check('tickets_vote_count_check', sql`${t.voteCount} >= 0`)
	]
);

export const ticketComments = sqliteTable(
	'ticket_comments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ticketId: integer('ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'restrict' }),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		bodyHtml: text('body_html').notNull(),
		bodyText: text('body_text').notNull(),
		/** Internal staff note – visible only to project owners, moderators and admins. Immutable. */
		internal: integer('internal', { mode: 'boolean' }).notNull().default(false),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now),
		editedAt: timestamp('edited_at'),
		/** Soft delete keeps the thread's shape and history. */
		deletedAt: timestamp('deleted_at'),
		deletedById: integer('deleted_by_id').references(() => users.id)
	},
	(t) => [index('ticket_comments_ticket_idx').on(t.ticketId, t.createdAt)]
);

export const attachments = sqliteTable(
	'attachments',
	{
		/** Random, unguessable identifier – also the stored file name stem. */
		id: text('id').primaryKey(),
		uploaderId: integer('uploader_id')
			.notNull()
			.references(() => users.id),
		projectId: integer('project_id').references(() => projects.id, { onDelete: 'restrict' }),
		ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'restrict' }),
		commentId: integer('comment_id').references(() => ticketComments.id, {
			onDelete: 'restrict'
		}),
		/** 'ticket' | 'comment' | 'avatar' | null while still pending. */
		kind: text('kind').$type<'ticket' | 'comment' | 'avatar' | 'project_logo'>(),
		originalName: text('original_name').notNull(),
		mimeType: text('mime_type').notNull(),
		extension: text('extension').notNull(),
		size: integer('size').notNull(),
		width: integer('width'),
		height: integer('height'),
		hasThumbnail: integer('has_thumbnail', { mode: 'boolean' }).notNull().default(false),
		createdAt: timestamp('created_at').notNull().default(now),
		attachedAt: timestamp('attached_at'),
		deletedAt: timestamp('deleted_at')
	},
	(t) => [
		index('attachments_ticket_idx').on(t.ticketId),
		index('attachments_comment_idx').on(t.commentId),
		index('attachments_pending_idx').on(t.attachedAt, t.createdAt)
	]
);

export const ticketVotes = sqliteTable(
	'ticket_votes',
	{
		ticketId: integer('ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		primaryKey({ columns: [t.ticketId, t.userId] }),
		index('ticket_votes_user_idx').on(t.userId)
	]
);

export const ticketFollowers = sqliteTable(
	'ticket_followers',
	{
		ticketId: integer('ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		primaryKey({ columns: [t.ticketId, t.userId] }),
		index('ticket_followers_user_idx').on(t.userId)
	]
);

export const ticketActivity = sqliteTable(
	'ticket_activity',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ticketId: integer('ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'restrict' }),
		actorId: integer('actor_id').references(() => users.id),
		type: text('type').notNull(),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [index('ticket_activity_ticket_idx').on(t.ticketId, t.createdAt)]
);

export const ticketLabels = sqliteTable(
	'ticket_labels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		color: text('color').notNull().default('slate'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [uniqueIndex('ticket_labels_project_name_unique').on(t.projectId, sql`lower(${t.name})`)]
);

export const ticketLabelAssignments = sqliteTable(
	'ticket_label_assignments',
	{
		ticketId: integer('ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'cascade' }),
		labelId: integer('label_id')
			.notNull()
			.references(() => ticketLabels.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.ticketId, t.labelId] }),
		index('ticket_label_assignments_label_idx').on(t.labelId)
	]
);

export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		type: text('type').$type<NotificationType>().notNull(),
		projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
		ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
		actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
		readAt: timestamp('read_at'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)]
);

/**
 * Releases. Historically "changelog entries": a release is planned, receives tickets through
 * `tickets.release_id`, and becomes a public changelog entry when it is published (released).
 * `published` mirrors `status = 'released'` and is what the public changelog reads.
 */
export const changelogEntries = sqliteTable(
	'changelog_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'restrict' }),
		version: text('version').notNull(),
		/** Publication date (YYYY-MM-DD) once released; the target date while planned. */
		releaseDate: text('release_date').notNull(),
		summaryHtml: text('summary_html').notNull().default(''),
		published: integer('published', { mode: 'boolean' }).notNull().default(false),
		status: text('status').$type<ReleaseStatus>().notNull().default('planned'),
		targetDate: text('target_date'),
		releasedAt: timestamp('released_at'),
		createdById: integer('created_by_id').references(() => users.id),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now)
	},
	(t) => [
		index('changelog_entries_project_idx').on(t.projectId, t.releaseDate),
		// Status is validated by the release service (adding a CHECK would require a table rebuild).
		index('changelog_entries_project_status_idx').on(t.projectId, t.status)
	]
);
export const releases = changelogEntries;

export const milestones = sqliteTable(
	'milestones',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'restrict' }),
		name: text('name').notNull(),
		description: text('description'),
		targetDate: text('target_date'),
		status: text('status').$type<MilestoneStatus>().notNull().default('open'),
		completedAt: timestamp('completed_at'),
		createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now)
	},
	(t) => [
		index('milestones_project_status_idx').on(t.projectId, t.status),
		check('milestones_status_check', sql`${t.status} in ('open','completed','archived')`)
	]
);

/** Stored, validated ticket list definition: a normalised query string and visible columns. */
export interface SavedViewDefinition {
	query: string;
	columns: TicketColumn[];
}

export const savedViews = sqliteTable(
	'saved_views',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		/** Personal views belong to a user; shared project views have no owner. */
		ownerId: integer('owner_id').references(() => users.id, { onDelete: 'cascade' }),
		createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		definition: text('definition', { mode: 'json' }).$type<SavedViewDefinition>().notNull(),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now)
	},
	(t) => [index('saved_views_project_owner_idx').on(t.projectId, t.ownerId, t.position)]
);

/** History of project-level objects (releases, milestones, shared views). */
export const projectActivity = sqliteTable(
	'project_activity',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
		subjectType: text('subject_type').$type<'release' | 'milestone' | 'view'>().notNull(),
		subjectId: integer('subject_id').notNull(),
		type: text('type').notNull(),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		index('project_activity_subject_idx').on(t.projectId, t.subjectType, t.subjectId, t.createdAt)
	]
);

export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		actorId: integer('actor_id').references(() => users.id),
		action: text('action').notNull(),
		targetType: text('target_type'),
		targetId: text('target_id'),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
		ipAddress: text('ip_address'),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		index('audit_logs_created_idx').on(t.createdAt),
		index('audit_logs_action_idx').on(t.action)
	]
);

// ── Phase 2 ─────────────────────────────────────────────────────────────────

export const widgetSettings = sqliteTable('widget_settings', {
	projectId: integer('project_id')
		.primaryKey()
		.references(() => projects.id, { onDelete: 'cascade' }),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
	buttonLabel: text('button_label').notNull().default('Feedback'),
	position: text('position').$type<WidgetPosition>().notNull().default('bottom-right'),
	accentColor: text('accent_color').notNull().default('#6c68ee'),
	defaultType: text('default_type').$type<TicketType>().notNull().default('bug'),
	screenshotsEnabled: integer('screenshots_enabled', { mode: 'boolean' }).notNull().default(true),
	collectContext: integer('collect_context', { mode: 'boolean' }).notNull().default(true),
	lastSeenOrigin: text('last_seen_origin'),
	lastSeenAt: timestamp('last_seen_at'),
	updatedAt: timestamp('updated_at').notNull().default(now)
});

export const widgetAllowedOrigins = sqliteTable(
	'widget_allowed_origins',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		/** Normalised origin, e.g. https://spool.example.com (scheme + host + port). */
		origin: text('origin').notNull(),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [uniqueIndex('widget_allowed_origins_unique').on(t.projectId, t.origin)]
);

/** Short-lived, project-scoped bearer tokens for the widget iframe (no third-party cookies). */
export const widgetTokens = sqliteTable(
	'widget_tokens',
	{
		id: text('id').primaryKey(), // sha256 of the token
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		origin: text('origin').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		index('widget_tokens_user_idx').on(t.userId),
		index('widget_tokens_expires_idx').on(t.expiresAt)
	]
);

export const ticketTemplates = sqliteTable(
	'ticket_templates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: integer('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		type: text('type').$type<TicketType>().notNull(),
		name: text('name').notNull(),
		description: text('description'),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
		/** Incremented on every change; snapshots on tickets record the version used. */
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at').notNull().default(now),
		updatedAt: timestamp('updated_at').notNull().default(now),
		/** Soft delete: historical responses keep their own snapshot either way. */
		deletedAt: timestamp('deleted_at')
	},
	(t) => [
		index('ticket_templates_project_idx').on(t.projectId, t.type),
		check(
			'ticket_templates_type_check',
			sql`${t.type} in ('bug','feature','improvement','feedback')`
		)
	]
);

export const ticketTemplateFields = sqliteTable(
	'ticket_template_fields',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		templateId: integer('template_id')
			.notNull()
			.references(() => ticketTemplates.id, { onDelete: 'cascade' }),
		/** Stable identifier used as the form field name (survives label changes). */
		key: text('key').notNull(),
		kind: text('kind').$type<TemplateFieldKind>().notNull(),
		label: text('label').notNull(),
		help: text('help'),
		placeholder: text('placeholder'),
		required: integer('required', { mode: 'boolean' }).notNull().default(false),
		options: text('options', { mode: 'json' }).$type<string[]>().notNull().default([]),
		position: integer('position').notNull().default(0)
	},
	(t) => [
		uniqueIndex('ticket_template_fields_key_unique').on(t.templateId, t.key),
		check(
			'ticket_template_fields_kind_check',
			sql`${t.kind} in ('short_text','long_text','select','checkbox','url')`
		)
	]
);

/** Answers to template questions with a full snapshot of the questions as they were asked. */
export const ticketTemplateResponses = sqliteTable('ticket_template_responses', {
	ticketId: integer('ticket_id')
		.primaryKey()
		.references(() => tickets.id, { onDelete: 'cascade' }),
	templateId: integer('template_id').references(() => ticketTemplates.id, { onDelete: 'set null' }),
	templateName: text('template_name').notNull(),
	templateVersion: integer('template_version').notNull(),
	answers: text('answers', { mode: 'json' }).$type<TemplateAnswer[]>().notNull().default([]),
	createdAt: timestamp('created_at').notNull().default(now),
	updatedAt: timestamp('updated_at').notNull().default(now)
});

export const ticketRelationships = sqliteTable(
	'ticket_relationships',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** For 'blocks': source blocks target. For 'relates': stored with source < target. */
		sourceTicketId: integer('source_ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'cascade' }),
		targetTicketId: integer('target_ticket_id')
			.notNull()
			.references(() => tickets.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<RelationKind>().notNull(),
		createdById: integer('created_by_id').references(() => users.id),
		createdAt: timestamp('created_at').notNull().default(now)
	},
	(t) => [
		uniqueIndex('ticket_relationships_unique').on(t.sourceTicketId, t.targetTicketId, t.kind),
		index('ticket_relationships_target_idx').on(t.targetTicketId),
		check('ticket_relationships_kind_check', sql`${t.kind} in ('relates','blocks')`),
		check('ticket_relationships_no_self', sql`${t.sourceTicketId} <> ${t.targetTicketId}`)
	]
);

export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt: timestamp('updated_at').notNull().default(now)
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketComment = typeof ticketComments.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type Release = ChangelogEntry;
export type Milestone = typeof milestones.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type TicketLabel = typeof ticketLabels.$inferSelect;
export type WidgetSettings = typeof widgetSettings.$inferSelect;
export type TicketTemplate = typeof ticketTemplates.$inferSelect;
export type TicketTemplateField = typeof ticketTemplateFields.$inferSelect;
export type TicketRelationship = typeof ticketRelationships.$inferSelect;
