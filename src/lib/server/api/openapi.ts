import {
	PAT_SCOPES,
	PROJECT_TOKEN_SCOPES,
	SCOPE_META,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES
} from '../../shared/constants';
import { apiLimits, MAX_LIMIT } from './http';

/**
 * OpenAPI 3.1 description of /api/v1, generated from the same constants the API validates
 * against (statuses, types, priorities, scopes), so the document cannot drift from the enums.
 * The /docs/api page renders the same `ENDPOINTS` list.
 */

export const API_VERSION = '1.0.0';

export interface EndpointDoc {
	method: 'GET' | 'POST' | 'PATCH';
	path: string;
	summary: string;
	description?: string;
	/** Personal token scope / project token scope (null = not available to that kind). */
	scopes: { personal: string | null; project: string | null };
	query?: { name: string; description: string }[];
	body?: string;
	response: string;
	example?: string;
}

const KEY = '{key}';
const NUMBER = '{number}';
const anyScope = 'any scope';

export const ENDPOINTS: EndpointDoc[] = [
	{
		method: 'GET',
		path: '/api/v1/me',
		summary: 'Who the token acts as',
		scopes: { personal: anyScope, project: anyScope },
		response: 'Me'
	},
	{
		method: 'GET',
		path: '/api/v1/projects',
		summary: 'List projects the token can reach',
		description: 'A project token only ever sees its own project.',
		scopes: { personal: 'projects:read', project: anyScope },
		response: 'Project[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}`,
		summary: 'Get a project',
		scopes: { personal: 'projects:read', project: anyScope },
		response: 'Project'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/tickets`,
		summary: 'List tickets (newest first, cursor paginated)',
		scopes: { personal: 'tickets:read', project: 'tickets:read' },
		query: [
			{ name: 'limit', description: `Page size, 1–${MAX_LIMIT} (default 25)` },
			{ name: 'cursor', description: 'meta.next_cursor of the previous page' },
			{ name: 'status', description: `Comma-separated: ${TICKET_STATUSES.join(', ')}` },
			{ name: 'type', description: `Comma-separated: ${TICKET_TYPES.join(', ')}` },
			{ name: 'priority', description: `Comma-separated: ${TICKET_PRIORITIES.join(', ')}` },
			{ name: 'assignee', description: 'Username, or "none"' },
			{ name: 'reporter', description: 'Username' },
			{ name: 'label', description: 'Label name' },
			{ name: 'milestone', description: 'Milestone id or "none" (staff only)' },
			{ name: 'release', description: 'Release id or "none" (staff only)' },
			{ name: 'updated_after', description: 'ISO 8601 timestamp' },
			{ name: 'created_after', description: 'ISO 8601 timestamp' }
		],
		response: 'Ticket[]',
		example: `curl -H "Authorization: Bearer $TIKKET_TOKEN" \\
  "$TIKKET_URL/api/v1/projects/WEB/tickets?status=open,in_progress&limit=50"`
	},
	{
		method: 'POST',
		path: `/api/v1/projects/${KEY}/tickets`,
		summary: 'Create a ticket',
		description:
			'Send an Idempotency-Key header to make retries safe: the same key with the same body returns the original ticket for 24 hours (header Idempotent-Replayed: true); the same key with a different body is rejected.',
		scopes: { personal: 'tickets:write', project: 'tickets:create' },
		body: 'TicketCreate',
		response: 'Ticket (201)',
		example: `curl -X POST -H "Authorization: Bearer $TIKKET_TOKEN" \\
  -H "Content-Type: application/json" -H "Idempotency-Key: build-4711" \\
  -d '{"title":"Nightly build failed","description":"See CI run 4711","type":"bug"}' \\
  "$TIKKET_URL/api/v1/projects/WEB/tickets"`
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/tickets/${NUMBER}`,
		summary: 'Get a ticket (with description)',
		scopes: { personal: 'tickets:read', project: 'tickets:read' },
		response: 'Ticket'
	},
	{
		method: 'PATCH',
		path: `/api/v1/projects/${KEY}/tickets/${NUMBER}`,
		summary: 'Update a ticket',
		description:
			'Applies all fields or none. Uses the same permission checks and workflow rules as the web app (e.g. a status transition the project does not allow is rejected with 422).',
		scopes: { personal: 'tickets:write', project: 'tickets:update' },
		body: 'TicketPatch',
		response: 'Ticket',
		example: `curl -X PATCH -H "Authorization: Bearer $TIKKET_TOKEN" -H "Content-Type: application/json" \\
  -d '{"status":"in_progress","assignee":"alex","labels":["backend"]}' \\
  "$TIKKET_URL/api/v1/projects/WEB/tickets/42"`
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/tickets/${NUMBER}/comments`,
		summary: 'List comments (newest first, cursor paginated)',
		description: 'Internal notes are only included for project staff.',
		scopes: { personal: 'comments:read', project: 'tickets:read' },
		query: [
			{ name: 'limit', description: `Page size, 1–${MAX_LIMIT} (default 25)` },
			{ name: 'cursor', description: 'meta.next_cursor of the previous page' }
		],
		response: 'Comment[]'
	},
	{
		method: 'POST',
		path: `/api/v1/projects/${KEY}/tickets/${NUMBER}/comments`,
		summary: 'Post a comment',
		scopes: { personal: 'comments:write', project: 'comments:create' },
		body: 'CommentCreate',
		response: 'Comment (201)'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/labels`,
		summary: 'List labels',
		scopes: { personal: 'projects:read', project: 'tickets:read' },
		response: 'Label[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/releases`,
		summary: 'List releases',
		description: 'Staff see planned releases too; everyone else only published ones.',
		scopes: { personal: 'projects:read', project: 'releases:read' },
		response: 'Release[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/milestones`,
		summary: 'List milestones (staff only)',
		scopes: { personal: 'projects:read', project: 'milestones:read' },
		response: 'Milestone[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/members`,
		summary: 'List members (staff only, no email addresses)',
		scopes: { personal: 'projects:read', project: null },
		response: 'Member[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/views`,
		summary: 'List saved views (shared + your personal views)',
		scopes: { personal: 'projects:read', project: null },
		response: 'View[]'
	},
	{
		method: 'GET',
		path: `/api/v1/projects/${KEY}/automations`,
		summary: 'List automation rules (staff only, read-only)',
		scopes: { personal: 'projects:read', project: null },
		response: 'Automation[]'
	}
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const dt = { type: 'string', format: 'date-time' };
const ndt = { type: ['string', 'null'], format: 'date-time' };
const person = { type: ['object', 'null'], properties: { username: nstr, name: str } };
const obj = (properties: Record<string, unknown>, required?: string[]) => ({
	type: 'object',
	properties,
	...(required ? { required } : {})
});
const progress = obj({ total: int, completed: int });

const schemas = {
	Error: obj(
		{
			error: obj(
				{ code: str, message: str, details: { type: 'object', additionalProperties: true } },
				['code', 'message']
			)
		},
		['error']
	),
	ListMeta: obj({ count: int, limit: int, next_cursor: nstr }),
	Me: obj({
		user: obj({ username: str, name: str }),
		token: obj({
			kind: { enum: ['personal', 'project'] },
			name: str,
			prefix: str,
			scopes: { type: 'array', items: str }
		}),
		project: { type: ['object', 'null'], properties: { key: str, name: str } }
	}),
	Project: obj({
		key: str,
		name: str,
		description: nstr,
		url: nstr,
		website: nstr,
		visibility: { enum: ['public', 'internal', 'private'] },
		archived: bool,
		settings: obj({ voting_enabled: bool, comments_enabled: bool, attachments_enabled: bool }),
		permissions: obj({ role: nstr, staff: bool, owner: bool, can_submit: bool }),
		created_at: dt
	}),
	Ticket: obj({
		key: { type: 'string', examples: ['WEB-42'] },
		number: int,
		url: nstr,
		type: { enum: [...TICKET_TYPES] },
		title: str,
		status: { enum: [...TICKET_STATUSES] },
		priority: { enum: [...TICKET_PRIORITIES] },
		reporter: person,
		assignee: person,
		labels: { type: 'array', items: str },
		votes: int,
		comment_count: int,
		source: str,
		external_ref: nstr,
		release: {
			type: ['object', 'null'],
			description: 'Staff only',
			properties: { id: int, version: str }
		},
		milestone: {
			type: ['object', 'null'],
			description: 'Staff only',
			properties: { id: int, name: str }
		},
		created_at: dt,
		updated_at: dt,
		completed_at: ndt,
		description_html: { type: 'string', description: 'Single-ticket responses only' },
		description_text: { type: 'string', description: 'Single-ticket responses only' },
		details: { type: 'object', description: 'Single-ticket responses only' },
		resolution_note: nstr
	}),
	TicketCreate: {
		...obj(
			{
				title: { type: 'string', minLength: 3, maxLength: 200 },
				description: { type: 'string', maxLength: 50000, description: 'Plain text' },
				description_html: {
					type: 'string',
					maxLength: 100000,
					description: 'HTML (sanitised); alternative to description'
				},
				type: { enum: [...TICKET_TYPES], default: 'bug' }
			},
			['title']
		),
		additionalProperties: false
	},
	TicketPatch: {
		...obj({
			title: { type: 'string', minLength: 3, maxLength: 200 },
			description: { type: 'string', maxLength: 50000 },
			description_html: { type: 'string', maxLength: 100000 },
			type: { enum: [...TICKET_TYPES] },
			status: { enum: [...TICKET_STATUSES] },
			status_note: {
				type: ['string', 'null'],
				maxLength: 2000,
				description: 'Note for the status change (required by some workflows)'
			},
			duplicate_of: {
				type: 'string',
				description: 'Ticket key or number, required when status is duplicate'
			},
			priority: { enum: [...TICKET_PRIORITIES] },
			assignee: { type: ['string', 'null'], description: 'Username, or null to unassign' },
			labels: {
				type: 'array',
				items: str,
				maxItems: 30,
				description: 'Replaces the labels (existing label names)'
			},
			milestone_id: { type: ['integer', 'null'] },
			release_id: { type: ['integer', 'null'] }
		}),
		additionalProperties: false
	},
	Comment: obj({
		id: int,
		author: person,
		automated: bool,
		internal: { type: 'boolean', description: 'Staff only' },
		body_html: nstr,
		body_text: nstr,
		deleted: bool,
		created_at: dt,
		edited_at: ndt
	}),
	CommentCreate: {
		...obj({
			body: { type: 'string', maxLength: 50000, description: 'Plain text' },
			body_html: { type: 'string', maxLength: 100000 },
			internal: { type: 'boolean', default: false, description: 'Internal note (staff only)' }
		}),
		additionalProperties: false
	},
	Label: obj({ id: int, name: str, color: str }),
	Release: obj({
		id: int,
		version: str,
		status: str,
		target_date: nstr,
		released_at: ndt,
		progress
	}),
	Milestone: obj({
		id: int,
		name: str,
		description: nstr,
		status: str,
		target_date: nstr,
		completed_at: ndt,
		progress
	}),
	Member: obj({ username: str, name: str, role: str }),
	View: obj({
		id: int,
		name: str,
		shared: bool,
		query: str,
		columns: { type: ['array', 'null'], items: str }
	}),
	Automation: obj({
		id: int,
		name: str,
		description: nstr,
		enabled: bool,
		trigger: str,
		trigger_config: { type: 'object' },
		conditions: { type: 'object' },
		actions: { type: 'array', items: { type: 'object' } },
		run_count: int,
		last_run_at: ndt,
		last_error: nstr
	})
};

const errorResponse = (description: string) => ({
	description,
	content: { 'application/json': { schema: ref('Error') } }
});

function responseSchema(response: string) {
	const name = response.replace(/\s*\(\d+\)$/, '');
	const list = name.endsWith('[]');
	const item = ref(list ? name.slice(0, -2) : name);
	return obj({
		data: list ? { type: 'array', items: item } : item,
		meta: list ? ref('ListMeta') : { type: 'object' }
	});
}

const pathParams: Record<string, unknown> = {
	key: { name: 'key', in: 'path', required: true, schema: str, description: 'Project key' },
	number: { name: 'number', in: 'path', required: true, schema: int, description: 'Ticket number' }
};

export function openApiDocument(serverUrl: string | null) {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const e of ENDPOINTS) {
		const status = /\((\d+)\)/.exec(e.response)?.[1] ?? '200';
		const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => pathParams[m[1]]);
		for (const q of e.query ?? [])
			params.push({
				name: q.name,
				in: 'query',
				required: false,
				schema: str,
				description: q.description
			});
		if (e.method === 'POST' && e.body === 'TicketCreate')
			params.push({
				name: 'Idempotency-Key',
				in: 'header',
				required: false,
				schema: { type: 'string', maxLength: 200 },
				description: 'Makes retries safe for 24 hours'
			});
		const scopes = [
			e.scopes.personal
				? `personal token: \`${e.scopes.personal}\``
				: 'not available to personal tokens',
			e.scopes.project
				? `project token: \`${e.scopes.project}\``
				: 'not available to project tokens'
		].join('; ');
		paths[e.path] ??= {};
		paths[e.path][e.method.toLowerCase()] = {
			summary: e.summary,
			description: [e.description, `Scopes – ${scopes}.`].filter(Boolean).join('\n\n'),
			parameters: params,
			...(e.body
				? {
						requestBody: {
							required: true,
							content: { 'application/json': { schema: ref(e.body) } }
						}
					}
				: {}),
			responses: {
				[status]: {
					description: 'Success',
					content: { 'application/json': { schema: responseSchema(e.response) } }
				},
				'400': errorResponse('Invalid parameters'),
				'401': errorResponse('Missing, invalid, expired or revoked token'),
				'403': errorResponse('The token lacks the scope, or the user lacks the permission'),
				'404': errorResponse('Not found (or not visible to this token)'),
				...(e.method !== 'GET' ? { '422': errorResponse('Validation failed') } : {}),
				'429': errorResponse('Rate limited – see Retry-After')
			}
		};
	}
	return {
		openapi: '3.1.0',
		info: {
			title: 'Tikket API',
			version: API_VERSION,
			description: [
				'REST API for Tikket. Authenticate with a personal access token (Account settings → Developer) or a project API token (Project settings → Developer): `Authorization: Bearer <token>`.',
				'Responses are `{ "data": …, "meta": { … } }`; errors are `{ "error": { "code", "message" } }`.',
				`Rate limits per token: ${apiLimits.read} requests/minute, ${apiLimits.write} writes/minute (X-RateLimit-* headers; 429 with Retry-After).`,
				'Versioning: /api/v1 only changes additively (new endpoints, new optional fields, new enum values). Breaking changes will ship as /api/v2, with v1 kept for at least one minor release after v2 appears.'
			].join('\n\n')
		},
		...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
		security: [{ bearer: [] }],
		components: {
			securitySchemes: {
				bearer: {
					type: 'http',
					scheme: 'bearer',
					description: `Personal scopes: ${PAT_SCOPES.join(', ')}. Project scopes: ${PROJECT_TOKEN_SCOPES.join(', ')}.`
				}
			},
			schemas
		},
		paths,
		'x-scopes': SCOPE_META
	};
}
