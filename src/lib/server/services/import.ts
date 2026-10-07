import crypto from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
	MILESTONE_STATUSES,
	PRIORITY_META,
	PROJECT_COLORS,
	RELEASE_STATUSES,
	STATUS_META,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES,
	TYPE_META,
	type MilestoneStatus,
	type ReleaseStatus,
	type TicketPriority,
	type TicketStatus,
	type TicketType
} from '../../shared/constants';
import type { ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import { normaliseRichInput } from '../sanitize';
import { audit } from './audit';
import { EXPORT_FORMAT } from './export';
import { addActivity } from './tickets';
import { ServiceError } from './users';

/**
 * Importing tickets into an existing project from a Tikket JSON export or a CSV file.
 *
 * Flow: upload → parse → validate → review (and, for CSV, column mapping) → confirm → import.
 * - Nothing is written before confirmation; the parsed file waits in the `imports` table.
 * - The import runs in one transaction: either every ticket is created or none.
 * - Confirming twice (double click, retry) is harmless: the import id is claimed atomically.
 * - Accounts and secrets are never imported. Reporters, assignees and comment authors are only
 *   matched to existing project members when the owner explicitly enables it; otherwise the
 *   importing owner is recorded, with the original name kept as attribution.
 * - Ticket numbers: kept when requested and free; otherwise a new number is assigned. The
 *   original key is always stored as the ticket's external reference.
 * - All HTML is sanitised exactly like web input; attachments and votes are not imported.
 */

export const IMPORT_LIMITS = {
	bytes: 10 * 1024 * 1024,
	tickets: 5000,
	commentsPerTicket: 500,
	title: 200,
	description: 100_000,
	comment: 50_000,
	labelsPerTicket: 30,
	csvColumns: 100
};

export type ImportFormat = 'tikket-json' | 'csv';

export interface ImportComment {
	author: string | null;
	authorName: string | null;
	internal: boolean;
	body: string;
	format: 'html' | 'text';
	createdAt: string | null;
}

export interface ImportTicket {
	/** 1-based position in the file (CSV: line number) for messages. */
	row: number;
	ref: string | null;
	number: number | null;
	type: string;
	title: string;
	description: string;
	descriptionFormat: 'html' | 'text';
	status: string;
	priority: string;
	resolutionNote: string | null;
	labels: string[];
	release: string | null;
	milestone: string | null;
	reporter: string | null;
	reporterName: string | null;
	assignee: string | null;
	createdAt: string | null;
	completedAt: string | null;
	duplicateOf: string | null;
	relationships: { kind: string; ticket: string }[];
	comments: ImportComment[];
}

interface JsonPayload {
	kind: 'records';
	tickets: ImportTicket[];
	labels: { name: string; color: string }[];
	releases: { version: string; status: string; targetDate: string | null }[];
	milestones: {
		name: string;
		description: string | null;
		status: string;
		targetDate: string | null;
	}[];
}
interface CsvPayload {
	kind: 'csv';
	headers: string[];
	rows: string[][];
}
type Payload = JsonPayload | CsvPayload;

export const CSV_FIELDS = [
	'title',
	'description',
	'type',
	'status',
	'priority',
	'labels',
	'assignee',
	'reporter',
	'release',
	'milestone',
	'created',
	'ref'
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
export const CSV_FIELD_LABELS: Record<CsvField, string> = {
	title: 'Title (required)',
	description: 'Description',
	type: 'Type',
	status: 'Status',
	priority: 'Priority',
	labels: 'Labels',
	assignee: 'Assignee (username)',
	reporter: 'Reporter (username)',
	release: 'Release (version)',
	milestone: 'Milestone (name)',
	created: 'Created date',
	ref: 'Original ID / reference'
};
/** CSV field → column index (or -1 = not imported). */
export type CsvMapping = Record<CsvField, number>;

export interface ImportOptions {
	mapping?: CsvMapping;
	/** Match reporters, assignees and comment authors to project members by username. */
	mapUsers: boolean;
	/** Keep original ticket numbers when they are free. */
	keepNumbers: boolean;
	importComments: boolean;
	/** Create labels, releases and milestones that don't exist yet (else they are dropped). */
	createMissing: boolean;
}
export const DEFAULT_OPTIONS: ImportOptions = {
	mapUsers: false,
	keepNumbers: false,
	importComments: true,
	createMissing: true
};

// ── Parsing ────────────────────────────────────────────────────────────────

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM, ; or , separators). */
export function parseCsv(input: string): string[][] {
	const text = input.replace(/^\uFEFF/, '');
	const firstLine = text.slice(0, text.search(/\r?\n|$/));
	const sep =
		(firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"' && field === '') quoted = true;
		else if (c === sep) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (quoted) throw new ServiceError('The CSV file has an unterminated quoted field', 'file');
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Removes the apostrophe Tikket (and spreadsheets) put before formula-like values. */
const unformula = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const str = (v: unknown, max = 500) =>
	typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : null;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

function fromTikketJson(data: Record<string, unknown>): JsonPayload {
	if (data.format !== EXPORT_FORMAT || !Array.isArray(data.tickets))
		throw new ServiceError(
			'This JSON file is not a Tikket project export (format "tikket-project")',
			'file'
		);
	if (data.tickets.length > IMPORT_LIMITS.tickets)
		throw new ServiceError(`At most ${IMPORT_LIMITS.tickets} tickets per import`, 'file');
	const tickets = (data.tickets as unknown[]).map((raw, i): ImportTicket => {
		const t = isRecord(raw) ? raw : {};
		const person = (p: unknown) =>
			isRecord(p) ? { u: str(p.username, 60), n: str(p.name, 120) } : null;
		const reporter = person(t.reporter);
		const html = str(t.description_html, IMPORT_LIMITS.description * 2);
		const comments = Array.isArray(t.comments) ? t.comments : [];
		return {
			row: i + 1,
			ref: str(t.key, 40),
			number: Number.isInteger(t.number) && (t.number as number) > 0 ? (t.number as number) : null,
			type: str(t.type, 40) ?? '',
			title: str(t.title, 1000) ?? '',
			description: html ?? str(t.description_text, IMPORT_LIMITS.description) ?? '',
			descriptionFormat: html !== null ? 'html' : 'text',
			status: str(t.status, 40) ?? '',
			priority: str(t.priority, 40) ?? '',
			resolutionNote: str(t.resolution_note, 2000),
			labels: Array.isArray(t.labels)
				? t.labels.map((l) => str(l, 60)).filter((l): l is string => !!l)
				: [],
			release: str(t.release, 60),
			milestone: str(t.milestone, 120),
			reporter: reporter?.u ?? null,
			reporterName: reporter?.n ?? reporter?.u ?? null,
			assignee: person(t.assignee)?.u ?? null,
			createdAt: str(t.created_at, 40),
			completedAt: str(t.completed_at, 40),
			duplicateOf: str(t.duplicate_of, 40),
			relationships: Array.isArray(t.relationships)
				? t.relationships
						.filter(isRecord)
						.map((r) => ({ kind: str(r.kind, 20) ?? '', ticket: str(r.ticket, 40) ?? '' }))
				: [],
			comments: comments
				.slice(0, IMPORT_LIMITS.commentsPerTicket)
				.filter(isRecord)
				.filter((c) => !c.deleted)
				.map((c) => {
					const author = person(c.author);
					const body = str(c.body_html, IMPORT_LIMITS.comment * 2);
					return {
						author: author?.u ?? null,
						authorName: author?.n ?? author?.u ?? null,
						internal: c.internal === true,
						body: body ?? str(c.body_text, IMPORT_LIMITS.comment) ?? '',
						format: body !== null ? ('html' as const) : ('text' as const),
						createdAt: str(c.created_at, 40)
					};
				})
		};
	});
	const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
	return {
		kind: 'records',
		tickets,
		labels: list(data.labels).map((l) => ({
			name: str(l.name, 60) ?? '',
			color: str(l.color, 20) ?? ''
		})),
		releases: list(data.releases).map((r) => ({
			version: str(r.version, 60) ?? '',
			status: str(r.status, 20) ?? 'planned',
			targetDate: str(r.target_date, 10)
		})),
		milestones: list(data.milestones).map((m) => ({
			name: str(m.name, 120) ?? '',
			description: str(m.description, 2000),
			status: str(m.status, 20) ?? 'open',
			targetDate: str(m.target_date, 10)
		}))
	};
}

function fromCsv(text: string): CsvPayload {
	const rows = parseCsv(text);
	if (rows.length < 2)
		throw new ServiceError('The CSV file needs a header row and at least one ticket', 'file');
	const [headers, ...body] = rows;
	if (headers.length > IMPORT_LIMITS.csvColumns)
		throw new ServiceError(`At most ${IMPORT_LIMITS.csvColumns} columns`, 'file');
	if (body.length > IMPORT_LIMITS.tickets)
		throw new ServiceError(`At most ${IMPORT_LIMITS.tickets} tickets per import`, 'file');
	return {
		kind: 'csv',
		headers: headers.map((h) => h.trim().slice(0, 100)),
		rows: body.map((r) => r.map((v) => v.slice(0, IMPORT_LIMITS.description)))
	};
}

/** Guesses the column of each field from the header names (Tikket's own CSV export maps fully). */
export function guessMapping(headers: string[]): CsvMapping {
	const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
	const find = (...names: string[]) => norm.findIndex((h) => names.includes(h));
	return {
		title: find('title', 'summary', 'subject', 'name'),
		description: find('description', 'body', 'details', 'descriptiontext'),
		type: find('type', 'tickettype', 'issuetype', 'kind'),
		status: find('status', 'state'),
		priority: find('priority'),
		labels: find('labels', 'label', 'tags'),
		assignee: find('assignee', 'assignedto', 'owner'),
		reporter: find('reporter', 'author', 'createdby', 'submitter'),
		release: find('release', 'version', 'fixversion'),
		milestone: find('milestone'),
		created: find('created', 'createdat', 'createdon', 'date'),
		ref: find('ticketid', 'id', 'key', 'issuekey', 'ref', 'reference')
	};
}

function csvTickets(payload: CsvPayload, mapping: CsvMapping): ImportTicket[] {
	return payload.rows.map((r, i) => {
		const get = (f: CsvField) => {
			const idx = mapping[f];
			return idx >= 0 && idx < r.length ? unformula(r[idx]).trim() : '';
		};
		const ref = get('ref');
		const number = /(\d+)$/.exec(ref)?.[1];
		return {
			row: i + 2,
			ref: ref || null,
			number: number ? Number(number) : null,
			type: get('type'),
			title: get('title'),
			description: get('description'),
			descriptionFormat: 'text',
			status: get('status'),
			priority: get('priority'),
			resolutionNote: null,
			labels: get('labels')
				.split(/[;,|]/)
				.map((l) => l.trim().slice(0, 60))
				.filter(Boolean),
			release: get('release') || null,
			milestone: get('milestone') || null,
			reporter: get('reporter') || null,
			reporterName: get('reporter') || null,
			assignee: get('assignee') || null,
			createdAt: get('created') || null,
			completedAt: null,
			duplicateOf: null,
			relationships: [],
			comments: []
		};
	});
}

// ── Upload ─────────────────────────────────────────────────────────────────

function requireImporter(access: ProjectAccess) {
	if (!access.isOwner) throw new ServiceError('Only project owners can import', 'form', 403);
	if (access.archived) throw new ServiceError('Archived projects cannot import tickets', 'form');
}

/** Parses an uploaded file and stores it for review. Nothing is imported yet. */
export function createImport(
	actorId: number,
	access: ProjectAccess,
	file: { name: string; text: string; size: number }
) {
	requireImporter(access);
	if (file.size > IMPORT_LIMITS.bytes)
		throw new ServiceError('The file is larger than 10 MB', 'file');
	if (!file.text.trim()) throw new ServiceError('The file is empty', 'file');
	const name = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'import';
	let format: ImportFormat;
	let payload: Payload;
	const trimmed = file.text.replace(/^\uFEFF/, '').trimStart();
	if (/\.json$/i.test(name) || trimmed.startsWith('{')) {
		let data: unknown;
		try {
			data = JSON.parse(trimmed);
		} catch {
			throw new ServiceError('The file is not valid JSON', 'file');
		}
		if (!isRecord(data)) throw new ServiceError('The JSON file must contain an object', 'file');
		format = 'tikket-json';
		payload = fromTikketJson(data);
	} else if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) {
		format = 'csv';
		payload = fromCsv(file.text);
	} else throw new ServiceError('Upload a Tikket JSON export (.json) or a CSV file (.csv)', 'file');
	const options: ImportOptions = {
		...DEFAULT_OPTIONS,
		...(payload.kind === 'csv' ? { mapping: guessMapping(payload.headers) } : {})
	};
	const id = crypto.randomBytes(12).toString('base64url');
	getDb()
		.insert(schema.imports)
		.values({
			id,
			projectId: access.project.id,
			createdById: actorId,
			format,
			status: 'review',
			fileName: name,
			payload,
			options: options as unknown as Record<string, unknown>
		})
		.run();
	return id;
}

export function getImport(access: ProjectAccess, id: string) {
	const row = getDb()
		.select()
		.from(schema.imports)
		.where(and(eq(schema.imports.id, id), eq(schema.imports.projectId, access.project.id)))
		.get();
	if (!row) throw new ServiceError('Import not found', 'form', 404);
	return row;
}

export function listImports(projectId: number) {
	return getDb()
		.select({
			id: schema.imports.id,
			format: schema.imports.format,
			status: schema.imports.status,
			fileName: schema.imports.fileName,
			result: schema.imports.result,
			error: schema.imports.error,
			createdAt: schema.imports.createdAt,
			completedAt: schema.imports.completedAt,
			createdBy: schema.users.displayName
		})
		.from(schema.imports)
		.leftJoin(schema.users, eq(schema.users.id, schema.imports.createdById))
		.where(eq(schema.imports.projectId, projectId))
		.orderBy(desc(schema.imports.createdAt))
		.limit(20)
		.all();
}

export function updateImportOptions(
	access: ProjectAccess,
	id: string,
	input: Partial<ImportOptions>
) {
	requireImporter(access);
	const row = getImport(access, id);
	if (row.status !== 'review') throw new ServiceError('This import has already run', 'form');
	const payload = row.payload as Payload;
	const options: ImportOptions = {
		...DEFAULT_OPTIONS,
		...(row.options as Partial<ImportOptions>),
		...input
	};
	if (payload.kind === 'csv') {
		const mapping = { ...(options.mapping ?? guessMapping(payload.headers)) };
		for (const f of CSV_FIELDS) {
			const v = mapping[f];
			if (!Number.isInteger(v) || v < -1 || v >= payload.headers.length) mapping[f] = -1;
		}
		options.mapping = mapping;
	} else delete options.mapping;
	getDb()
		.update(schema.imports)
		.set({ options: options as unknown as Record<string, unknown> })
		.where(eq(schema.imports.id, id))
		.run();
	return options;
}

// ── Validation & review ────────────────────────────────────────────────────

const lookup = <T extends string>(
	values: readonly T[],
	labels: Record<T, { label: string }>,
	raw: string
): T | null => {
	const v = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	if (!v) return null;
	return (
		values.find((x) => x === v) ??
		values.find((x) => labels[x].label.toLowerCase().replace(/[\s-]+/g, '_') === v) ??
		null
	);
};

function validDate(v: string | null) {
	if (!v) return null;
	const d = new Date(v);
	if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 864e5 || d.getFullYear() < 1990)
		return null;
	return d;
}

interface Prepared {
	row: number;
	ref: string | null;
	number: number | null;
	type: TicketType;
	title: string;
	html: string;
	text: string;
	status: TicketStatus;
	priority: TicketPriority;
	resolutionNote: string | null;
	labels: string[];
	release: string | null;
	milestone: string | null;
	reporterId: number | null;
	reporterName: string | null;
	assigneeId: number | null;
	createdAt: Date | null;
	completedAt: Date | null;
	duplicateOf: string | null;
	relationships: { kind: 'relates' | 'blocks' | 'blocked_by'; ticket: string }[];
	comments: {
		authorId: number | null;
		authorName: string | null;
		internal: boolean;
		html: string;
		text: string;
		createdAt: Date | null;
	}[];
}

export interface ImportReview {
	total: number;
	valid: number;
	skipped: { row: number; reason: string }[];
	warnings: string[];
	comments: number;
	newLabels: string[];
	newReleases: string[];
	newMilestones: string[];
	unmatchedUsers: string[];
	keptNumbers: number;
	renumbered: number;
	preview: {
		row: number;
		ref: string | null;
		title: string;
		type: TicketType;
		status: TicketStatus;
		priority: TicketPriority;
		labels: string[];
	}[];
}

function projectMembers(projectId: number) {
	const rows = getDb()
		.select({
			id: schema.users.id,
			username: schema.users.username,
			role: schema.projectMembers.role
		})
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.users.status, 'active')))
		.all();
	return new Map(rows.map((r) => [r.username.toLowerCase(), r]));
}

function prepare(access: ProjectAccess, payload: Payload, options: ImportOptions) {
	const records =
		payload.kind === 'csv'
			? csvTickets(payload, options.mapping ?? guessMapping(payload.headers))
			: payload.tickets;
	const members = options.mapUsers ? projectMembers(access.project.id) : new Map();
	const unmatched = new Set<string>();
	const memberId = (username: string | null, staffOnly = false) => {
		if (!username || !options.mapUsers) return null;
		const m = members.get(username.toLowerCase());
		if (!m || (staffOnly && m.role === 'member')) {
			unmatched.add(username);
			return null;
		}
		return m.id as number;
	};
	const skipped: { row: number; reason: string }[] = [];
	const warnings = new Set<string>();
	const prepared: Prepared[] = [];
	for (const r of records) {
		const title = r.title.replace(/\s+/g, ' ').trim();
		if (title.length < 3) {
			skipped.push({
				row: r.row,
				reason: title ? 'Title is shorter than 3 characters' : 'Missing title'
			});
			continue;
		}
		if (title.length > IMPORT_LIMITS.title)
			warnings.add(`Titles longer than ${IMPORT_LIMITS.title} characters are shortened.`);
		const type = lookup(TICKET_TYPES, TYPE_META, r.type);
		if (r.type && !type) warnings.add(`Unknown type “${r.type.slice(0, 40)}” → Bug.`);
		const status = lookup(TICKET_STATUSES, STATUS_META, r.status);
		if (r.status && !status) warnings.add(`Unknown status “${r.status.slice(0, 40)}” → Open.`);
		const priority = lookup(TICKET_PRIORITIES, PRIORITY_META, r.priority);
		if (r.priority && !priority)
			warnings.add(`Unknown priority “${r.priority.slice(0, 40)}” → Medium.`);
		const rich = normaliseRichInput(
			r.description.slice(0, IMPORT_LIMITS.description),
			r.descriptionFormat
		);
		const created = validDate(r.createdAt);
		if (r.createdAt && !created)
			warnings.add('Some dates were invalid; the import time is used instead.');
		prepared.push({
			row: r.row,
			ref: r.ref,
			number: r.number,
			type: type ?? 'bug',
			title: title.slice(0, IMPORT_LIMITS.title),
			html: rich.html,
			text: rich.text,
			status: status ?? 'open',
			priority: priority ?? 'medium',
			resolutionNote: r.resolutionNote?.trim() || null,
			labels: [...new Map(r.labels.map((l) => [l.toLowerCase(), l.trim()])).values()]
				.filter(Boolean)
				.slice(0, IMPORT_LIMITS.labelsPerTicket),
			release: r.release?.trim() || null,
			milestone: r.milestone?.trim() || null,
			reporterId: memberId(r.reporter),
			reporterName: r.reporterName,
			assigneeId: memberId(r.assignee, true),
			createdAt: created,
			completedAt: validDate(r.completedAt),
			duplicateOf: r.duplicateOf,
			relationships: r.relationships.filter(
				(x): x is Prepared['relationships'][number] =>
					['relates', 'blocks', 'blocked_by'].includes(x.kind) && !!x.ticket
			),
			comments: options.importComments
				? r.comments
						.map((c) => {
							const body = normaliseRichInput(c.body.slice(0, IMPORT_LIMITS.comment * 2), c.format);
							return {
								authorId: memberId(c.author),
								authorName: c.authorName,
								internal: c.internal,
								html: body.html,
								text: body.text,
								createdAt: validDate(c.createdAt)
							};
						})
						.filter((c) => c.text.trim())
				: []
		});
	}
	if (payload.kind === 'csv' && (options.mapping?.title ?? -1) < 0)
		return {
			prepared: [],
			skipped: [{ row: 0, reason: 'Choose the column that holds the title' }],
			warnings: [...warnings],
			unmatched: []
		};
	return { prepared, skipped, warnings: [...warnings], unmatched: [...unmatched] };
}

function existing(projectId: number) {
	const db = getDb();
	return {
		labels: new Map(
			db
				.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
				.from(schema.ticketLabels)
				.where(eq(schema.ticketLabels.projectId, projectId))
				.all()
				.map((l) => [l.name.toLowerCase(), l.id])
		),
		releases: new Map(
			db
				.select({ id: schema.changelogEntries.id, version: schema.changelogEntries.version })
				.from(schema.changelogEntries)
				.where(eq(schema.changelogEntries.projectId, projectId))
				.all()
				.map((r) => [r.version.toLowerCase(), r.id])
		),
		milestones: new Map(
			db
				.select({ id: schema.milestones.id, name: schema.milestones.name })
				.from(schema.milestones)
				.where(eq(schema.milestones.projectId, projectId))
				.all()
				.map((m) => [m.name.toLowerCase(), m.id])
		)
	};
}

/** Which original numbers can be kept: free in the project and unique in the file. */
function numberPlan(projectId: number, prepared: Prepared[], keep: boolean) {
	const kept = new Set<number>();
	if (keep) {
		const wanted = prepared.map((p) => p.number).filter((n): n is number => !!n && n < 1e9);
		const taken = new Set(
			wanted.length
				? getDb()
						.select({ n: schema.tickets.number })
						.from(schema.tickets)
						.where(
							and(
								eq(schema.tickets.projectId, projectId),
								inArray(schema.tickets.number, [...new Set(wanted)])
							)
						)
						.all()
						.map((r) => r.n)
				: []
		);
		const seen = new Set<number>();
		for (const n of wanted) {
			if (!taken.has(n) && !seen.has(n)) kept.add(n);
			seen.add(n);
		}
	}
	return kept;
}

export function reviewImport(
	access: ProjectAccess,
	row: typeof schema.imports.$inferSelect
): ImportReview {
	const payload = row.payload as Payload;
	const options = { ...DEFAULT_OPTIONS, ...(row.options as Partial<ImportOptions>) };
	const { prepared, skipped, warnings, unmatched } = prepare(access, payload, options);
	const have = existing(access.project.id);
	const distinct = (values: (string | null)[], map: Map<string, number>) => [
		...new Map(
			values
				.filter((v): v is string => !!v && !map.has(v.toLowerCase()))
				.map((v) => [v.toLowerCase(), v])
		).values()
	];
	const kept = numberPlan(access.project.id, prepared, options.keepNumbers);
	const keptCount = prepared.filter((p) => p.number && kept.has(p.number)).length;
	const allWarnings = [...warnings];
	if (
		payload.kind === 'records' &&
		payload.tickets.some((t) => t.comments.length) &&
		!options.importComments
	)
		allWarnings.push('Comments are not imported (option off).');
	if (options.mapUsers && unmatched.length)
		allWarnings.push(
			'Some people are not members (or not staff, for assignees) of this project – you are recorded instead, with their name kept.'
		);
	if (!options.mapUsers)
		allWarnings.push(
			'People are not matched: you become the reporter of every imported ticket, with the original name kept in its history.'
		);
	return {
		total: payload.kind === 'csv' ? payload.rows.length : payload.tickets.length,
		valid: prepared.length,
		skipped,
		warnings: allWarnings,
		comments: prepared.reduce((n, p) => n + p.comments.length, 0),
		newLabels: options.createMissing
			? distinct(
					prepared.flatMap((p) => p.labels),
					have.labels
				)
			: [],
		newReleases: options.createMissing
			? distinct(
					prepared.map((p) => p.release),
					have.releases
				)
			: [],
		newMilestones: options.createMissing
			? distinct(
					prepared.map((p) => p.milestone),
					have.milestones
				)
			: [],
		unmatchedUsers: unmatched.slice(0, 50),
		keptNumbers: keptCount,
		renumbered: prepared.length - keptCount,
		preview: prepared.slice(0, 10).map((p) => ({
			row: p.row,
			ref: p.ref,
			title: p.title,
			type: p.type,
			status: p.status,
			priority: p.priority,
			labels: p.labels
		}))
	};
}

// ── Confirm ────────────────────────────────────────────────────────────────

/**
 * Runs a reviewed import. Claims it atomically (review → running), so a repeated confirmation
 * returns the first result instead of importing twice. Everything happens in one transaction.
 */
export function confirmImport(
	actorId: number,
	access: ProjectAccess,
	id: string,
	ip: string | null
) {
	requireImporter(access);
	const db = getDb();
	const claimed = db
		.update(schema.imports)
		.set({ status: 'running' })
		.where(
			and(
				eq(schema.imports.id, id),
				eq(schema.imports.projectId, access.project.id),
				eq(schema.imports.status, 'review')
			)
		)
		.returning()
		.get();
	if (!claimed) {
		const row = getImport(access, id);
		if (row.status === 'completed') return { alreadyDone: true, result: row.result ?? {} };
		throw new ServiceError(
			row.status === 'running'
				? 'This import is already running'
				: 'This import failed – upload the file again',
			'form'
		);
	}
	const options = { ...DEFAULT_OPTIONS, ...(claimed.options as Partial<ImportOptions>) };
	try {
		const { prepared } = prepare(access, claimed.payload as Payload, options);
		if (!prepared.length) throw new ServiceError('Nothing to import: no valid tickets', 'form');
		const result = db.transaction(
			(tx) => apply(tx as unknown as typeof db, actorId, access, claimed, prepared, options),
			{
				behavior: 'immediate'
			}
		);
		db.update(schema.imports)
			.set({ status: 'completed', result, payload: null, completedAt: new Date() })
			.where(eq(schema.imports.id, id))
			.run();
		audit({
			actorId,
			action: 'project.imported',
			targetType: 'project',
			targetId: access.project.id,
			data: { importId: id, format: claimed.format, file: claimed.fileName, ...result },
			ip
		});
		return { alreadyDone: false, result };
	} catch (err) {
		const message =
			err instanceof ServiceError ? err.message : 'The import failed; nothing was imported.';
		if (!(err instanceof ServiceError)) console.error('[tikket] import failed', err);
		db.update(schema.imports)
			.set({ status: 'failed', error: message, payload: null, completedAt: new Date() })
			.where(eq(schema.imports.id, id))
			.run();
		throw new ServiceError(message, 'form');
	}
}

type DB = ReturnType<typeof getDb>;

function apply(
	tx: DB,
	actorId: number,
	access: ProjectAccess,
	imp: typeof schema.imports.$inferSelect,
	prepared: Prepared[],
	options: ImportOptions
) {
	const projectId = access.project.id;
	const have = existing(projectId);
	const payload = imp.payload as Payload;
	const created = { labels: 0, releases: 0, milestones: 0 };

	const labelId = (name: string) => {
		const key = name.toLowerCase();
		if (have.labels.has(key)) return have.labels.get(key)!;
		if (!options.createMissing) return null;
		const fromFile =
			payload.kind === 'records'
				? payload.labels.find((l) => l.name.toLowerCase() === key)
				: undefined;
		const color = (PROJECT_COLORS as readonly string[]).includes(fromFile?.color ?? '')
			? fromFile!.color
			: 'slate';
		const id = tx
			.insert(schema.ticketLabels)
			.values({ projectId, name, color })
			.returning({ id: schema.ticketLabels.id })
			.get().id;
		have.labels.set(key, id);
		created.labels++;
		return id;
	};
	const releaseId = (version: string) => {
		const key = version.toLowerCase();
		if (have.releases.has(key)) return have.releases.get(key)!;
		if (!options.createMissing) return null;
		const meta =
			payload.kind === 'records'
				? payload.releases.find((r) => r.version.toLowerCase() === key)
				: undefined;
		const status = (RELEASE_STATUSES as readonly string[]).includes(meta?.status ?? '')
			? (meta!.status as ReleaseStatus)
			: 'planned';
		const date =
			meta?.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.targetDate) ? meta.targetDate : null;
		const id = tx
			.insert(schema.changelogEntries)
			.values({
				projectId,
				version,
				releaseDate: date ?? new Date().toISOString().slice(0, 10),
				targetDate: date,
				status,
				// Imported releases are never published automatically.
				published: false,
				releasedAt: status === 'released' ? new Date() : null,
				createdById: actorId
			})
			.returning({ id: schema.changelogEntries.id })
			.get().id;
		have.releases.set(key, id);
		created.releases++;
		return id;
	};
	const milestoneId = (name: string) => {
		const key = name.toLowerCase();
		if (have.milestones.has(key)) return have.milestones.get(key)!;
		if (!options.createMissing) return null;
		const meta =
			payload.kind === 'records'
				? payload.milestones.find((m) => m.name.toLowerCase() === key)
				: undefined;
		const status = (MILESTONE_STATUSES as readonly string[]).includes(meta?.status ?? '')
			? (meta!.status as MilestoneStatus)
			: 'open';
		const id = tx
			.insert(schema.milestones)
			.values({
				projectId,
				name,
				description: meta?.description ?? null,
				status,
				targetDate:
					meta?.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.targetDate) ? meta.targetDate : null,
				completedAt: status === 'completed' ? new Date() : null,
				createdById: actorId
			})
			.returning({ id: schema.milestones.id })
			.get().id;
		have.milestones.set(key, id);
		created.milestones++;
		return id;
	};

	const kept = numberPlan(projectId, prepared, options.keepNumbers);
	if (kept.size) {
		const max = Math.max(...kept);
		tx.update(schema.projects)
			.set({ ticketCounter: sql`max(${schema.projects.ticketCounter}, ${max})` })
			.where(eq(schema.projects.id, projectId))
			.run();
	}
	const nextNumber = () =>
		tx
			.update(schema.projects)
			.set({ ticketCounter: sql`${schema.projects.ticketCounter} + 1` })
			.where(eq(schema.projects.id, projectId))
			.returning({ n: schema.projects.ticketCounter })
			.get()!.n;

	/** Original reference (key or number) → new ticket id, for relationships and duplicates. */
	const byRef = new Map<string, { id: number; number: number }>();
	const refKeys = (p: Prepared) =>
		[p.ref, p.number ? String(p.number) : null]
			.filter((x): x is string => !!x)
			.map((x) => x.toUpperCase());
	const now = new Date();
	const createdTickets: { id: number; number: number; p: Prepared }[] = [];
	let commentCount = 0;
	const usedNumbers = new Set<number>();
	for (const p of prepared) {
		const number =
			p.number && kept.has(p.number) && !usedNumbers.has(p.number) ? p.number : nextNumber();
		usedNumbers.add(number);
		const createdAt = p.createdAt ?? now;
		const resolved = STATUS_META[p.status].resolved;
		const status: TicketStatus = p.status === 'duplicate' ? 'declined' : p.status; // fixed below when resolvable
		const ticket = tx
			.insert(schema.tickets)
			.values({
				projectId,
				number,
				type: p.type,
				title: p.title,
				descriptionHtml: p.html,
				descriptionText: p.text,
				context: {},
				reporterId: p.reporterId ?? actorId,
				assigneeId: p.assigneeId,
				status,
				priority: p.priority,
				resolutionNote: p.resolutionNote,
				releaseId: p.release ? releaseId(p.release) : null,
				milestoneId: p.milestone ? milestoneId(p.milestone) : null,
				source: 'import',
				externalRef: p.ref ?? (p.number ? `#${p.number}` : null),
				completedAt: p.status === 'completed' ? (p.completedAt ?? createdAt) : null,
				closedAt: resolved ? (p.completedAt ?? createdAt) : null,
				createdAt,
				updatedAt: createdAt
			})
			.returning({ id: schema.tickets.id })
			.get();
		for (const k of refKeys(p)) if (!byRef.has(k)) byRef.set(k, { id: ticket.id, number });
		createdTickets.push({ id: ticket.id, number, p });
		const labelIds = [...new Set(p.labels.map(labelId).filter((x): x is number => x !== null))];
		if (labelIds.length)
			tx.insert(schema.ticketLabelAssignments)
				.values(labelIds.map((labelId) => ({ ticketId: ticket.id, labelId })))
				.onConflictDoNothing()
				.run();
		tx.insert(schema.ticketFollowers)
			.values({ ticketId: ticket.id, userId: p.reporterId ?? actorId })
			.onConflictDoNothing()
			.run();
		addActivity(tx, ticket.id, actorId, 'created', {
			type: p.type,
			source: 'import',
			importedFrom: p.ref ?? undefined,
			originalReporter: !p.reporterId && p.reporterName ? p.reporterName : undefined
		});
		let publicComments = 0;
		for (const c of p.comments) {
			const at = c.createdAt ?? now;
			tx.insert(schema.ticketComments)
				.values({
					ticketId: ticket.id,
					authorId: c.authorId ?? actorId,
					bodyHtml: c.html,
					bodyText: c.text,
					internal: c.internal,
					meta: c.authorId
						? { imported: { ref: p.ref } }
						: { imported: { author: c.authorName ?? 'Unknown', ref: p.ref } },
					createdAt: at,
					updatedAt: at
				})
				.run();
			if (!c.internal) publicComments++;
		}
		if (publicComments)
			tx.update(schema.tickets)
				.set({ commentCount: publicComments })
				.where(eq(schema.tickets.id, ticket.id))
				.run();
		commentCount += p.comments.length;
	}

	// Second pass: links between imported tickets (references outside the file are dropped).
	const resolve = (ref: string) => {
		const key = ref.toUpperCase();
		return byRef.get(key) ?? byRef.get(/(\d+)$/.exec(key)?.[1] ?? '');
	};
	let links = 0;
	for (const { id, p } of createdTickets) {
		if (p.status === 'duplicate' && p.duplicateOf) {
			const target = resolve(p.duplicateOf);
			if (target && target.id !== id) {
				tx.update(schema.tickets)
					.set({ status: 'duplicate', duplicateOfId: target.id })
					.where(eq(schema.tickets.id, id))
					.run();
			}
		}
		for (const rel of p.relationships) {
			const other = resolve(rel.ticket);
			if (!other || other.id === id) continue;
			// Each link appears on both tickets in an export: store it once, from its source side.
			if (rel.kind === 'blocked_by') continue;
			const [source, target] =
				rel.kind === 'relates' ? [Math.min(id, other.id), Math.max(id, other.id)] : [id, other.id];
			const inserted = tx
				.insert(schema.ticketRelationships)
				.values({
					sourceTicketId: source,
					targetTicketId: target,
					kind: rel.kind,
					createdById: actorId
				})
				.onConflictDoNothing()
				.run();
			links += inserted.changes;
		}
	}

	const numbers = createdTickets.map((t) => t.number).sort((a, b) => a - b);
	return {
		tickets: createdTickets.length,
		comments: commentCount,
		labelsCreated: created.labels,
		releasesCreated: created.releases,
		milestonesCreated: created.milestones,
		relationships: links,
		keptNumbers: prepared.filter((p) => p.number && kept.has(p.number)).length,
		firstNumber: numbers[0] ?? null,
		lastNumber: numbers[numbers.length - 1] ?? null
	};
}

/** Removes reviewed-but-never-confirmed imports after a day (they hold the parsed file). */
export function pruneImports(now = Date.now()) {
	return getDb()
		.delete(schema.imports)
		.where(
			and(eq(schema.imports.status, 'review'), lt(schema.imports.createdAt, new Date(now - 864e5)))
		)
		.run().changes;
}
