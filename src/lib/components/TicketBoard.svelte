<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import StatusBadge from './StatusBadge.svelte';
	import TypeBadge from './TypeBadge.svelte';
	import PriorityBadge from './PriorityBadge.svelte';
	import UserAvatar from './UserAvatar.svelte';
	import Dialog from './ui/dialog.svelte';
	import Input from './ui/input.svelte';
	import Button from './ui/button.svelte';
	import { STATUS_META, TICKET_STATUSES, type TicketStatus } from '$lib/shared/constants';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketListRow } from '$lib/server/services/search';
	import { cn } from '$lib/utils';

	interface Props {
		projectKey: string;
		columns: Record<TicketStatus, TicketListRow[]>;
		totals: Record<TicketStatus, number>;
		statuses: TicketStatus[];
		canManage: boolean;
	}
	let { projectKey, columns, totals, statuses, canManage }: Props = $props();

	let dragging = $state<{ number: number; from: TicketStatus } | null>(null);
	let over = $state<TicketStatus | null>(null);
	let busy = $state<number | null>(null);
	let duplicateFor = $state<number | null>(null);
	let duplicateOpen = $state(false);
	let duplicateTarget = $state('');
	let announcement = $state('');

	/** Uses the ticket page's `status` form action – the same server-authorised mutation as everywhere else. */
	async function move(number: number, status: TicketStatus, extra: Record<string, string> = {}) {
		busy = number;
		const body = new FormData();
		body.set('status', status);
		for (const [k, v] of Object.entries(extra)) body.set(k, v);
		try {
			const res = await fetch(`${ticketPath(projectKey, number)}?/status`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true', accept: 'application/json' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'success') {
				announcement = `${ticketRef(projectKey, number)} moved to ${STATUS_META[status].label}`;
				toast.success(announcement);
				await invalidateAll();
			} else if (result.type === 'failure') {
				const errors = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(errors)[0] ?? 'Could not change the status');
			} else toast.error('Could not change the status');
		} finally {
			busy = null;
		}
	}

	function request(number: number, from: TicketStatus, to: TicketStatus) {
		if (from === to) return;
		if (to === 'duplicate') {
			duplicateFor = number;
			duplicateTarget = '';
			duplicateOpen = true;
			return;
		}
		void move(number, to);
	}
</script>

<div class="sr-only" aria-live="polite">{announcement}</div>

<div class="relative -mx-4 scrollbar-thin overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
	<div class="flex min-w-max gap-3">
		{#each statuses as status (status)}
			<section
				aria-label="{STATUS_META[status].label} ({totals[status]})"
				class={cn(
					'flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface-2/60 transition-colors',
					over === status && dragging && 'border-primary bg-primary-soft'
				)}
				ondragover={(e) => {
					if (!dragging) return;
					e.preventDefault();
					over = status;
				}}
				ondragleave={() => (over = over === status ? null : over)}
				ondrop={(e) => {
					e.preventDefault();
					over = null;
					if (dragging) request(dragging.number, dragging.from, status);
					dragging = null;
				}}
			>
				<header class="flex items-center gap-2 px-3 py-2.5">
					<StatusBadge {status} iconOnly />
					<h2 class="text-sm font-medium">{STATUS_META[status].label}</h2>
					<span class="text-xs text-muted-foreground tabular-nums">{totals[status]}</span>
				</header>
				<ul
					class="grid max-h-[calc(100dvh-16rem)] min-h-24 content-start gap-2 overflow-y-auto px-2 pb-2"
				>
					{#each columns[status] as t (t.id)}
						<li
							draggable={canManage}
							ondragstart={(e) => {
								dragging = { number: t.number, from: t.status };
								e.dataTransfer?.setData('text/plain', String(t.number));
							}}
							ondragend={() => {
								dragging = null;
								over = null;
							}}
							class={cn(
								'rounded-lg border border-border bg-surface p-2.5 shadow-card transition-opacity',
								canManage && 'cursor-grab active:cursor-grabbing',
								busy === t.number && 'opacity-50'
							)}
						>
							<a
								href={ticketPath(projectKey, t.number)}
								class="block text-sm font-medium [overflow-wrap:anywhere] hover:underline"
								>{t.title}</a
							>
							{#if t.labels.length}
								<div class="mt-1.5 flex flex-wrap gap-1">
									{#each t.labels as l (l.id)}<span
											class="swatch-bg swatch-{l.color} rounded px-1.5 text-[0.6875rem] font-medium"
											>{l.name}</span
										>{/each}
								</div>
							{/if}
							<div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
								<span class="font-mono">{ticketRef(projectKey, t.number)}</span>
								<TypeBadge type={t.type} iconOnly />
								<PriorityBadge priority={t.priority} iconOnly />
								<span class="ml-auto flex items-center gap-0.5 tabular-nums"
									><ArrowBigUp class="size-3.5" />{t.voteCount}</span
								>
								{#if t.assignee}<UserAvatar user={t.assignee} size="xs" />{/if}
							</div>
							{#if canManage}
								<!-- Keyboard / touch alternative to drag and drop -->
								<label class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
									<span class="sr-only">Status of {ticketRef(projectKey, t.number)}</span>
									<select
										class="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-foreground"
										value={t.status}
										disabled={busy === t.number}
										onchange={(e) => {
											const select = e.currentTarget as HTMLSelectElement;
											const to = select.value as TicketStatus;
											select.value = t.status;
											request(t.number, t.status, to);
										}}
									>
										{#each TICKET_STATUSES as s (s)}<option value={s}>{STATUS_META[s].label}</option
											>{/each}
									</select>
								</label>
							{/if}
						</li>
					{:else}
						<li
							class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
						>
							No tickets
						</li>
					{/each}
					{#if totals[status] > columns[status].length}
						<li class="px-1 text-center text-xs text-muted-foreground">
							+{totals[status] - columns[status].length} more — use the list view
						</li>
					{/if}
				</ul>
			</section>
		{/each}
	</div>
</div>

<Dialog
	bind:open={duplicateOpen}
	title="Mark as duplicate"
	description="Which ticket does this one duplicate? Followers will be subscribed to the original."
	size="sm"
>
	<form
		class="grid gap-3"
		onsubmit={(e) => {
			e.preventDefault();
			if (duplicateFor && duplicateTarget.trim()) {
				duplicateOpen = false;
				void move(duplicateFor, 'duplicate', { duplicateOf: duplicateTarget.trim() });
			}
		}}
	>
		<Input
			bind:value={duplicateTarget}
			placeholder="{projectKey}-12"
			aria-label="Original ticket"
			class="font-mono"
			required
		/>
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (duplicateOpen = false)}>Cancel</Button>
			<Button type="submit">Mark duplicate</Button>
		</div>
	</form>
</Dialog>
