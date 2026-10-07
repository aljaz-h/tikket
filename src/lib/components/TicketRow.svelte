<script lang="ts">
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import StatusBadge from './StatusBadge.svelte';
	import PriorityBadge from './PriorityBadge.svelte';
	import TypeBadge from './TypeBadge.svelte';
	import UserAvatar from './UserAvatar.svelte';
	import TimeAgo from './TimeAgo.svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import Checkbox from './ui/checkbox.svelte';
	import TicketContextMenu from './TicketContextMenu.svelte';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketPriority, TicketStatus, TicketType } from '$lib/shared/constants';

	interface Props {
		ticket: {
			number: number;
			title: string;
			type: TicketType;
			status: TicketStatus;
			priority: TicketPriority;
			voteCount: number;
			commentCount: number;
			updatedAt: Date | string;
			projectKey: string;
			projectName: string;
			projectIcon: string | null;
			projectLogoId?: string | null;
			projectColor: string;
			assignee: { displayName: string; avatarId: string | null } | null;
			labels?: { id: number; name: string; color: string }[];
		};
		showProject?: boolean;
		showPriority?: boolean;
		/** Bulk selection: renders a checkbox before the row link when set. */
		selected?: boolean;
		onselect?: (selected: boolean) => void;
	}
	let { ticket, showProject = false, showPriority = true, selected, onselect }: Props = $props();
	const selectable = $derived(selected !== undefined);
	const href = $derived(ticketPath(ticket.projectKey, ticket.number));
	const ref = $derived(ticketRef(ticket.projectKey, ticket.number));
</script>

<li class="group relative flex items-stretch {selected ? 'bg-primary-soft' : ''}">
	{#if selectable}
		<label
			class="flex shrink-0 cursor-pointer items-start py-3 pl-3 sm:items-center sm:py-0 sm:pl-4"
		>
			<span class="sr-only">Select {ticketRef(ticket.projectKey, ticket.number)}</span>
			<Checkbox
				name="ticket"
				value={ticket.number}
				checked={selected}
				onchange={(e) => onselect?.((e.currentTarget as HTMLInputElement).checked)}
			/>
		</label>
	{/if}
	<!-- Right-click (or the context-menu key) offers quick actions; the link itself is unchanged. -->
	<TicketContextMenu {href} reference={ref}>
		{#snippet children({ props })}
			<a
				{...props}
				{href}
				class="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none sm:items-center sm:px-4"
			>
				<StatusBadge status={ticket.status} iconOnly class="mt-0.5 sm:mt-0" />
				<span
					class="hidden w-20 shrink-0 font-mono text-xs text-muted-foreground tabular-nums sm:inline"
				>
					{ticketRef(ticket.projectKey, ticket.number)}
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span class="font-medium [overflow-wrap:anywhere] text-foreground">{ticket.title}</span>
						{#each ticket.labels ?? [] as label (label.id)}
							<span
								class="swatch-bg swatch-{label.color} rounded px-1.5 text-[0.6875rem] leading-[1.125rem] font-medium"
								>{label.name}</span
							>
						{/each}
					</span>
					<span
						class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:hidden"
					>
						<span class="font-mono">{ticketRef(ticket.projectKey, ticket.number)}</span>
						<TypeBadge type={ticket.type} />
						<TimeAgo date={ticket.updatedAt} />
					</span>
					{#if showProject}
						<span class="mt-0.5 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
							<ProjectIcon
								project={{
									name: ticket.projectName,
									icon: ticket.projectIcon,
									logoId: ticket.projectLogoId,
									color: ticket.projectColor
								}}
								size="xs"
							/>
							{ticket.projectName}
						</span>
					{/if}
				</span>
				<span class="hidden w-24 shrink-0 md:block"><TypeBadge type={ticket.type} /></span>
				{#if showPriority}
					<span class="hidden w-20 shrink-0 lg:block"
						><PriorityBadge priority={ticket.priority} /></span
					>
				{/if}
				<span
					class="flex w-14 shrink-0 items-center justify-end gap-3 text-xs text-muted-foreground tabular-nums"
				>
					{#if ticket.commentCount}
						<span class="hidden items-center gap-1 sm:flex" title="{ticket.commentCount} comments"
							><MessageSquare class="size-3.5" />{ticket.commentCount}</span
						>
					{/if}
					<span class="flex items-center gap-0.5" title="{ticket.voteCount} votes"
						><ArrowBigUp class="size-4" />{ticket.voteCount}</span
					>
				</span>
				<span class="hidden w-6 shrink-0 sm:block">
					{#if ticket.assignee}
						<span title="Assigned to {ticket.assignee.displayName}"
							><UserAvatar user={ticket.assignee} size="sm" /></span
						>
					{/if}
				</span>
				<span class="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
					<TimeAgo date={ticket.updatedAt} />
				</span>
			</a>
		{/snippet}
	</TicketContextMenu>
</li>
