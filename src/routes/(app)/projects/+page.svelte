<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import Globe from '@lucide/svelte/icons/globe';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import { PROJECT_ROLE_META } from '$lib/shared/constants';
	import { projectPath } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { data } = $props();
</script>

<div class="grid gap-6">
	<PageHeader
		title="Projects"
		description="Every project you can access. Pick one to browse tickets or report something new."
	>
		{#snippet actions()}
			{#if data.canCreateProjects}<Button href="/projects/new"><Plus /> New project</Button>{/if}
		{/snippet}
	</PageHeader>

	<nav class="flex gap-1 border-b border-border" aria-label="Project filter">
		{#each [{ label: 'Active', href: '/projects', active: !data.showArchived }, { label: 'Archived', href: '/projects?archived=1', active: data.showArchived }] as tab (tab.label)}
			<a
				href={tab.href}
				aria-current={tab.active ? 'page' : undefined}
				class={cn(
					'-mb-px border-b-2 px-3 py-2 text-sm',
					tab.active
						? 'border-primary font-medium text-foreground'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				)}>{tab.label}</a
			>
		{/each}
	</nav>

	{#if data.projects.length}
		<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
			{#each data.projects as project (project.key)}
				<li class="relative flex items-center gap-4 px-4 py-3.5 hover:bg-hover">
					<ProjectIcon {project} size="md" />
					<div class="min-w-0 flex-1">
						<a href={projectPath(project.key)} class="font-medium after:absolute after:inset-0"
							>{project.name}</a
						>
						<p class="truncate text-sm text-muted-foreground">{project.description ?? ''}</p>
					</div>
					<div class="hidden items-center gap-2 sm:flex">
						{#if project.role}<Badge>{PROJECT_ROLE_META[project.role].label}</Badge>{/if}
						<Badge>
							{#if project.visibility === 'private'}<Lock class="size-3" /> Private{:else}<Globe
									class="size-3"
								/> Public{/if}
						</Badge>
					</div>
					<div class="w-20 text-right text-sm">
						<span class="font-medium tabular-nums">{project.openCount}</span>
						<span class="text-muted-foreground">open</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<EmptyState
			icon={FolderKanban}
			title={data.showArchived ? 'No archived projects' : 'No projects yet'}
			description={data.showArchived ? undefined : 'Projects you are invited to will appear here.'}
		>
			{#if data.canCreateProjects && !data.showArchived}<Button href="/projects/new"
					><Plus /> Create project</Button
				>{/if}
		</EmptyState>
	{/if}
</div>
