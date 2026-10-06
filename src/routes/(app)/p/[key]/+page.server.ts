import { requireProject } from '$lib/server/authz';
import {
	mostRequested,
	projectAttention,
	projectStats,
	recentlyCompleted,
	roadmap
} from '$lib/server/services/dashboard';
import { activeMilestones } from '$lib/server/services/milestones';
import { listChangelog, upcomingReleases } from '$lib/server/services/releases';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const id = access.project.id;
	const staff = access.isStaff;
	const road = roadmap(id);
	const stats = projectStats(id);
	return {
		title: access.project.name,
		// Everyone: public counts, what's coming, what's done, what people want.
		stats: {
			open: stats.open,
			planned: stats.planned,
			inProgress: stats.inProgress,
			completed: stats.completed
		},
		upcoming: [...road.in_progress.slice(0, 4), ...road.planned.slice(0, 4)],
		recentlyCompleted: recentlyCompleted(id),
		mostRequested: access.project.votingEnabled ? mostRequested(id) : [],
		changelog: listChangelog(id, 2),
		// Staff only: triage counts and planning.
		management: staff
			? {
					unassigned: stats.unassigned,
					highPriority: stats.highPriority,
					awaitingReview: stats.awaitingReview,
					attention: projectAttention(id),
					releases: upcomingReleases(id, 3),
					milestones: activeMilestones(id, 3)
				}
			: null
	};
};
