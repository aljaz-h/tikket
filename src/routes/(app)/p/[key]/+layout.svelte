<script lang="ts">
	import { page } from '$app/state';
	import Plus from '@lucide/svelte/icons/plus';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Lock from '@lucide/svelte/icons/lock';
	import Archive from '@lucide/svelte/icons/archive';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { projectPath } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { children, data } = $props();
	const base = $derived(projectPath(data.project.key));
	const tabs = $derived([
		{ href: base, label: 'Overview', exact: true },
		{ href: `${base}/tickets`, label: 'Tickets' },
		{ href: `${base}/roadmap`, label: 'Roadmap' },
		{ href: `${base}/changelog`, label: 'Changelog' },
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
		<nav
			class="-mx-4 flex scrollbar-thin gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
			aria-label="Project"
		>
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					aria-current={isActive(tab) ? 'page' : undefined}
					class={cn(
						'-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
						isActive(tab)
							? 'border-primary-border font-medium text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					)}>{tab.label}</a
				>
			{/each}
		</nav>
	</div>
{/if}

{@render children()}
