<script lang="ts">
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import StatusBadge from '../StatusBadge.svelte';
	import TypeBadge from '../TypeBadge.svelte';
	import { quickSubmit } from '../ticket/enhance';
	import Button from '../ui/button.svelte';
	import Dialog from '../ui/dialog.svelte';
	import Input from '../ui/input.svelte';
	import { STATUS_META, type TicketStatus, type TicketType } from '$lib/shared/constants';
	import { ticketRef } from '$lib/shared/format';

	interface Props {
		projectKey: string;
		tickets: {
			number: number;
			title: string;
			type: string;
			status: string;
			/** The milestone or release the ticket is in now (adding it moves it). */
			elsewhere: string | null;
		}[];
		/** "milestone" or "release", for wording. */
		noun: string;
		/** Form action that receives the chosen ticket numbers as repeated `tickets` fields. */
		action: string;
	}
	let { projectKey, tickets, noun, action }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let includeResolved = $state(false);
	let selected = $state<number[]>([]);

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return tickets.filter((t) => {
			if (!includeResolved && STATUS_META[t.status as TicketStatus].resolved) return false;
			if (!q) return true;
			return (
				t.title.toLowerCase().includes(q) ||
				ticketRef(projectKey, t.number).toLowerCase().includes(q) ||
				String(t.number) === q.replace(/^#/, '')
			);
		});
	});
	const hiddenResolved = $derived(
		tickets.filter((t) => STATUS_META[t.status as TicketStatus].resolved).length
	);
	const allShownSelected = $derived(
		shown.length > 0 && shown.every((t) => selected.includes(t.number))
	);

	function toggle(number: number, on: boolean) {
		selected = on ? [...selected, number] : selected.filter((n) => n !== number);
	}
	function toggleAll() {
		const numbers = shown.map((t) => t.number);
		selected = allShownSelected
			? selected.filter((n) => !numbers.includes(n))
			: [...new Set([...selected, ...numbers])];
	}
</script>

<Button type="button" variant="secondary" onclick={() => (open = true)}>
	<Plus /> Choose tickets…
</Button>

<Dialog
	bind:open
	size="lg"
	title="Add tickets to this {noun}"
	description="Pick from the tickets that are not in it yet. Tickets already in another {noun} are moved."
>
	<form
		method="POST"
		{action}
		class="grid gap-3"
		use:enhance={quickSubmit({
			success: `Tickets added`,
			onSuccess: () => {
				open = false;
				selected = [];
				query = '';
			}
		})}
	>
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-0 flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={query}
					placeholder="Search by title or number"
					aria-label="Search tickets"
					class="pl-8"
				/>
			</div>
			{#if hiddenResolved}
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={includeResolved} />
					Include resolved ({hiddenResolved})
				</label>
			{/if}
		</div>

		<div class="flex items-center justify-between text-xs text-muted-foreground">
			<span aria-live="polite">{shown.length} available · {selected.length} selected</span>
			{#if shown.length}
				<button type="button" class="text-link hover:underline" onclick={toggleAll}>
					{allShownSelected ? 'Clear shown' : 'Select all shown'}
				</button>
			{/if}
		</div>

		<ul
			class="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface"
			aria-label="Available tickets"
		>
			{#each shown as t (t.number)}
				<li>
					<label class="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-hover">
						<input
							type="checkbox"
							class="mt-0.5"
							checked={selected.includes(t.number)}
							onchange={(e) => toggle(t.number, e.currentTarget.checked)}
						/>
						<span class="min-w-0 flex-1">
							<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
								<span class="font-mono text-xs text-muted-foreground"
									>{ticketRef(projectKey, t.number)}</span
								>
								<StatusBadge status={t.status as TicketStatus} iconOnly />
								<span class="[overflow-wrap:anywhere]">{t.title}</span>
							</span>
							{#if t.elsewhere}
								<span class="text-xs text-muted-foreground"
									>Now in “{t.elsewhere}” – will be moved</span
								>
							{/if}
						</span>
						<span class="hidden shrink-0 sm:block"><TypeBadge type={t.type as TicketType} /></span>
					</label>
				</li>
			{:else}
				<li class="px-3 py-8 text-center text-sm text-muted-foreground">
					{query
						? 'No tickets match your search.'
						: 'Every ticket is already in this ' + noun + '.'}
				</li>
			{/each}
		</ul>

		{#each selected as n (n)}<input type="hidden" name="tickets" value={n} />{/each}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" disabled={!selected.length}>
				Add {selected.length || ''} ticket{selected.length === 1 ? '' : 's'}
			</Button>
		</div>
	</form>
</Dialog>
