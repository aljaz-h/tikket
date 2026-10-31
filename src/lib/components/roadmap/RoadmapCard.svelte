<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import Flag from '@lucide/svelte/icons/flag';
	import PriorityBadge from '../PriorityBadge.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import Tooltip from '../ui/tooltip.svelte';
	import { TYPE_META, type TicketPriority, type TicketType } from '$lib/shared/constants';
	import { formatDateTime, ticketPath, ticketRef } from '$lib/shared/format';
	import { cardDate, shortDate } from '$lib/shared/roadmap-view';
	import type { RoadmapView } from '$lib/server/services/roadmap';

	export type RoadmapCardData = RoadmapView['columns']['planned'][number];

	interface Props {
		card: RoadmapCardData;
		projectKey: string;
		now: Date;
		/** The viewer may vote: the count becomes a real button. */
		canVote?: boolean;
		onvote?: (card: RoadmapCardData) => void;
		/** Extra controls (the staff actions menu), placed left of the date. */
		actions?: Snippet;
	}
	let { card, projectKey, now, canVote = false, onvote, actions }: Props = $props();

	const ref = $derived(ticketRef(projectKey, card.number));
	const date = $derived(cardDate(card, now, (x) => shortDate(x, now)));
	const people = $derived.by(() => {
		const list: { name: string; avatarId: string | null; text: string }[] = [];
		if (card.creator)
			list.push({
				name: card.creator.name,
				avatarId: card.creator.avatarId,
				text: `Created by ${card.creator.name}`
			});
		// Show the assignee too when it is somebody else.
		if (card.assignee && card.assigneeId !== card.creator?.id)
			list.push({
				name: card.assignee,
				avatarId: card.assigneeAvatar,
				text: `Assigned to ${card.assignee}`
			});
		return list;
	});
	const important = $derived(card.priority === 'high' || card.priority === 'critical');
</script>

<div class="flex gap-2.5 p-2.5">
	{#if card.voteCount !== null}
		{#if canVote}
			<button
				type="button"
				aria-pressed={card.voted}
				aria-label="{card.voted
					? 'Remove your vote from'
					: 'Vote for'} {ref} ({card.voteCount} {card.voteCount === 1 ? 'vote' : 'votes'})"
				onclick={() => onvote?.(card)}
				class="flex h-11 w-[34px] shrink-0 flex-col items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors hover:border-border-strong hover:bg-hover pointer-coarse:min-h-11 pointer-coarse:w-11 {card.voted
					? 'border-primary-border bg-primary-soft text-foreground'
					: 'border-border'}"
			>
				<ArrowBigUp
					class="size-3.5 {card.voted ? 'text-primary' : 'text-muted-foreground'}"
				/>{card.voteCount}
			</button>
		{:else}
			<span
				class="flex h-11 w-[34px] shrink-0 flex-col items-center justify-center rounded-md border border-border text-xs font-semibold tabular-nums"
				role="img"
				aria-label="{card.voteCount} {card.voteCount === 1 ? 'vote' : 'votes'}"
			>
				<ArrowBigUp class="size-3.5 text-muted-foreground" />{card.voteCount}
			</span>
		{/if}
	{/if}
	<div class="min-w-0 flex-1">
		<div class="flex items-start gap-2">
			<a
				href={ticketPath(projectKey, card.number)}
				draggable="false"
				class="min-w-0 flex-1 text-sm leading-snug font-medium [overflow-wrap:anywhere] hover:underline"
				>{card.title}</a
			>
			{#if people.length}
				<span class="flex shrink-0 -space-x-1">
					{#each people as person (person.text)}
						<Tooltip text={person.text}>
							{#snippet children({ props })}
								<span
									{...props}
									role="img"
									aria-label={person.text}
									class="rounded-full ring-2 ring-surface"
								>
									<UserAvatar
										user={{ displayName: person.name, avatarId: person.avatarId }}
										size="xs"
									/>
								</span>
							{/snippet}
						</Tooltip>
					{/each}
				</span>
			{/if}
		</div>
		<div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
			<span class="font-mono">{ref}</span>
			<span class="tone-{card.type} tone-text font-medium"
				>{TYPE_META[card.type as TicketType].short}</span
			>
			{#if card.milestone}
				<span class="inline-flex items-center gap-1"><Flag class="size-3" />{card.milestone}</span>
			{/if}
			{#if card.release}<span>{card.release}</span>{/if}
			{#if important && card.priority}
				<PriorityBadge priority={card.priority as TicketPriority} />
			{/if}
			<span class="ml-auto flex items-center gap-1">
				{@render actions?.()}
				<Tooltip text={formatDateTime(date.at)}>
					{#snippet children({ props })}
						<time {...props} datetime={date.at.toISOString()} class="whitespace-nowrap"
							>{date.text}</time
						>
					{/snippet}
				</Tooltip>
			</span>
		</div>
	</div>
</div>
