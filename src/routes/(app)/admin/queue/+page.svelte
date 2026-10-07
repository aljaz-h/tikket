<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Info from '@lucide/svelte/icons/info';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { JOB_KINDS } from '$lib/shared/constants';
	import { formatDateTime, ticketPath } from '$lib/shared/format';

	let { data } = $props();
	const o = $derived(data.overview);
	const KIND_LABEL: Record<string, string> = {
		email: 'Email',
		discord: 'Discord',
		webhook: 'Webhook',
		automation: 'Automation'
	};
	const FILTER_LABEL = { failed: 'Failed', retrying: 'Retrying', pending: 'Waiting' };
	let discarding = $state<number | null>(null);
	let discardOpen = $state(false);
	// Writable derived: opens with ?job=…, closes locally until the next navigation.
	let detailOpen = $derived(!!data.detail);

	function link(params: Record<string, string | null>) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per navigation
		const q = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(params)) {
			if (v) q.set(k, v);
			else q.delete(k);
		}
		return `?${q}`;
	}
	const emptyText = $derived(
		data.filter === 'failed'
			? 'No failed deliveries. Jobs that run out of attempts appear here so they can be retried or discarded.'
			: data.filter === 'retrying'
				? 'Nothing is waiting for a retry. Temporary failures (timeouts, rate limits) are retried here automatically.'
				: 'The queue is empty: every email, Discord message, webhook and automation has been processed.'
	);
</script>

<div class="grid gap-6">
	<Card class="grid gap-4 p-5 sm:p-6">
		<div>
			<h2 class="text-base font-semibold">Delivery queue</h2>
			<p class="text-sm text-muted-foreground">
				Emails, Discord messages, webhooks and automations are delivered from one queue in the
				database. Temporary failures retry automatically with increasing delays.
			</p>
		</div>
		<dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each [{ l: 'Waiting', v: o.pending }, { l: 'Retrying', v: o.retrying, warn: o.retrying > 0 }, { l: 'Failed', v: o.failed, bad: o.failed > 0 }, { l: 'Delivered (24 h)', v: o.doneRecently }] as s (s.l)}
				<div class="rounded-lg border border-border bg-surface px-3 py-2">
					<dt class="text-xs text-muted-foreground">{s.l}</dt>
					<dd
						class="text-lg font-semibold tabular-nums {s.bad
							? 'text-destructive'
							: s.warn
								? 'text-warning'
								: ''}"
					>
						{s.v}
					</dd>
				</div>
			{/each}
		</dl>
		<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
			<div>
				<dt class="text-muted-foreground">Oldest waiting job</dt>
				<dd>
					{#if o.oldestPending}<TimeAgo date={o.oldestPending} />{:else}—{/if}
				</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Last successful delivery</dt>
				<dd>
					{#if o.lastSuccess}<TimeAgo date={o.lastSuccess} />{:else}—{/if}
				</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Last failure</dt>
				<dd>
					{#if o.lastFailure}<TimeAgo date={o.lastFailure} />{:else}—{/if}
				</dd>
			</div>
		</dl>
	</Card>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<nav
			aria-label="Job list"
			class="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1"
		>
			{#each Object.entries(FILTER_LABEL) as [key, label] (key)}
				<a
					href={link({ show: key, before: null, job: null })}
					aria-current={data.filter === key ? 'page' : undefined}
					class="inline-flex h-8 items-center rounded-md px-3 text-sm {data.filter === key
						? 'bg-hover font-medium text-foreground'
						: 'text-muted-foreground hover:text-foreground'}">{label}</a
				>
			{/each}
		</nav>
		<div class="w-full sm:w-48">
			<Select
				aria-label="Job type"
				size="sm"
				value={data.kind}
				onchange={(v) => goto(link({ kind: v || null, before: null, job: null }))}
				items={[
					{ value: '', label: 'All types' },
					...JOB_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))
				]}
			/>
		</div>
	</div>

	{#if data.jobs.length}
		<ul class="grid gap-2" aria-label="{FILTER_LABEL[data.filter]} jobs">
			{#each data.jobs as job (job.id)}
				<li>
					<Card class="grid gap-2 p-4">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-sm font-medium">
									{KIND_LABEL[job.kind]}
									{#if job.projectKey}<span class="text-muted-foreground">· {job.projectName}</span
										>{/if}
									{#if job.ticketNumber && job.projectKey}·
										<a
											href={ticketPath(job.projectKey, job.ticketNumber)}
											class="text-link hover:underline">{job.projectKey}-{job.ticketNumber}</a
										>{/if}
								</p>
								{#if job.summary}<p class="text-xs [overflow-wrap:anywhere] text-muted-foreground">
										{job.summary}
									</p>{/if}
							</div>
							<div class="flex flex-wrap gap-1">
								<Button
									variant="ghost"
									size="xs"
									href={link({ job: String(job.id) })}
									aria-label="Details of job {job.id}"><Info /> Details</Button
								>
								{#if job.status === 'dead' || job.lastError}
									<form
										method="POST"
										action="?/retry"
										use:enhance={quickSubmit({ success: 'Queued to run now' })}
									>
										<input type="hidden" name="id" value={job.id} />
										<Button type="submit" variant="outline" size="xs"
											><RotateCcw /> Retry now</Button
										>
									</form>
								{/if}
								<Button
									variant="ghost"
									size="xs"
									class="text-destructive"
									onclick={() => {
										discarding = job.id;
										discardOpen = true;
									}}
									aria-label="Discard job {job.id}"><Trash /> Discard</Button
								>
							</div>
						</div>
						{#if job.lastError}
							<p class="text-xs [overflow-wrap:anywhere] text-destructive">{job.lastError}</p>
						{/if}
						<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
							<div>
								<dt class="text-muted-foreground">Attempts</dt>
								<dd class="tabular-nums">{job.attempts} / {job.maxAttempts}</dd>
							</div>
							<div>
								<dt class="text-muted-foreground">
									{job.status === 'dead' ? 'Gave up' : 'Next attempt'}
								</dt>
								<dd>
									{#if job.status === 'dead'}<TimeAgo date={job.updatedAt} />{:else}<TimeAgo
											date={job.nextAttemptAt}
										/>{/if}
								</dd>
							</div>
							<div>
								<dt class="text-muted-foreground">Created</dt>
								<dd><TimeAgo date={job.createdAt} /></dd>
							</div>
							<div>
								<dt class="text-muted-foreground">Last attempt</dt>
								<dd>
									{#if job.attempts}<TimeAgo date={job.updatedAt} />{:else}—{/if}
								</dd>
							</div>
						</dl>
					</Card>
				</li>
			{/each}
		</ul>
		{#if data.more}
			<div class="flex justify-center">
				<Button variant="outline" href={link({ before: String(data.jobs.at(-1)!.id) })}
					>Older jobs</Button
				>
			</div>
		{/if}
	{:else}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
		>
			{emptyText}
		</p>
	{/if}
</div>

<ConfirmDialog
	bind:open={discardOpen}
	title="Discard this job?"
	description="It will never be delivered. This can't be undone."
	confirmLabel="Discard job"
	destructive
	action="?/discard"
	fields={{ id: discarding ?? 0 }}
	successMessage="Job discarded"
/>

{#if data.detail}
	{@const d = data.detail}
	<Dialog
		bind:open={detailOpen}
		title="Job {d.id}"
		description="Metadata only – message contents and destinations are never shown."
		onOpenChange={(open) => {
			if (!open) goto(link({ job: null }), { noScroll: true, keepFocus: true });
		}}
	>
		<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
			<dt class="text-muted-foreground">Type</dt>
			<dd>
				{KIND_LABEL[d.kind]}{#if d.hookName}
					· {d.hookName}{/if}
			</dd>
			<dt class="text-muted-foreground">Status</dt>
			<dd>{d.status === 'dead' ? 'Failed' : d.status === 'done' ? 'Delivered' : d.status}</dd>
			{#if d.summary}<dt class="text-muted-foreground">Event</dt>
				<dd class="[overflow-wrap:anywhere]">{d.summary}</dd>{/if}
			<dt class="text-muted-foreground">Attempts</dt>
			<dd>{d.attempts} of {d.maxAttempts}</dd>
			<dt class="text-muted-foreground">Created</dt>
			<dd>{formatDateTime(d.createdAt)}</dd>
			<dt class="text-muted-foreground">Last change</dt>
			<dd>{formatDateTime(d.updatedAt)}</dd>
			{#if d.status === 'pending'}<dt class="text-muted-foreground">Next attempt</dt>
				<dd>{formatDateTime(d.nextAttemptAt)}</dd>{/if}
			{#if d.lastError}<dt class="text-muted-foreground">Last error</dt>
				<dd class="[overflow-wrap:anywhere] text-destructive">{d.lastError}</dd>{/if}
		</dl>
	</Dialog>
{/if}
