<script lang="ts" module>
	import type { TicketColumn } from '$lib/shared/constants';

	/** Grid track for each optional column (the title always takes the remaining space). */
	const TRACKS: Record<TicketColumn, string> = {
		ref: '4.75rem',
		status: '6.25rem',
		type: '5.25rem',
		priority: '5rem',
		project: '8rem',
		assignee: '6.5rem',
		reporter: '6.5rem',
		labels: '0px', // rendered next to the title
		votes: '3.25rem',
		comments: '3.25rem',
		release: '6.5rem',
		milestone: '8.5rem',
		created: '5.5rem',
		updated: '5.5rem'
	};

	export interface QuickOption {
		value: string;
		label: string;
	}
	export interface QuickActions {
		status: QuickOption[];
		priority: QuickOption[];
		assign: QuickOption[];
		addLabel: QuickOption[];
		release: QuickOption[];
		milestone: QuickOption[];
	}
</script>

<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import StatusBadge from './StatusBadge.svelte';
	import PriorityBadge from './PriorityBadge.svelte';
	import TypeBadge from './TypeBadge.svelte';
	import UserAvatar from './UserAvatar.svelte';
	import TimeAgo from './TimeAgo.svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import Checkbox from './ui/checkbox.svelte';
	import TicketContextMenu from './TicketContextMenu.svelte';
	import { menuContentClass, menuItemClass } from './ui/menu-styles';
	import { TICKET_COLUMN_META } from '$lib/shared/constants';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import { cn } from '$lib/utils';
	import type { TicketListRow } from '$lib/server/services/search';

	interface Props {
		rows: TicketListRow[];
		columns: TicketColumn[];
		/** Query string of the list (filters + sort), appended to ticket links for previous/next. */
		listQuery?: string;
		/** Enables bulk selection when bound. */
		selected?: number[];
		quick?: QuickActions | null;
		onquick?: (ticket: number, change: string, label: string) => void;
		label?: string;
	}
	let {
		rows,
		columns,
		listQuery = '',
		selected = $bindable(),
		quick = null,
		onquick,
		label = 'Tickets'
	}: Props = $props();

	const selectable = $derived(selected !== undefined);
	const cols = $derived(columns.filter((c) => c !== 'labels'));
	const showLabels = $derived(columns.includes('labels'));
	// Columns appear from `sm` up; phones get the title with a compact meta line instead.
	const cellClass = 'hidden sm:flex';
	// One template shared by the header and every row keeps columns aligned at every width.
	const template = $derived(
		[
			selectable ? '1.25rem' : null,
			...cols.filter((c) => c === 'ref').map((c) => TRACKS[c]),
			'minmax(0,1fr)',
			...cols.filter((c) => c !== 'ref').map((c) => TRACKS[c]),
			quick ? '2rem' : null
		]
			.filter(Boolean)
			.join(' ')
	);
	// Phones: [checkbox] title [menu]. Wider screens: every chosen column, scrolling sideways when
	// they don't fit, so the header and the rows always share exactly the same tracks.
	const mobileTemplate = $derived(
		[selectable ? '1.25rem' : null, 'minmax(0,1fr)', quick ? '2rem' : null]
			.filter(Boolean)
			.join(' ')
	);
	const minWidth = $derived(
		cols.reduce((sum, c) => sum + parseFloat(TRACKS[c]) + 0.75, 12) +
			(selectable ? 2 : 0) +
			(quick ? 2.75 : 0)
	);
	const ordered = $derived([
		...cols.filter((c) => c === 'ref'),
		'title' as const,
		...cols.filter((c) => c !== 'ref')
	]);
	const href = (n: number, key: string) =>
		`${ticketPath(key, n)}${listQuery ? `?list=${encodeURIComponent(listQuery)}` : ''}`;

	function toggle(number: number, on: boolean) {
		if (!selected) return;
		selected = on ? [...new Set([...selected, number])] : selected.filter((n) => n !== number);
	}
	const groups = $derived(
		quick
			? (
					[
						['Status', 'status', quick.status],
						['Priority', 'priority', quick.priority],
						['Assignee', 'assign', quick.assign],
						['Add label', 'addLabel', quick.addLabel],
						['Release', 'release', quick.release],
						['Milestone', 'milestone', quick.milestone]
					] as const
				).filter(([, , options]) => options.length)
			: []
	);
</script>

<div
	class="overflow-x-auto rounded-xl border border-border bg-surface"
	style="--cols: {template}; --mcols: {mobileTemplate}; --minw: {minWidth}rem"
>
	<div class="sm:min-w-(--minw)">
		<!-- Column headers (visual only; each cell carries its own meaning for assistive tech). -->
		<div
			class="hidden gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-(--cols)"
			aria-hidden="true"
		>
			{#if selectable}<span></span>{/if}
			{#each ordered as c (c)}
				<span
					class={cn(
						'min-w-0 truncate',
						c !== 'title' && cellClass,
						['votes', 'comments', 'created', 'updated'].includes(c) && 'justify-end'
					)}>{c === 'title' ? 'Title' : TICKET_COLUMN_META[c].label}</span
				>
			{/each}
			{#if quick}<span></span>{/if}
		</div>
		<ul class="divide-y divide-border" aria-label={label}>
			{#each rows as t (`${t.projectKey}-${t.number}`)}
				{@const ref = ticketRef(t.projectKey, t.number)}
				<li
					class={cn(
						'relative grid grid-cols-(--mcols) items-center gap-x-3 px-3 py-2 transition-colors hover:bg-hover sm:grid-cols-(--cols) sm:px-4',
						selected?.includes(t.number) && 'bg-primary-soft hover:bg-primary-soft'
					)}
				>
					{#if selectable}
						<label class="relative z-10 flex cursor-pointer items-center self-stretch">
							<span class="sr-only">Select {ref}</span>
							<Checkbox
								name="ticket"
								value={t.number}
								checked={selected?.includes(t.number)}
								onchange={(e) => toggle(t.number, (e.currentTarget as HTMLInputElement).checked)}
							/>
						</label>
					{/if}
					{#each ordered as c (c)}
						{#if c === 'title'}
							<div class="min-w-0">
								<TicketContextMenu href={href(t.number, t.projectKey)} reference={ref}>
									{#snippet children({ props })}
										<a
											{...props}
											href={href(t.number, t.projectKey)}
											class="font-medium [overflow-wrap:anywhere] text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
											>{t.title}</a
										>
									{/snippet}
								</TicketContextMenu>
								{#if showLabels && t.labels.length}
									<span class="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
										{#each t.labels as l (l.id)}
											<span
												class="swatch-bg swatch-{l.color} rounded px-1.5 text-[0.6875rem] leading-[1.125rem] font-medium"
												>{l.name}</span
											>
										{/each}
									</span>
								{/if}
								<!-- Compact meta line on phones, where the columns are hidden. -->
								<span
									class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:hidden"
								>
									<StatusBadge status={t.status} />
									<span class="font-mono">{ref}</span>
									<TypeBadge type={t.type} />
									<TimeAgo date={t.updatedAt} />
								</span>
							</div>
						{:else}
							<div
								class={cn(
									'min-w-0 items-center text-xs text-muted-foreground',
									cellClass,
									['votes', 'comments', 'created', 'updated'].includes(c) && 'justify-end'
								)}
							>
								{#if c === 'ref'}<span class="font-mono tabular-nums">{ref}</span>
								{:else if c === 'status'}<StatusBadge status={t.status} />
								{:else if c === 'type'}<TypeBadge type={t.type} />
								{:else if c === 'priority'}<PriorityBadge priority={t.priority} />
								{:else if c === 'project'}<span class="flex min-w-0 items-center gap-1.5"
										><ProjectIcon
											project={{
												name: t.projectName,
												icon: t.projectIcon,
												color: t.projectColor,
												logoId: t.projectLogoId
											}}
											size="xs"
										/><span class="truncate">{t.projectName}</span></span
									>
								{:else if c === 'assignee'}
									{#if t.assignee}<span class="flex min-w-0 items-center gap-1.5"
											><UserAvatar user={t.assignee} size="xs" /><span class="truncate"
												>{t.assignee.displayName}</span
											></span
										>{:else}<span class="text-subtle-foreground">—</span>{/if}
								{:else if c === 'reporter'}<span class="flex min-w-0 items-center gap-1.5"
										><UserAvatar user={t.reporter} size="xs" /><span class="truncate"
											>{t.reporter.displayName}</span
										></span
									>
								{:else if c === 'votes'}<span
										class="flex items-center gap-0.5 tabular-nums"
										title="{t.voteCount} votes"><ArrowBigUp class="size-3.5" />{t.voteCount}</span
									>
								{:else if c === 'comments'}<span
										class="flex items-center gap-1 tabular-nums"
										title="{t.commentCount} comments"
										><MessageSquare class="size-3.5" />{t.commentCount}</span
									>
								{:else if c === 'release'}<span class="truncate">{t.release?.version ?? '—'}</span>
								{:else if c === 'milestone'}<span class="truncate">{t.milestone?.name ?? '—'}</span>
								{:else if c === 'created'}<TimeAgo date={t.createdAt} />
								{:else if c === 'updated'}<TimeAgo date={t.updatedAt} />{/if}
							</div>
						{/if}
					{/each}
					{#if quick}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="relative z-10 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground data-[state=open]:bg-surface"
								aria-label="Quick actions for {ref}"
							>
								<Ellipsis class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									class={cn(
										menuContentClass,
										'max-h-[var(--bits-dropdown-menu-content-available-height)]'
									)}
									align="end"
									sideOffset={4}
								>
									<p class="px-2 py-1.5 text-xs font-medium text-muted-foreground">{ref}</p>
									{#each groups as [title, op, options] (op)}
										<DropdownMenu.Sub>
											<DropdownMenu.SubTrigger class={menuItemClass}>
												<span class="flex-1">{title}</span><ChevronRight class="size-4" />
											</DropdownMenu.SubTrigger>
											<DropdownMenu.SubContent
												class={cn(menuContentClass, 'max-h-72')}
												sideOffset={4}
											>
												{#each options as o (o.value)}
													<DropdownMenu.Item
														class={menuItemClass}
														disabled={(op === 'status' && o.value === t.status) ||
															(op === 'priority' && o.value === t.priority)}
														onSelect={() =>
															onquick?.(t.number, `${op}:${o.value}`, `${title}: ${o.label}`)}
														>{o.label}</DropdownMenu.Item
													>
												{/each}
											</DropdownMenu.SubContent>
										</DropdownMenu.Sub>
									{/each}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</div>
