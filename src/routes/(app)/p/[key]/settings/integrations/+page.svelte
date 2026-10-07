<script lang="ts">
	import Github from '@lucide/svelte/icons/git-pull-request';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Webhook from '@lucide/svelte/icons/webhook';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { projectPath } from '$lib/shared/format';

	let { data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/integrations'));
	type State = 'ok' | 'warn' | 'error' | 'off';
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const cards = $derived.by(() => {
		const gh = data.github;
		const ghState: State = !gh ? 'off' : gh.lastError ? 'error' : gh.lastEventAt ? 'ok' : 'warn';
		const hookCard = (h: typeof data.discord, noun: string) => ({
			state: (!h.total ? 'off' : h.failing ? 'error' : h.active ? 'ok' : 'off') as State,
			label: !h.total
				? 'Not configured'
				: h.failing
					? `${plural(h.failing, 'failing ' + noun)}`
					: h.active
						? 'Connected'
						: 'All disabled',
			detail: h.total ? `${plural(h.active, `active ${noun}`)} of ${h.total}` : null,
			at: h.lastSuccessAt
		});
		return [
			{
				href: `${base}/github`,
				icon: Github,
				name: 'GitHub',
				description:
					'Link pull requests and commits to tickets by mentioning ticket keys, and optionally update tickets when pull requests are merged.',
				state: ghState,
				label: !gh
					? 'Not configured'
					: gh.lastError
						? 'Error'
						: gh.lastEventAt
							? 'Connected'
							: 'Waiting for events',
				detail: gh ? `Connected to ${gh.owner}/${gh.repo}` : null,
				at: gh?.lastEventAt ?? null
			},
			{
				href: `${base}/discord`,
				icon: MessageCircle,
				name: 'Discord',
				description: 'Post new tickets, status changes and releases to Discord channels.',
				...hookCard(data.discord, 'webhook')
			},
			{
				href: `${base}/webhooks`,
				icon: Webhook,
				name: 'Webhooks',
				description: 'Send signed JSON events to your own automation or other tools.',
				...hookCard(data.webhooks, 'endpoint')
			}
		];
	});
</script>

<div class="grid gap-4">
	{#if !data.encryptionAvailable}
		<FormMessage
			variant="info"
			message="Integrations store secrets (webhook URLs, signing secrets, tokens) encrypted. Set ENCRYPTION_KEY on the server to set them up – see docs/integrations.md."
		/>
	{/if}
	<div class="grid gap-4 md:grid-cols-3">
		{#each cards as card (card.name)}
			{@const Icon = card.icon}
			<Card class="flex flex-col gap-3 p-5">
				<div class="flex items-start justify-between gap-2">
					<span
						class="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2"
						><Icon class="size-5" /></span
					>
					<IntegrationStatus state={card.state} label={card.label} />
				</div>
				<div class="grid gap-1">
					<h2 class="text-base font-semibold">{card.name}</h2>
					<p class="text-sm text-muted-foreground">{card.description}</p>
				</div>
				{#if card.detail}
					<p class="text-sm font-medium [overflow-wrap:anywhere]">{card.detail}</p>
				{/if}
				{#if card.at}
					<p class="text-xs text-muted-foreground">
						Last {card.name === 'GitHub' ? 'event' : 'delivery'}
						<TimeAgo date={card.at} />
					</p>
				{/if}
				<div class="mt-auto pt-2">
					<Button href={card.href} variant="outline" class="w-full">Manage <ChevronRight /></Button>
				</div>
			</Card>
		{/each}
	</div>
	<p class="text-xs text-muted-foreground">
		Email notifications are configured by an administrator under Administration → Email; each person
		chooses which emails they receive.
	</p>
</div>
