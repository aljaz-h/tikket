<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Rocket from '@lucide/svelte/icons/rocket';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import { STATUS_META } from '$lib/shared/constants';
	import { projectPath, ticketPath, ticketRef } from '$lib/shared/format';

	let { data, form } = $props();
	const key = $derived(data.project.key);
	let pending = $state(false);
	let detach = $state(false);
	const back = $derived(projectPath(key, `releases/${data.release.id}`));
</script>

<div class="mx-auto grid max-w-4xl gap-6">
	<a
		href={back}
		class="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" /> Back to {data.release.version}</a
	>
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Publish {data.release.version}</h2>
		<p class="text-sm text-muted-foreground">
			Review the tickets before publishing. The release and its completed tickets appear in the
			public changelog, and followers of those tickets are notified once.
		</p>
	</div>

	<FormMessage message={(form?.errors as Record<string, string> | undefined)?.form} />

	<Card class="grid gap-1 p-4 text-sm">
		<p>
			<span class="font-semibold tabular-nums">{data.completed}</span> of {data.tickets.length} tickets
			completed
		</p>
		{#if data.unresolved.length}
			<p class="flex items-center gap-1.5 text-[var(--tone-progress)]">
				<TriangleAlert class="size-4" />
				{data.unresolved.length} ticket{data.unresolved.length === 1 ? ' is' : 's are'} not resolved.
				Publishing does not change their status.
			</p>
		{/if}
	</Card>

	{#if data.tickets.length}
		<ul
			class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
			aria-label="Tickets in this release"
		>
			{#each data.tickets as t (t.id)}
				{@const unresolved = !STATUS_META[t.status].resolved}
				<li class="flex items-center gap-3 px-4 py-2 {unresolved ? 'bg-[var(--internal-bg)]' : ''}">
					<StatusBadge status={t.status} iconOnly />
					<a href={ticketPath(key, t.number)} class="min-w-0 flex-1 hover:underline">
						<span class="font-mono text-xs text-muted-foreground">{ticketRef(key, t.number)}</span>
						<span class="[overflow-wrap:anywhere]">{t.title}</span>
					</a>
					<span
						class="text-xs {unresolved
							? 'font-medium text-[var(--internal-fg)]'
							: 'text-muted-foreground'}">{STATUS_META[t.status].label}</span
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-muted-foreground">
			This release has no tickets. You can still publish its notes.
		</p>
	{/if}

	{#if data.release.summaryHtml}
		<Card class="grid gap-2 p-4">
			<h3 class="text-sm font-semibold">Release notes</h3>
			<RichText html={data.release.summaryHtml} class="text-sm" />
		</Card>
	{/if}

	<form
		method="POST"
		class="grid gap-4"
		use:enhance={() => {
			pending = true;
			return async ({ result, update }) => {
				pending = false;
				if (result.type === 'redirect') toast.success(`${data.release.version} published`);
				await update();
			};
		}}
	>
		{#if data.unresolved.length}
			<label class="flex items-start gap-2 text-sm">
				<Checkbox name="detach" bind:checked={detach} class="mt-0.5" />
				<span
					>Move the {data.unresolved.length} unresolved ticket{data.unresolved.length === 1
						? ''
						: 's'} out of this release (they keep their status and can be planned again).</span
				>
			</label>
		{/if}
		<div class="flex flex-wrap justify-end gap-2">
			<Button href={back} variant="ghost">Cancel</Button>
			<Button type="submit" loading={pending} disabled={data.archived}
				><Rocket /> Publish {data.release.version}</Button
			>
		</div>
	</form>
</div>
