import type { ProjectAccess } from './authz';

/** The subset of project access that is safe and useful to send to the browser. */
export function clientPermissions(access: ProjectAccess) {
	return {
		role: access.role,
		isAdmin: access.isAdmin,
		archived: access.archived,
		canSubmit: access.canSubmit,
		canComment: access.canComment,
		canVote: access.canVote,
		canAttach: access.canAttach,
		isStaff: access.isStaff && !access.archived,
		isOwner: access.isOwner
	};
}

export function clientProject(access: ProjectAccess) {
	const p = access.project;
	return {
		id: p.id,
		key: p.key,
		name: p.name,
		description: p.description,
		icon: p.icon,
		logoId: p.logoId,
		color: p.color,
		url: p.url,
		visibility: p.visibility,
		allowAnonymousRead: p.allowAnonymousRead,
		submissionPolicy: p.submissionPolicy,
		votingEnabled: p.votingEnabled,
		attachmentsEnabled: p.attachmentsEnabled,
		commentsEnabled: p.commentsEnabled,
		editPolicy: p.editPolicy,
		archivedAt: p.archivedAt
	};
}
