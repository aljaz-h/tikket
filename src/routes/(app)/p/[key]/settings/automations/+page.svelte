<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import History from '@lucide/svelte/icons/rotate-ccw-clock';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Zap from '@lucide/svelte/icons/zap';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { AUTOMATION_TRIGGER_META } from '$lib/shared/constants';
	import { projectPath } from '$lib/shared/format';

	let { data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/automations'));
	let deleting = $state<{ id: number; name: string } | null>(null);
	let deleteOpen = $state(false);
</script>

<div class="grid gap-6">
	<Card class="grid gap-4 p-5 sm:p-6">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-2xl">
				<h2 class="flex items-center gap-2 text-base font-semibold">
					<Zap class="size-4 text-muted-foreground" /> Automations
				</h2>
				<p class="text-sm text-muted-foreground">
					Rules that react to ticket events: <strong>when</strong> something happens,
					<strong>if</strong> the ticket matches your conditions, <strong>then</strong> run actions. Changes
					are recorded as made by the automation. A rule never runs twice in one chain of automated changes.
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button variant="outline" href="{base}/history"><History /> History</Button>
				<Button href="{base}/new" disabled={data.archived}><Plus /> New automation</Button>
			</div>
		</div>
	</Card>

	{#if data.rules.length}
		{@const h = data.health}
		<section aria-label="Automation health" class="grid gap-3">
			<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
				{#each [{ label: 'Enabled rules', value: h.enabled }, { label: 'Disabled rules', value: h.disabled }, { label: 'Runs (24 h)', value: h.runs24h }, { label: 'Failed (24 h)', value: h.failed24h, bad: h.failed24h > 0, href: `${base}/history?status=failed` }, { label: 'Safety limits (24 h)', value: h.protected24h, bad: h.dropped24h > 0, href: `${base}/history?status=protected` }] as stat (stat.label)}
					<div class="rounded-lg border border-border bg-surface px-3 py-2">
						<dt class="text-xs text-muted-foreground">{stat.label}</dt>
						<dd
							class={stat.bad ? 'text-lg font-semibold text-destructive' : 'text-lg font-semibold'}
						>
							{#if stat.href && stat.value}<a href={stat.href} class="hover:underline"
									>{stat.value}</a
								>{:else}{stat.value}{/if}
						</dd>
					</div>
				{/each}
			</dl>
			{#if h.lastFailure}
				<p class="text-xs [overflow-wrap:anywhere] text-muted-foreground">
					Last failure: <span class="font-medium text-foreground">{h.lastFailure.name}</span>
					· <TimeAgo date={h.lastFailure.createdAt} />{#if h.lastFailure.error}
						– {h.lastFailure.error}{/if}
				</p>
			{/if}
			{#if h.dropped24h}
				<p
					class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
					role="status"
				>
					Some automated changes were stopped by the 50-event safety limit in the last 24 hours.
					Rules that react to each other's changes probably keep triggering one another –
					<a href="{base}/history?status=protected" class="text-link hover:underline">see which</a>.
				</p>
			{/if}
		</section>
	{/if}

	{#if data.rules.length}
		<ul class="grid gap-3" aria-label="Automation rules">
			{#each data.rules as rule (rule.id)}
				<li>
					<Card class="flex flex-wrap items-center gap-4 p-4">
						<form
							method="POST"
							action="?/toggle"
							use:enhance={quickSubmit({
								success: rule.enabled ? 'Automation paused' : 'Automation enabled'
							})}
						>
							<input type="hidden" name="id" value={rule.id} />
							<input type="hidden" name="enabled" value={String(!rule.enabled)} />
							<Switch
								checked={rule.enabled}
								aria-label="{rule.enabled ? 'Disable' : 'Enable'} {rule.name}"
								disabled={data.archived}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							/>
						</form>
						<div class="min-w-0 flex-1">
							<a
								href="{base}/{rule.id}"
								class="font-medium [overflow-wrap:anywhere] hover:underline">{rule.name}</a
							>
							<p class="text-xs text-muted-foreground">
								When <span class="font-medium text-foreground"
									>{AUTOMATION_TRIGGER_META[rule.trigger].label.toLowerCase()}</span
								>{#if rule.conditionCount}
									· {rule.conditionCount} condition{rule.conditionCount === 1 ? '' : 's'}{/if} · {rule.actionCount}
								action{rule.actionCount === 1 ? '' : 's'}
							</p>
							{#if rule.lastError}
								<p class="mt-1 text-xs [overflow-wrap:anywhere] text-destructive">
									Last error: {rule.lastError}
								</p>
							{/if}
						</div>
						<div class="flex items-center gap-3 text-xs text-muted-foreground">
							<IntegrationStatus
								state={!rule.enabled ? 'off' : rule.lastError ? 'error' : 'ok'}
								label={!rule.enabled ? 'Off' : rule.lastError ? 'Error' : 'Active'}
							/>
							<span class="tabular-nums"
								>{rule.runCount} run{rule.runCount === 1 ? '' : 's'}{#if rule.lastRunAt}
									· <TimeAgo date={rule.lastRunAt} />{/if}</span
							>
							<Button
								variant="ghost"
								size="icon-sm"
								class="text-destructive"
								aria-label="Delete {rule.name}"
								disabled={data.archived}
								onclick={() => {
									deleting = rule;
									deleteOpen = true;
								}}><Trash /></Button
							>
						</div>
					</Card>
				</li>
			{/each}
		</ul>
	{:else}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
		>
			No automations yet. Start from a template below or create your own.
		</p>
	{/if}

	<Card class="grid gap-3 p-5 sm:p-6">
		<h2 class="flex items-center gap-2 text-sm font-semibold">
			<Sparkles class="size-4 text-muted-foreground" /> Start from a template
		</h2>
		<p class="text-xs text-muted-foreground">
			Templates create an editable rule that stays off until you enable it.
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.templates as tpl (tpl.id)}
				<form
					method="POST"
					action="?/template"
					class="flex flex-col gap-2 rounded-lg border border-border p-3"
					use:enhance={() =>
						async ({ result, update }) => {
							if (result.type === 'success' && result.data?.createdId)
								await goto(`${base}/${result.data.createdId}`);
							else await update();
						}}
				>
					<input type="hidden" name="template" value={tpl.id} />
					<span class="text-sm font-medium">{tpl.name}</span>
					<span class="flex-1 text-xs text-muted-foreground">{tpl.description}</span>
					<Button
						type="submit"
						variant="outline"
						size="sm"
						class="self-start"
						disabled={data.archived}>Use template</Button
					>
				</form>
			{/each}
		</div>
	</Card>
</div>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete {deleting?.name ?? 'automation'}?"
	description="The rule stops immediately. Its execution history is kept."
	confirmLabel="Delete"
	destructive
	action="?/delete"
	fields={{ id: deleting?.id ?? 0 }}
	successMessage="Automation deleted"
/>
