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
import { projectBundleStream } from '$lib/server/services/bundle';
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
	const requested = url.searchParams.get('format');
	const format = requested === 'csv' ? 'csv' : requested === 'bundle' ? 'bundle' : 'json';
	const scope: ExportScope = url.searchParams.get('scope') === 'staff' ? 'staff' : 'standard';
	if (format === 'csv' && scope === 'staff') error(400, 'The CSV export has no staff scope');
	recordExport(locals.user.id, access.project, format, scope, locals.clientIp);
	const date = new Date().toISOString().slice(0, 10);
	const ext = format === 'bundle' ? 'zip' : format;
	const name = `${access.project.key.toLowerCase()}-${scope === 'staff' ? 'staff-' : ''}${format === 'bundle' ? 'bundle' : 'export'}-${date}.${ext}`;
	return new Response(
		format === 'csv'
			? projectCsvStream(access.project)
			: format === 'bundle'
				? projectBundleStream(access.project, scope)
				: projectJsonStream(access.project, scope),
		{
			headers: {
				'content-type':
					format === 'csv'
						? 'text/csv; charset=utf-8'
						: format === 'bundle'
							? 'application/zip'
							: 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${name}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		}
	);
};
