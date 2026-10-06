<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Inbox from '@lucide/svelte/icons/inbox';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import Lock from '@lucide/svelte/icons/lock';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TicketList from '$lib/components/TicketList.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { describeActivity } from '$lib/shared/activity';
	import { describeNotification } from '$lib/shared/notifications';
	import { projectPath, ticketPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const firstName = $derived(data.user?.displayName.split(' ')[0] ?? '');
</script>

<div class="grid gap-8">
	<PageHeader
		title={data.user ? `Welcome back, ${firstName}` : 'Projects'}
		description={data.user
			? 'Report a problem, suggest an idea, or check on your requests.'
			: 'Browse public projects.'}
	>
		{#snippet actions()}
			{#if data.user}<Button href="/new" size="lg"><Plus /> New ticket</Button>{/if}
		{/snippet}
	</PageHeader>

	{#if data.welcome}
		<FormMessage
			variant="success"
			message="Tikket is ready. Create your first project to start collecting feedback."
		/>
	{/if}

	{#if data.staff}
		{@const s = data.staff}
		<section aria-labelledby="overview-heading" class="grid gap-4">
			<h2 id="overview-heading" class="text-sm font-semibold">Needs your attention</h2>
			<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
				{#each [{ label: 'Open', value: s.counts.open, status: 'open' }, { label: 'Planned', value: s.counts.planned, status: 'planned' }, { label: 'In progress', value: s.counts.inProgress, status: 'in_progress' }, { label: 'Completed (30 days)', value: s.counts.completed30, status: 'completed' }, { label: 'Unassigned', value: s.counts.unassigned, status: null }] as stat (stat.label)}
					<Card class="p-4">
						<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
							{#if stat.status}<StatusBadge
									status={stat.status as 'open'}
									iconOnly
								/>{/if}{stat.label}
						</p>
						<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{stat.value}</p>
					</Card>
				{/each}
			</div>
			<div class="grid gap-6 xl:grid-cols-3">
				<div class="grid content-start gap-3 xl:col-span-2">
					<h3 class="text-sm font-medium text-muted-foreground">New reports to review</h3>
					{#if s.needsReview.length}
						<TicketList tickets={s.needsReview} showProject label="New reports" />
					{:else}
						<EmptyState
							icon={Inbox}
							title="Inbox zero"
							description="No open reports are waiting for review."
						/>
					{/if}
				</div>
				<div class="grid content-start gap-3">
					<h3 class="text-sm font-medium text-muted-foreground">Most requested</h3>
					<Card class="divide-y divide-border">
						{#each s.mostVoted as t (`${t.projectKey}-${t.number}`)}
							<a
								href={ticketPath(t.projectKey, t.number)}
								class="flex items-center gap-3 px-3 py-2.5 hover:bg-hover"
							>
								<span
									class="flex w-10 shrink-0 flex-col items-center rounded-md border border-border py-0.5 text-xs font-semibold tabular-nums"
								>
									<ArrowBigUp class="size-3.5 text-muted-foreground" />{t.voteCount}
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm">{t.title}</span>
									<span class="font-mono text-xs text-muted-foreground"
										>{ticketRef(t.projectKey, t.number)}</span
									>
								</span>
							</a>
						{:else}
							<p class="px-3 py-6 text-center text-sm text-muted-foreground">No votes yet.</p>
						{/each}
					</Card>
					<h3 class="mt-3 text-sm font-medium text-muted-foreground">Recent activity</h3>
					<Card class="divide-y divide-border">
						{#each s.activity as a (a.id)}
							<a
								href={ticketPath(a.projectKey, a.ticketNumber)}
								class="flex gap-2.5 px-3 py-2.5 hover:bg-hover"
							>
								<UserAvatar
									user={{ displayName: a.actorName ?? 'System', avatarId: a.actorAvatarId }}
									size="sm"
									class="mt-0.5"
								/>
								<span class="min-w-0 flex-1 text-sm">
									<span class="font-medium">{a.actorName ?? 'Someone'}</span>
									{describeActivity(a.type, a.data)}
									<span class="block truncate text-xs text-muted-foreground">
										{ticketRef(a.projectKey, a.ticketNumber)} · {a.ticketTitle} · <TimeAgo
											date={a.createdAt}
										/>
									</span>
								</span>
							</a>
						{:else}
							<p class="px-3 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
						{/each}
					</Card>
				</div>
			</div>
		</section>
	{/if}

	<section aria-labelledby="projects-heading" class="grid gap-3">
		<div class="flex items-center justify-between">
			<h2 id="projects-heading" class="text-sm font-semibold">Projects</h2>
			<a
				href="/projects"
				class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>All projects <ArrowRight class="size-3.5" /></a
			>
		</div>
		{#if data.projects.length}
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each data.projects.slice(0, 9) as project (project.key)}
					<Card
						class="group relative flex flex-col gap-3 p-4 transition-colors hover:border-border-strong"
					>
						<div class="flex items-start gap-3">
							<ProjectIcon {project} size="md" />
							<div class="min-w-0 flex-1">
								<a href={projectPath(project.key)} class="font-medium after:absolute after:inset-0">
									{project.name}
								</a>
								<p class="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
									{project.key}
									{#if project.visibility === 'private'}<Lock
											class="size-3"
											aria-label="Private"
										/>{/if}
								</p>
							</div>
							{#if data.user}
								<Button
									href="/new?project={project.key}"
									size="xs"
									variant="outline"
									class="relative z-10"
								>
									<Plus /> Report
								</Button>
							{/if}
						</div>
						{#if project.description}
							<p class="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
						{/if}
						<p class="mt-auto text-xs text-muted-foreground">
							<span class="font-medium text-foreground tabular-nums">{project.openCount}</span> open
							·
							<span class="tabular-nums">{project.totalCount}</span> total
						</p>
					</Card>
				{/each}
			</div>
		{:else}
			<EmptyState
				icon={FolderPlus}
				title="No projects yet"
				description={data.canCreateProjects
					? 'Create a project to start collecting bug reports and ideas.'
					: 'You have not been added to any projects yet.'}
			>
				{#if data.canCreateProjects}<Button href="/projects/new"><Plus /> Create project</Button
					>{/if}
			</EmptyState>
		{/if}
	</section>

	{#if data.personal}
		<div class="grid gap-8 xl:grid-cols-3">
			<section class="grid content-start gap-3 xl:col-span-2" aria-labelledby="mine-heading">
				<div class="flex items-center justify-between">
					<h2 id="mine-heading" class="text-sm font-semibold">My submissions</h2>
					<a
						href="/my-tickets"
						class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>View all <ArrowRight class="size-3.5" /></a
					>
				</div>
				{#if data.personal.mine.length}
					<TicketList tickets={data.personal.mine} showProject label="My submissions" />
				{:else}
					<EmptyState
						icon={Inbox}
						title="You haven't reported anything yet"
						description="Found a bug or have an idea? It only takes a minute."
					>
						<Button href="/new" variant="secondary"><Plus /> New ticket</Button>
					</EmptyState>
				{/if}

				{#if data.personal.following.length}
					<h2 class="mt-4 text-sm font-semibold">Following</h2>
					<TicketList tickets={data.personal.following} showProject label="Followed tickets" />
				{/if}

				<h2 class="mt-4 text-sm font-semibold">Recently updated</h2>
				{#if data.personal.recentlyUpdated.length}
					<TicketList
						tickets={data.personal.recentlyUpdated}
						showProject
						label="Recently updated"
					/>
				{:else}
					<p class="text-sm text-muted-foreground">Nothing here yet.</p>
				{/if}
			</section>
			<section class="grid content-start gap-3" aria-labelledby="notif-heading">
				<div class="flex items-center justify-between">
					<h2 id="notif-heading" class="text-sm font-semibold">Unread notifications</h2>
					<a
						href="/notifications"
						class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>All <ArrowRight class="size-3.5" /></a
					>
				</div>
				<Card class="divide-y divide-border">
					{#each data.notifications as n (n.id)}
						<a
							href={n.projectKey && n.ticketNumber
								? ticketPath(n.projectKey, n.ticketNumber)
								: '/notifications'}
							class="flex gap-2.5 px-3 py-2.5 hover:bg-hover"
						>
							<UserAvatar
								user={{ displayName: n.actorName ?? '?', avatarId: n.actorAvatarId }}
								size="sm"
								class="mt-0.5"
							/>
							<span class="min-w-0 flex-1 text-sm">
								{describeNotification(n)}
								<span class="block truncate text-xs text-muted-foreground"
									>{n.ticketTitle} · <TimeAgo date={n.createdAt} /></span
								>
							</span>
						</a>
					{:else}
						<p class="px-3 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
					{/each}
				</Card>
			</section>
		</div>
	{/if}
</div>
