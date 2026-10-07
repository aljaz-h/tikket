<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import type { Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Send from '@lucide/svelte/icons/send';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Copy from '@lucide/svelte/icons/copy';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from './IntegrationStatus.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { cn } from '$lib/utils';

	interface Delivery {
		id: number;
		event: string;
		eventId: string;
		attempt: number;
		statusCode: number | null;
		durationMs: number;
		success: boolean;
		error: string | null;
		createdAt: Date;
	}
	interface Hook {
		id: number;
		name: string;
		urlHint: string;
		events: string[];
		enabled: boolean;
		lastSuccessAt: Date | null;
		lastFailureAt: Date | null;
		lastError: string | null;
		deliveries: Delivery[];
	}
	interface Props {
		kind: 'discord' | 'webhook';
		hooks: Hook[];
		events: readonly string[];
		eventLabels: Record<string, string>;
		defaultEvents: string[];
		encryptionAvailable: boolean;
		archived: boolean;
		/** Server result of the last action (contains a one-time secret after create/rotate). */
		form: Record<string, unknown> | null | undefined;
		urlLabel: string;
		urlPlaceholder: string;
		urlHint: string;
		noun: string;
		intro?: Snippet;
	}
	let {
		kind,
		hooks,
		events,
		eventLabels,
		defaultEvents,
		encryptionAvailable,
		archived,
		form,
		urlLabel,
		urlPlaceholder,
		urlHint,
		noun,
		intro
	}: Props = $props();

	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let editing = $state<Hook | null>(null);
	let dialogOpen = $state(false);
	let deleting = $state<Hook | null>(null);
	let deleteOpen = $state(false);
	let selected = $state<string[]>([]);
	let enabled = $state(true);
	let busy = $state<string | null>(null);
	let expanded = $state<number | null>(null);
	/** A signing secret is shown once, right after it was created or rotated. */
	let secret = $state<string | null>(null);

	function openCreate() {
		editing = null;
		selected = [...defaultEvents];
		enabled = true;
		dialogOpen = true;
	}
	function openEdit(hook: Hook) {
		editing = hook;
		selected = [...hook.events];
		enabled = hook.enabled;
		dialogOpen = true;
	}
	function toggle(event: string, on: boolean) {
		selected = on ? [...new Set([...selected, event])] : selected.filter((e) => e !== event);
	}
	function status(h: Hook) {
		if (!h.enabled) return { state: 'off', label: 'Disabled' } as const;
		const failed = h.lastFailureAt && (!h.lastSuccessAt || h.lastFailureAt > h.lastSuccessAt);
		if (failed) return { state: 'error', label: 'Failing' } as const;
		if (h.lastSuccessAt) return { state: 'ok', label: 'Working' } as const;
		return { state: 'off', label: 'Not used yet' } as const;
	}
	async function copySecret() {
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret);
			toast.success('Signing secret copied');
		} catch {
			toast.error('Copy failed – select the secret manually');
		}
	}
	const submit =
		(name: string, success?: string, after?: (data: Record<string, unknown>) => void) => () => {
			busy = name;
			return async ({
				result,
				update
			}: {
				result: { type: string; data?: Record<string, unknown>; error?: { message?: string } };
				update: (o?: { reset?: boolean }) => Promise<void>;
			}) => {
				busy = null;
				if (result.type === 'failure') {
					const e = (result.data?.errors ?? {}) as Record<string, string>;
					toast.error(Object.values(e)[0] ?? 'That did not work.');
					await update({ reset: false });
					return;
				}
				if (result.type === 'error') {
					toast.error(result.error?.message ?? 'Something went wrong.');
					return;
				}
				if (result.type === 'success') {
					after?.(result.data ?? {});
					const tested = result.data?.tested;
					if (typeof tested === 'string') toast.success(tested);
					else if (success) toast.success(success);
				}
				await update({ reset: false });
			};
		};
</script>

<div class="grid gap-6">
	<Card class="grid gap-4 p-5 sm:p-6">
		{@render intro?.()}
		{#if !encryptionAvailable}
			<FormMessage
				message="ENCRYPTION_KEY is not set on the server, so {noun}s can't be stored. Add a key (openssl rand -base64 32) to the deployment and restart Tikket."
			/>
		{/if}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-muted-foreground">
				{hooks.length
					? `${hooks.filter((h) => h.enabled).length} of ${hooks.length} ${noun}${hooks.length === 1 ? '' : 's'} active`
					: `No ${noun}s yet.`}
			</p>
			<Button onclick={openCreate} disabled={!encryptionAvailable || archived}
				><Plus /> Add {noun}</Button
			>
		</div>
	</Card>

	{#if secret}
		<div role="status" class="grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
			<p class="flex items-start gap-2 text-sm font-medium">
				<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" /> Copy the signing secret now – it
				will not be shown again.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<code
					class="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
					>{secret}</code
				>
				<Button variant="outline" size="sm" onclick={copySecret}><Copy /> Copy</Button>
				<Button variant="ghost" size="sm" onclick={() => (secret = null)}>I saved it</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Store it in your receiver to verify the <code>Tikket-Signature</code> header. If it gets lost,
				rotate the secret.
			</p>
		</div>
	{/if}

	{#each hooks as hook (hook.id)}
		{@const st = status(hook)}
		<Card class="grid gap-4 p-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<h3 class="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<span class="[overflow-wrap:anywhere]">{hook.name}</span>
						<IntegrationStatus state={st.state} label={st.label} />
					</h3>
					<p class="mt-0.5 font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground">
						{hook.urlHint}
					</p>
				</div>
				<div class="flex flex-wrap gap-1.5">
					<form method="POST" action="?/test" use:enhance={submit(`test-${hook.id}`)}>
						<input type="hidden" name="id" value={hook.id} />
						<Button
							type="submit"
							variant="outline"
							size="sm"
							loading={busy === `test-${hook.id}`}
							disabled={archived}><Send /> Test</Button
						>
					</form>
					<Button variant="ghost" size="sm" onclick={() => openEdit(hook)} disabled={archived}
						><Pencil /> Edit</Button
					>
					{#if kind === 'webhook'}
						<form
							method="POST"
							action="?/rotate"
							use:enhance={submit(`rotate-${hook.id}`, 'Signing secret rotated', (d) => {
								secret = typeof d.secret === 'string' ? d.secret : null;
							})}
						>
							<input type="hidden" name="id" value={hook.id} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								loading={busy === `rotate-${hook.id}`}
								disabled={archived}><KeyRound /> Rotate secret</Button
							>
						</form>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						onclick={() => {
							deleting = hook;
							deleteOpen = true;
						}}
						disabled={archived}
						aria-label="Delete {hook.name}"><Trash /></Button
					>
				</div>
			</div>
			<ul class="flex flex-wrap gap-1.5" aria-label="Events">
				{#each hook.events as e (e)}
					<li class="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs">
						{kind === 'webhook' ? e : (eventLabels[e] ?? e)}
					</li>
				{/each}
			</ul>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
				<div>
					<dt class="text-muted-foreground">Last success</dt>
					<dd>
						{#if hook.lastSuccessAt}<TimeAgo date={hook.lastSuccessAt} />{:else}—{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Last failure</dt>
					<dd>
						{#if hook.lastFailureAt}<TimeAgo date={hook.lastFailureAt} />{:else}—{/if}
					</dd>
				</div>
				{#if hook.lastError && st.state === 'error'}
					<div class="sm:col-span-3">
						<dt class="text-muted-foreground">Recent error</dt>
						<dd class="[overflow-wrap:anywhere] text-destructive">{hook.lastError}</dd>
					</div>
				{/if}
			</dl>
			<div>
				<button
					type="button"
					class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
					aria-expanded={expanded === hook.id}
					onclick={() => (expanded = expanded === hook.id ? null : hook.id)}
				>
					<ChevronDown
						class={cn('size-3.5 transition-transform', expanded === hook.id && 'rotate-180')}
					/>
					Recent deliveries ({hook.deliveries.length})
				</button>
				{#if expanded === hook.id}
					{#if hook.deliveries.length}
						<div class="mt-2 overflow-x-auto rounded-lg border border-border">
							<table class="w-full min-w-[32rem] text-left text-xs">
								<thead class="bg-surface-2 text-muted-foreground">
									<tr>
										<th class="px-3 py-2 font-medium">Event</th>
										<th class="px-3 py-2 font-medium">Result</th>
										<th class="px-3 py-2 font-medium">Attempt</th>
										<th class="px-3 py-2 font-medium">Time</th>
										<th class="px-3 py-2 font-medium">When</th>
									</tr>
								</thead>
								<tbody>
									{#each hook.deliveries as d (d.id)}
										<tr class="border-t border-border align-top">
											<td class="px-3 py-2 font-mono">{d.event}</td>
											<td class="px-3 py-2">
												<span class={d.success ? 'text-success' : 'text-destructive'}
													>{d.statusCode
														? `HTTP ${d.statusCode}`
														: d.success
															? 'OK'
															: 'Failed'}</span
												>
												{#if d.error && !d.success}<span
														class="block max-w-[18rem] [overflow-wrap:anywhere] text-muted-foreground"
														>{d.error}</span
													>{/if}
											</td>
											<td class="px-3 py-2 tabular-nums">#{d.attempt}</td>
											<td class="px-3 py-2 tabular-nums">{d.durationMs} ms</td>
											<td class="px-3 py-2"><TimeAgo date={d.createdAt} /></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="mt-2 text-xs text-muted-foreground">Nothing delivered yet.</p>
					{/if}
				{/if}
			</div>
		</Card>
	{/each}
</div>

<Dialog
	bind:open={dialogOpen}
	title={editing ? `Edit ${editing.name}` : `Add ${noun}`}
	description={editing ? 'Leave the URL empty to keep the current one.' : undefined}
	size="lg"
>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		class="grid gap-4"
		autocomplete="off"
		use:enhance={submit(
			'save',
			editing ? 'Saved' : `${noun[0].toUpperCase()}${noun.slice(1)} added`,
			(d) => {
				dialogOpen = false;
				if (typeof d.secret === 'string') secret = d.secret;
			}
		)}
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<FormMessage message={errors.form} />
		<Field label="Name" for="hook-name" error={errors.name} required>
			<Input
				id="hook-name"
				name="name"
				required
				maxlength={60}
				value={editing?.name ?? ''}
				placeholder={kind === 'discord' ? '#releases channel' : 'Deploy bot'}
			/>
		</Field>
		<Field
			label={urlLabel}
			for="hook-url"
			error={errors.url}
			required={!editing}
			hint={editing ? `Current: ${editing.urlHint}` : urlHint}
		>
			<Input
				id="hook-url"
				name="url"
				type="url"
				required={!editing}
				placeholder={editing ? 'Paste a new URL to replace it' : urlPlaceholder}
				spellcheck="false"
				autocomplete="off"
			/>
		</Field>
		<fieldset class="grid gap-2">
			<legend class="mb-1 text-[0.8125rem] font-medium">Events</legend>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each events as e (e)}
					<label
						class="flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft"
					>
						<Checkbox
							name="events"
							value={e}
							checked={selected.includes(e)}
							onchange={(ev) => toggle(e, ev.currentTarget.checked)}
							class="mt-0.5"
						/>
						<span class="min-w-0">
							{#if kind === 'webhook'}<span class="block font-mono text-xs">{e}</span>{/if}
							<span class={kind === 'webhook' ? 'block text-xs text-muted-foreground' : 'block'}
								>{eventLabels[e]}</span
							>
						</span>
					</label>
				{/each}
			</div>
			{#if errors.events}<p class="text-xs text-destructive">{errors.events}</p>{/if}
		</fieldset>
		<label class="flex items-center gap-3">
			<Switch name="enabled" bind:checked={enabled} />
			<span class="text-sm font-medium">Enabled</span>
		</label>
		<div class="flex justify-end gap-2 border-t border-border pt-4">
			<Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button type="submit" loading={busy === 'save'} disabled={!selected.length}
				>{editing ? 'Save' : `Add ${noun}`}</Button
			>
		</div>
	</form>
</Dialog>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete {deleting?.name ?? noun}?"
	description="Its pending deliveries and delivery history are deleted too. This cannot be undone."
	confirmLabel="Delete"
	destructive
	action="?/delete"
	fields={{ id: deleting?.id ?? 0 }}
	successMessage="Deleted"
/>
