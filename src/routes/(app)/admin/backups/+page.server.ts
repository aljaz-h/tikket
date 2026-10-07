import { adminActor } from '$lib/server/admin';
import { config } from '$lib/server/config';
import { backupFiles, databaseStatus, dirSize, lastBackup } from '$lib/server/ops';
import { encryptionAvailable } from '$lib/server/secrets';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminActor(locals);
	return {
		title: 'Backups',
		last: lastBackup(),
		files: backupFiles(8),
		sizes: {
			data: dirSize(config.dataDir).bytes,
			database: databaseStatus().bytes,
			uploads: dirSize(config.uploadsDir).bytes
		},
		encryption: encryptionAvailable()
	};
};
