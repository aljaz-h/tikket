<script lang="ts">
	import { enhance } from '$app/forms';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import GitCommit from '@lucide/svelte/icons/git-commit-horizontal';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import { cn } from '$lib/utils';

	interface Link {
		id: number;
		kind: 'pull_request' | 'commit' | 'issue';
		ref: string;
		title: string;
		url: string;
		state: string | null;
		author: string | null;
		updatedAt: Date | null;
		createdAt: Date;
	}
	let {
		development,
		canEdit
	}: { development: { repository: string; links: Link[] }; canEdit: boolean } = $props();
	let adding = $state(false);
	const groups = $derived(
		[
			{
				kind: 'pull_request',
				label: 'Pull requests',
				items: development.links.filter((l) => l.kind === 'pull_request')
			},
			{
				kind: 'commit',
				label: 'Commits',
				items: development.links.filter((l) => l.kind === 'commit')
			},
			{ kind: 'issue', label: 'Issues', items: development.links.filter((l) => l.kind === 'issue') }
		].filter((g) => g.items.length)
	);
	const stateClass = (state: string | null) =>
		state === 'merged'
			? 'text-[oklch(0.62_0.17_300)]'
			: state === 'closed'
				? 'text-destructive'
				: 'text-success';
</script>

<Card class="grid gap-3 p-4 text-sm">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-xs font-medium text-muted-foreground">Development</h2>
		{#if canEdit}
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Link a pull request, issue or commit"
				aria-expanded={adding}
				onclick={() => (adding = !adding)}><Plus /></Button
			>
		{/if}
	</div>
	{#if adding}
		<form
			method="POST"
			action="?/addDevLink"
			class="grid gap-2 rounded-lg border border-border bg-muted/50 p-2.5"
			use:enhance={quickSubmit({ success: 'Linked', onSuccess: () => (adding = false) })}
		>
			<Input
				name="reference"
				placeholder="#12, PR 12, a commit SHA or a GitHub link"
				aria-label="Issue, pull request or commit in {development.repository}"
				class="h-8"
				required
			/>
			<p class="text-xs text-muted-foreground">From {development.repository}</p>
			<div class="flex justify-end gap-2">
				<Button size="xs" variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
				<Button size="xs" type="submit">Link</Button>
			</div>
		</form>
	{/if}
	{#each groups as g (g.kind)}
		<div class="grid gap-1.5">
			<h3 class="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
				{g.label}
			</h3>
			<ul class="grid gap-2">
				{#each g.items as l (l.id)}
					<li class="flex items-start gap-2">
						<span class={cn('mt-0.5 shrink-0', l.kind !== 'commit' && stateClass(l.state))}>
							{#if l.kind === 'commit'}<GitCommit class="size-4 text-muted-foreground" />
							{:else if l.kind === 'issue'}<CircleDot class="size-4" />
							{:else if l.state === 'merged'}<GitMerge class="size-4" />
							{:else if l.state === 'closed'}<GitPullRequestClosed class="size-4" />
							{:else}<GitPullRequest class="size-4" />{/if}
						</span>
						<div class="min-w-0 flex-1">
							<a
								href={l.url}
								target="_blank"
								rel="noopener noreferrer"
								class="block [overflow-wrap:anywhere] hover:underline"
							>
								<span class="font-mono text-xs text-muted-foreground"
									>{l.kind === 'commit' ? l.ref.slice(0, 7) : `#${l.ref}`}</span
								>
								{l.title}
							</a>
							<p class="text-xs text-muted-foreground">
								{#if l.state && l.kind !== 'commit'}<span class={stateClass(l.state)}
										>{l.state[0].toUpperCase() + l.state.slice(1)}</span
									>{/if}
								{#if l.author}{l.state && l.kind !== 'commit' ? ' · ' : ''}{l.author}{/if}
								{#if l.updatedAt}· <TimeAgo date={l.updatedAt} />{/if}
							</p>
						</div>
						{#if canEdit}
							<form
								method="POST"
								action="?/removeDevLink"
								use:enhance={quickSubmit({ success: 'Removed' })}
							>
								<input type="hidden" name="linkId" value={l.id} />
								<Button type="submit" variant="subtle" size="icon-xs" aria-label="Remove link"
									><X /></Button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		{#if !adding}
			<p class="text-xs text-muted-foreground">
				Mention this ticket's key in a commit or pull request on {development.repository} to link it here.
			</p>
		{/if}
	{/each}
</Card>
