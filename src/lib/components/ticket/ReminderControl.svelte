<script lang="ts">
	import { enhance } from '$app/forms';
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import X from '@lucide/svelte/icons/x';
	import Button from '../ui/button.svelte';
	import Input from '../ui/input.svelte';
	import { quickSubmit } from './enhance';
	import { formatDateTime } from '$lib/shared/format';

	interface Props {
		reminders: { id: number; remindAt: Date; note: string | null }[];
	}
	let { reminders }: Props = $props();
	let open = $state(false);
	const today = new Date().toISOString().slice(0, 10);
	const presets = [
		{ value: 'tomorrow', label: 'Tomorrow' },
		{ value: '3days', label: 'In 3 days' },
		{ value: 'week', label: 'In 1 week' }
	];
	const done = quickSubmit({ success: 'Reminder set', onSuccess: () => (open = false) });
</script>

<div class="grid gap-2">
	<Button
		variant="outline"
		size="sm"
		aria-expanded={open}
		aria-controls="reminder-panel"
		onclick={() => (open = !open)}><AlarmClock /> Remind me</Button
	>
	{#if open}
		<div id="reminder-panel" class="grid gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
			<p class="text-xs text-muted-foreground">
				Only you see it: on that day you get a notification about this ticket (9:00 server time).
			</p>
			<div class="grid grid-cols-3 gap-1.5">
				{#each presets as p (p.value)}
					<form method="POST" action="?/remind" use:enhance={done}>
						<input type="hidden" name="preset" value={p.value} />
						<Button type="submit" variant="secondary" size="xs" class="w-full">{p.label}</Button>
					</form>
				{/each}
			</div>
			<form method="POST" action="?/remind" class="flex items-end gap-1.5" use:enhance={done}>
				<label class="grid min-w-0 flex-1 gap-1 text-xs font-medium">
					Pick a date
					<Input type="date" name="date" min={today} required class="h-8" />
				</label>
				<Button type="submit" size="sm">Set</Button>
			</form>
		</div>
	{/if}
	{#if reminders.length}
		<ul class="grid gap-1" aria-label="Your reminders">
			{#each reminders as r (r.id)}
				<li class="flex items-center justify-between gap-2 text-xs">
					<span class="flex min-w-0 items-center gap-1.5 text-muted-foreground"
						><AlarmClock class="size-3.5 shrink-0" />{formatDateTime(r.remindAt)}</span
					>
					<form
						method="POST"
						action="?/cancelReminder"
						use:enhance={quickSubmit({ success: 'Reminder removed' })}
					>
						<input type="hidden" name="id" value={r.id} />
						<Button
							type="submit"
							variant="ghost"
							size="xs"
							aria-label="Remove reminder for {formatDateTime(r.remindAt)}"><X /></Button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</div>
