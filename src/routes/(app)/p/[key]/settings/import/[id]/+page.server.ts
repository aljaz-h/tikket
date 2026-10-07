import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import {
	confirmImport,
	CSV_FIELD_LABELS,
	CSV_FIELDS,
	DEFAULT_OPTIONS,
	getImport,
	reviewImport,
	updateImportOptions,
	type CsvMapping,
	type ImportOptions
} from '$lib/server/services/import';
import { ServiceError } from '$lib/server/services/users';
import type { Actions, PageServerLoad } from './$types';

function load_(locals: App.Locals, key: string, id: string) {
	const access = requireProject(locals.user, key, 'owner');
	try {
		return { access, row: getImport(access, id) };
	} catch (err) {
		if (err instanceof ServiceError) error(404, 'Import not found');
		throw err;
	}
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const { access, row } = load_(locals, params.key, params.id);
	const options = { ...DEFAULT_OPTIONS, ...(row.options as Partial<ImportOptions>) };
	const payload = row.payload as { kind: string; headers?: string[]; rows?: string[][] } | null;
	return {
		title: `Import ${row.fileName} · Settings · ${access.project.name}`,
		imp: {
			id: row.id,
			fileName: row.fileName,
			format: row.format,
			status: row.status,
			result: row.result,
			error: row.error,
			createdAt: row.createdAt,
			completedAt: row.completedAt
		},
		options,
		csv:
			row.status === 'review' && payload?.kind === 'csv'
				? {
						headers: payload.headers ?? [],
						sample: (payload.rows ?? []).slice(0, 3),
						fields: CSV_FIELDS.map((f) => ({ field: f, label: CSV_FIELD_LABELS[f] }))
					}
				: null,
		review: row.status === 'review' ? reviewImport(access, row) : null
	};
};

function readOptions(form: FormData): Partial<ImportOptions> {
	const options: Partial<ImportOptions> = {
		mapUsers: form.get('mapUsers') === 'on',
		keepNumbers: form.get('keepNumbers') === 'on',
		importComments: form.get('importComments') === 'on',
		createMissing: form.get('createMissing') === 'on'
	};
	if (form.has('map_title')) {
		const mapping = {} as CsvMapping;
		for (const f of CSV_FIELDS) {
			const v = Number(form.get(`map_${f}`) ?? -1);
			mapping[f] = Number.isInteger(v) ? v : -1;
		}
		options.mapping = mapping;
	}
	return options;
}

export const actions: Actions = {
	options: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access } = load_({ ...locals, user }, params.key, params.id);
		try {
			updateImportOptions(access, params.id, readOptions(await request.formData()));
		} catch (err) {
			return handleServiceError(err);
		}
		return { updated: true };
	},
	confirm: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access } = load_({ ...locals, user }, params.key, params.id);
		try {
			// The options shown on the page are saved first, so what was reviewed is what runs.
			updateImportOptions(access, params.id, readOptions(await request.formData()));
		} catch (err) {
			if (!(err instanceof ServiceError && err.message.includes('already run')))
				return handleServiceError(err);
		}
		try {
			const { result } = confirmImport(user.id, access, params.id, locals.clientIp);
			return { imported: result };
		} catch (err) {
			return handleServiceError(err);
		}
	}
};
