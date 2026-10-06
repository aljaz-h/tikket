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
	import { ContextMenu } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Hash from '@lucide/svelte/icons/hash';
	import SquareArrowRight from '@lucide/svelte/icons/square-arrow-right';
	import { goto } from '$app/navigation';
	import { menuContentClass, menuItemClass } from './ui/menu-styles';
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

	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${what} copied`);
		} catch {
			toast.error('Could not copy to the clipboard');
		}
	}
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
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
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
							<span class="font-medium [overflow-wrap:anywhere] text-foreground"
								>{ticket.title}</span
							>
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
							<span
								class="mt-0.5 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
							>
								<ProjectIcon
									project={{
										name: ticket.projectName,
										icon: ticket.projectIcon,
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
		</ContextMenu.Trigger>
		<ContextMenu.Portal>
			<ContextMenu.Content class={menuContentClass}>
				<ContextMenu.Item class={menuItemClass} onSelect={() => goto(href)}
					><SquareArrowRight /> Open {ref}</ContextMenu.Item
				>
				<ContextMenu.Item
					class={menuItemClass}
					onSelect={() => window.open(href, '_blank', 'noopener')}
					><ExternalLink /> Open in new tab</ContextMenu.Item
				>
				<ContextMenu.Separator class="-mx-1 my-1 h-px bg-border" />
				<ContextMenu.Item
					class={menuItemClass}
					onSelect={() => copy(new URL(href, location.origin).href, 'Link')}
					><Link2 /> Copy link</ContextMenu.Item
				>
				<ContextMenu.Item class={menuItemClass} onSelect={() => copy(ref, 'Reference')}
					><Hash /> Copy reference</ContextMenu.Item
				>
			</ContextMenu.Content>
		</ContextMenu.Portal>
	</ContextMenu.Root>
</li>
