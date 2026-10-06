import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
	WIDGET_POSITIONS,
	TICKET_TYPES,
	type TicketType,
	type WidgetPosition
} from '../../shared/constants';
import { normalizeOrigin } from '../../shared/widget';
import { DEFAULT_ACCENT } from '../../shared/color';
import { accessForProject, findProjectByKey, type ProjectAccess } from '../authz';
import { randomToken, sha256 } from '../auth/tokens';
import { getDb, schema } from '../db';
import type { Project, WidgetSettings } from '../db/schema';
import { audit } from './audit';
import { ServiceError } from './users';

export const WIDGET_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export interface WidgetConfig {
	enabled: boolean;
	buttonLabel: string;
	position: WidgetPosition;
	accentColor: string;
	defaultType: TicketType;
	screenshotsEnabled: boolean;
	collectContext: boolean;
	lastSeenOrigin: string | null;
	lastSeenAt: Date | null;
}

const DEFAULTS: WidgetConfig = {
	enabled: false,
	buttonLabel: 'Feedback',
	position: 'bottom-right',
	accentColor: DEFAULT_ACCENT,
	defaultType: 'bug',
	screenshotsEnabled: true,
	collectContext: true,
	lastSeenOrigin: null,
	lastSeenAt: null
};

export function getWidgetConfig(projectId: number): WidgetConfig {
	const row = getDb()
		.select()
		.from(schema.widgetSettings)
		.where(eq(schema.widgetSettings.projectId, projectId))
		.get();
	if (!row) return { ...DEFAULTS };
	const { projectId: _p, updatedAt: _u, ...rest } = row as WidgetSettings;
	return rest;
}

export function listAllowedOrigins(projectId: number): string[] {
	return getDb()
		.select({ origin: schema.widgetAllowedOrigins.origin })
		.from(schema.widgetAllowedOrigins)
		.where(eq(schema.widgetAllowedOrigins.projectId, projectId))
		.orderBy(asc(schema.widgetAllowedOrigins.origin))
		.all()
		.map((r) => r.origin);
}

export function isOriginAllowed(projectId: number, origin: string | null | undefined): boolean {
	const normalized = origin ? normalizeOrigin(origin) : null;
	if (!normalized || normalized !== origin) return false;
	return listAllowedOrigins(projectId).includes(normalized);
}

export interface WidgetSettingsInput {
	enabled: boolean;
	buttonLabel: string;
	position: WidgetPosition;
	accentColor: string;
	defaultType: TicketType;
	screenshotsEnabled: boolean;
	collectContext: boolean;
	origins: string[];
}

/** Parses the textarea of allowed origins; returns normalised origins and the invalid lines. */
export function parseOriginList(text: string): { origins: string[]; invalid: string[] } {
	const origins = new Set<string>();
	const invalid: string[] = [];
	for (const line of text
		.split(/[\n,]+/)
		.map((l) => l.trim())
		.filter(Boolean)) {
		const o = normalizeOrigin(line);
		if (o) origins.add(o);
		else invalid.push(line);
	}
	return { origins: [...origins].slice(0, 50), invalid };
}

export function saveWidgetSettings(
	actorId: number,
	project: Project,
	input: WidgetSettingsInput,
	ip: string | null
) {
	if (!WIDGET_POSITIONS.includes(input.position))
		throw new ServiceError('Invalid position', 'position');
	if (!TICKET_TYPES.includes(input.defaultType))
		throw new ServiceError('Invalid ticket type', 'defaultType');
	if (!/^#[0-9a-f]{6}$/i.test(input.accentColor))
		throw new ServiceError('Use a hex colour like #b8f779', 'accentColor');
	if (input.enabled && !input.origins.length)
		throw new ServiceError('Add at least one website origin before enabling the widget', 'origins');
	const values = {
		enabled: input.enabled,
		buttonLabel: input.buttonLabel.trim().slice(0, 30) || 'Feedback',
		position: input.position,
		accentColor: input.accentColor.toLowerCase(),
		defaultType: input.defaultType,
		screenshotsEnabled: input.screenshotsEnabled,
		collectContext: input.collectContext,
		updatedAt: new Date()
	};
	getDb().transaction((tx) => {
		tx.insert(schema.widgetSettings)
			.values({ projectId: project.id, ...values })
			.onConflictDoUpdate({ target: schema.widgetSettings.projectId, set: values })
			.run();
		tx.delete(schema.widgetAllowedOrigins)
			.where(eq(schema.widgetAllowedOrigins.projectId, project.id))
			.run();
		if (input.origins.length)
			tx.insert(schema.widgetAllowedOrigins)
				.values(input.origins.map((origin) => ({ projectId: project.id, origin })))
				.run();
		// Origins that are no longer allowed lose their tokens immediately.
		const tokens = tx
			.select()
			.from(schema.widgetTokens)
			.where(eq(schema.widgetTokens.projectId, project.id))
			.all();
		for (const t of tokens)
			if (!input.enabled || !input.origins.includes(t.origin))
				tx.delete(schema.widgetTokens).where(eq(schema.widgetTokens.id, t.id)).run();
		audit(
			{
				actorId,
				action: 'widget.updated',
				targetType: 'project',
				targetId: project.id,
				data: { enabled: input.enabled, origins: input.origins },
				ip
			},
			tx
		);
	});
}

/** Records that the loader was seen on an allowed origin (throttled, used as "test connection"). */
export function recordWidgetSeen(projectId: number, origin: string) {
	const cutoff = new Date(Date.now() - 60_000);
	getDb()
		.update(schema.widgetSettings)
		.set({ lastSeenOrigin: origin, lastSeenAt: new Date() })
		.where(
			and(
				eq(schema.widgetSettings.projectId, projectId),
				// Write at most once a minute per project.
				or(isNull(schema.widgetSettings.lastSeenAt), lt(schema.widgetSettings.lastSeenAt, cutoff))
			)
		)
		.run();
}

/** Looks up an enabled widget by project key. Private projects behave exactly like missing ones. */
export function findWidget(key: string): { project: Project; config: WidgetConfig } | null {
	const project = findProjectByKey(key);
	if (!project || project.archivedAt) return null;
	const config = getWidgetConfig(project.id);
	if (!config.enabled) return null;
	return { project, config };
}

/** Issues a widget token after the user explicitly authorised the widget for an allowed origin. */
export function createWidgetToken(
	user: { id: number; role: 'admin' | 'user'; status: 'active' | 'disabled' },
	project: Project,
	origin: string
) {
	const access = accessForProject(user, project);
	if (!access.canSubmit)
		throw new ServiceError('You cannot submit tickets to this project', 'form', 403);
	if (!isOriginAllowed(project.id, origin))
		throw new ServiceError('This website is not allowed to use the widget', 'form', 403);
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + WIDGET_TOKEN_TTL_MS);
	const db = getDb();
	db.delete(schema.widgetTokens).where(lt(schema.widgetTokens.expiresAt, new Date())).run();
	db.insert(schema.widgetTokens)
		.values({ id: sha256(token), userId: user.id, projectId: project.id, origin, expiresAt })
		.run();
	return { token, expiresAt };
}

/**
 * Validates a bearer token for a project. Re-checks the user's status and project permissions on
 * every request, so revoked access takes effect immediately.
 */
export function validateWidgetToken(
	token: string | null,
	project: Project
): {
	user: { id: number; role: 'admin' | 'user'; status: 'active' | 'disabled'; displayName: string };
	access: ProjectAccess;
	origin: string;
} | null {
	if (!token || token.length > 128) return null;
	const row = getDb()
		.select({
			token: schema.widgetTokens,
			user: {
				id: schema.users.id,
				role: schema.users.role,
				status: schema.users.status,
				displayName: schema.users.displayName
			}
		})
		.from(schema.widgetTokens)
		.innerJoin(schema.users, eq(schema.users.id, schema.widgetTokens.userId))
		.where(
			and(
				eq(schema.widgetTokens.id, sha256(token)),
				eq(schema.widgetTokens.projectId, project.id),
				gt(schema.widgetTokens.expiresAt, new Date())
			)
		)
		.get();
	if (!row || row.user.status !== 'active') return null;
	if (!isOriginAllowed(project.id, row.token.origin)) return null;
	const access = accessForProject(row.user, project);
	if (!access.canSubmit) return null;
	return { user: row.user, access, origin: row.token.origin };
}

export function revokeWidgetToken(token: string) {
	getDb()
		.delete(schema.widgetTokens)
		.where(eq(schema.widgetTokens.id, sha256(token)))
		.run();
}

export function bearerToken(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	const m = /^Bearer\s+([\w-]{20,128})$/.exec(header);
	return m ? m[1] : null;
}
