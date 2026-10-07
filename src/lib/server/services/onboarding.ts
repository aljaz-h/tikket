import { count, isNotNull, or } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { effectiveSmtp } from '../email/config';
import { getFlag, setFlag } from '../settings';

/**
 * First-run setup checklist for administrators (v0.7): a short, dismissible list whose items tick
 * themselves off from the instance's state. No wizard, nothing required.
 */

export interface ChecklistItem {
	id: string;
	label: string;
	hint: string;
	href: string;
	done: boolean;
	optional?: boolean;
}

const FLAG = 'setup_checklist_dismissed';

export function setupChecklist(firstProjectKey: string | null): ChecklistItem[] | null {
	if (getFlag(FLAG) === true) return null;
	const db = getDb();
	const n = (q: { n: number } | undefined) => (q?.n ?? 0) > 0;
	const projects = n(db.select({ n: count() }).from(schema.projects).get());
	const branded = n(
		db
			.select({ n: count() })
			.from(schema.projects)
			.where(or(isNotNull(schema.projects.logoId), isNotNull(schema.projects.icon)))
			.get()
	);
	const withUrl = n(
		db.select({ n: count() }).from(schema.projects).where(isNotNull(schema.projects.url)).get()
	);
	const users = (db.select({ n: count() }).from(schema.users).get()?.n ?? 0) > 1;
	const invited = users || n(db.select({ n: count() }).from(schema.invitations).get());
	const tickets = n(db.select({ n: count() }).from(schema.tickets).get());
	const integrations =
		n(db.select({ n: count() }).from(schema.projectHooks).get()) ||
		n(db.select({ n: count() }).from(schema.githubConnections).get());
	const settings = firstProjectKey
		? `/p/${firstProjectKey.toLowerCase()}/settings`
		: '/projects/new';
	const items: ChecklistItem[] = [
		{
			id: 'project',
			label: 'Create your first project',
			hint: 'A product, website or app you collect feedback for.',
			href: '/projects/new',
			done: projects
		},
		{
			id: 'logo',
			label: 'Add a project logo',
			hint: 'Helps people recognise the project.',
			href: settings,
			done: branded
		},
		{
			id: 'url',
			label: 'Set the project URL',
			hint: 'Links tickets to the website they are about.',
			href: settings,
			done: withUrl
		},
		{
			id: 'invite',
			label: 'Invite people',
			hint: 'Teammates and the users you want feedback from.',
			href: '/admin/invitations',
			done: invited
		},
		{
			id: 'ticket',
			label: 'Create the first ticket',
			hint: 'Try the flow your users will see.',
			href: '/new',
			done: tickets
		},
		{
			id: 'email',
			label: 'Configure email',
			hint: 'Notifications and password resets by email.',
			href: '/admin/email',
			done: !!effectiveSmtp(),
			optional: true
		},
		{
			id: 'integrations',
			label: 'Connect integrations',
			hint: 'Discord, webhooks or GitHub.',
			href: settings.endsWith('/settings') ? `${settings}/integrations` : settings,
			done: integrations,
			optional: true
		}
	];
	return items;
}

export function dismissChecklist() {
	setFlag(FLAG, true);
}
