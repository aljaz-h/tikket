import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import {
	projectCsvStream,
	projectJsonStream,
	recordExport,
	requireExporter,
	type ExportScope
} from '$lib/server/services/export';
import { ServiceError } from '$lib/server/services/users';
import type { RequestHandler } from './$types';

/** Streams a project export. Owners and administrators only; every export is audit-logged. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Please sign in to continue');
	const access = requireProject(locals.user, params.key, 'view');
	try {
		requireExporter(access);
	} catch (err) {
		if (err instanceof ServiceError) error(403, err.message);
		throw err;
	}
	const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
	const scope: ExportScope = url.searchParams.get('scope') === 'staff' ? 'staff' : 'standard';
	if (format === 'csv' && scope === 'staff') error(400, 'The CSV export has no staff scope');
	recordExport(locals.user.id, access.project, format, scope, locals.clientIp);
	const date = new Date().toISOString().slice(0, 10);
	const name = `${access.project.key.toLowerCase()}-${scope === 'staff' ? 'staff-export' : 'export'}-${date}.${format}`;
	return new Response(
		format === 'csv' ? projectCsvStream(access.project) : projectJsonStream(access.project, scope),
		{
			headers: {
				'content-type':
					format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${name}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		}
	);
};
