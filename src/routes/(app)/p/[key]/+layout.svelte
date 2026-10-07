<script lang="ts">
	import TabNav from '$lib/components/ui/tab-nav.svelte';
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Lock from '@lucide/svelte/icons/lock';
	import Archive from '@lucide/svelte/icons/archive';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { projectPath } from '$lib/shared/format';

	let { children, data } = $props();
	const base = $derived(projectPath(data.project.key));
	const tabs = $derived([
		{ href: base, label: 'Overview', exact: true },
		{ href: `${base}/tickets`, label: 'Tickets' },
		{ href: `${base}/roadmap`, label: 'Roadmap' },
		{ href: `${base}/changelog`, label: 'Changelog' },
		// Staff keep read-only access to planning pages in archived projects too.
		...(data.permissions.isStaff ||
		data.permissions.isAdmin ||
		data.permissions.role === 'owner' ||
		data.permissions.role === 'moderator'
			? [
					{ href: `${base}/releases`, label: 'Releases' },
					{ href: `${base}/milestones`, label: 'Milestones' }
				]
			: []),
		...(data.permissions.isOwner ? [{ href: `${base}/settings`, label: 'Settings' }] : [])
	]);
	const isActive = (tab: { href: string; exact?: boolean }) =>
		tab.exact ? page.url.pathname === tab.href : page.url.pathname.startsWith(tab.href);
	const hideHeader = $derived(/\/tickets\/\d+/.test(page.url.pathname));
</script>

{#if !hideHeader}
	<div class="mb-6 grid gap-4">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 items-center gap-3">
				<ProjectIcon project={data.project} size="lg" />
				<div class="min-w-0">
					<h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
						<span class="truncate">{data.project.name}</span>
						{#if data.project.visibility === 'private'}<Lock
								class="size-4 shrink-0 text-muted-foreground"
								aria-label="Private project"
							/>{/if}
					</h1>
					<p class="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
						<span class="font-mono">{data.project.key}</span>
						{#if data.project.url}
							<a
								href={data.project.url}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1 hover:text-foreground"
							>
								{new URL(data.project.url).host}<ExternalLink class="size-3" />
							</a>
						{/if}
					</p>
				</div>
			</div>
			{#if data.permissions.canSubmit}
				<Button href="/new?project={data.project.key}" size="lg"><Plus /> New ticket</Button>
			{/if}
		</div>
		{#if data.permissions.archived}
			<div
				class="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
			>
				<Archive class="size-4" /> This project is archived. Its history is preserved and read-only.
			</div>
		{/if}
		<TabNav label="Project" tabs={tabs.map((t) => ({ ...t, active: isActive(t) }))} />
	</div>
{/if}

{@render children()}
