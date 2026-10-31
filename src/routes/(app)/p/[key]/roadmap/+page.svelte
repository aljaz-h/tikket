<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { DropdownMenu } from 'bits-ui';
	import { flip } from 'svelte/animate';
	import { toast } from 'svelte-sonner';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Download from '@lucide/svelte/icons/download';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Flag from '@lucide/svelte/icons/flag';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Lock from '@lucide/svelte/icons/lock';
	import Package from '@lucide/svelte/icons/package';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import ProgressStrip from '$lib/components/roadmap/ProgressStrip.svelte';
	import RoadmapCard, { type RoadmapCardData } from '$lib/components/roadmap/RoadmapCard.svelte';
	import RoadmapControls, {
		type RoadmapGroup,
		type RoadmapViewMode
	} from '$lib/components/roadmap/RoadmapControls.svelte';
	import RoadmapTimeline from '$lib/components/roadmap/RoadmapTimeline.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import MenuContent from '$lib/components/ui/menu-content.svelte';
	import MenuItem from '$lib/components/ui/menu-item.svelte';
	import { ms, receive, send } from '$lib/motion';
	import {
		ROADMAP_AUDIENCE_LABEL,
		STATUS_META,
		TICKET_TYPES,
		type TicketStatus,
		type TicketType
	} from '$lib/shared/constants';
	import { projectPath, ticketRef } from '$lib/shared/format';
	import {
		COLUMN_CAP,
		capGroups,
		cardDate,
		groupCompleted,
		monthKey,
		shortDate
	} from '$lib/shared/roadmap-view';
	import { allowedTargets, checkTransition } from '$lib/shared/workflow-settings';

	let { data } = $props();
	type Card = RoadmapCardData;
	type ColumnStatus = 'open' | 'planned' | 'in_progress' | 'completed';

	const allColumns: { status: ColumnStatus; hint: string }[] = [
		{ status: 'open', hint: 'Not yet committed to the roadmap' },
		{ status: 'planned', hint: 'Accepted for future development' },
		{ status: 'in_progress', hint: 'Currently being implemented' },
		{ status: 'completed', hint: 'Finished in the last 90 days' }
	];
	const accent = $derived(data.project.accentColor);
	const r = $derived(data.roadmap);
	const now = $derived(new Date(data.now));
	const columnLabel = (status: ColumnStatus) =>
		status === 'open'
			? 'Open / Unplanned'
			: status === 'completed'
				? 'Recently completed'
				: STATUS_META[status].label;

	// ── Controls (kept in the address so a view can be shared) ──
	const view = $derived<RoadmapViewMode>(
		page.url.searchParams.get('view') === 'timeline' ? 'timeline' : 'board'
	);
	const typeFilter = $derived<TicketType | null>(
		TICKET_TYPES.find((t) => t === page.url.searchParams.get('type')) ?? null
	);
	const group = $derived<RoadmapGroup>(
		(['milestone', 'month'] as const).find((g) => g === page.url.searchParams.get('group')) ??
			'status'
	);
	function changeControls(patch: {
		type?: TicketType | null;
		group?: RoadmapGroup;
		view?: RoadmapViewMode;
	}) {
		const url = new URL(page.url);
		const set = (key: string, value: string | null) =>
			value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		if ('type' in patch) set('type', patch.type ?? null);
		if (patch.group) set('group', patch.group === 'status' ? null : patch.group);
		if (patch.view) set('view', patch.view === 'board' ? null : patch.view);
		void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// ── Moving tickets between columns (staff) ──
	// A local copy of the columns lets a card move (or a vote count change) at once; it is
	// replaced by the server's answer after every change and restored if the server refuses.
	type Columns = Record<ColumnStatus, Card[]>;
	type Totals = Record<ColumnStatus, number>;
	let local = $state<Columns>({ open: [], planned: [], in_progress: [], completed: [] });
	let totals = $state<Totals>({ open: 0, planned: 0, in_progress: 0, completed: 0 });
	$effect.pre(() => {
		local = {
			open: [...r.columns.open],
			planned: [...r.columns.planned],
			in_progress: [...r.columns.in_progress],
			completed: [...r.columns.completed]
		};
		totals = { ...r.totals };
	});
	const workflow = $derived(data.workflow);
	const staff = $derived(data.workflow !== null);
	const ref = (n: number) => ticketRef(data.project.key, n);
	const visible = (c: Card) => !typeFilter || c.type === typeFilter;

	/** Why `card` cannot go to `to` (null = allowed). The server enforces the same rules. */
	function problem(card: Card, to: TicketStatus): string | null {
		if (!workflow) return 'Only staff can move tickets';
		const reason = checkTransition(workflow, card.status as TicketStatus, to, null);
		return reason?.startsWith('A note is required')
			? `${reason} Open the ticket to add one.`
			: reason;
	}

	let busy = $state<number | null>(null);
	let expanded = $state<Record<string, boolean>>({});

	async function move(card: Card, to: ColumnStatus) {
		if (busy !== null || card.status === to) return;
		const reason = problem(card, to);
		if (reason) {
			toast.error(reason);
			return;
		}
		const from = card.status as ColumnStatus;
		const before = { local: { ...local }, totals: { ...totals } };
		busy = card.number;
		// Show the card in its new column right away, at the place the roadmap's own sort
		// (most votes first, newest first; completed by date) will put it.
		const moved = {
			...card,
			status: to,
			completedAt: to === 'completed' ? new Date() : null,
			plannedAt: to === 'planned' ? new Date() : card.plannedAt,
			startedAt: to === 'in_progress' ? new Date() : card.startedAt
		};
		local[from] = local[from].filter((c) => c.number !== card.number);
		const list = local[to];
		const at =
			to === 'completed' ? 0 : list.findIndex((c) => (c.voteCount ?? 0) <= (moved.voteCount ?? 0));
		local[to] = at < 0 ? [...list, moved] : [...list.slice(0, at), moved, ...list.slice(at)];
		totals[from] = Math.max(0, totals[from] - 1);
		totals[to] += 1;
		// A card that lands below the cap is shown by opening the column.
		if ((at < 0 ? list.length : at) >= COLUMN_CAP) expanded = { ...expanded, [to]: true };
		try {
			const body = new FormData();
			body.set('number', String(card.number));
			body.set('status', to);
			const response = await fetch('?/move', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				toast.success(`${ref(card.number)} moved to ${columnLabel(to)}`);
				await invalidateAll();
			} else {
				local = before.local;
				totals = before.totals;
				const errors = result.type === 'failure' ? (result.data?.errors ?? {}) : {};
				toast.error(
					(Object.values(errors)[0] as string | undefined) ??
						(result.type === 'error' ? result.error?.message : undefined) ??
						'That ticket could not be moved.'
				);
			}
		} catch {
			local = before.local;
			totals = before.totals;
			toast.error('Could not reach the server. The ticket was not moved.');
		} finally {
			busy = null;
		}
	}

	async function assignToMe(card: Card) {
		if (busy !== null) return;
		busy = card.number;
		try {
			const body = new FormData();
			body.set('number', String(card.number));
			const response = await fetch('?/assign', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				toast.success(`${ref(card.number)} assigned to you`);
				await invalidateAll();
			} else {
				const errors = result.type === 'failure' ? (result.data?.errors ?? {}) : {};
				toast.error(
					(Object.values(errors)[0] as string | undefined) ?? 'Could not assign the ticket.'
				);
			}
		} catch {
			toast.error('Could not reach the server.');
		} finally {
			busy = null;
		}
	}

	/** Votes from the card: the ticket page's own vote, restored if the server refuses. */
	async function vote(card: Card) {
		if (busy !== null || card.voteCount === null) return;
		const on = !card.voted;
		const status = card.status as ColumnStatus;
		const before = local[status];
		const patch = (next: Partial<Card>) =>
			(local[status] = local[status].map((c) =>
				c.number === card.number ? { ...c, ...next } : c
			));
		patch({ voted: on, voteCount: Math.max(0, card.voteCount + (on ? 1 : -1)) });
		busy = card.number;
		try {
			const body = new FormData();
			body.set('number', String(card.number));
			body.set('on', String(on));
			const response = await fetch('?/vote', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				patch({ voteCount: (result.data as { voteCount: number }).voteCount });
			} else {
				local[status] = before;
				const errors = result.type === 'failure' ? (result.data?.errors ?? {}) : {};
				toast.error(
					(Object.values(errors)[0] as string | undefined) ?? 'Your vote could not be saved.'
				);
			}
		} catch {
			local[status] = before;
			toast.error('Could not reach the server. Your vote was not saved.');
		} finally {
			busy = null;
		}
	}

	// ── Drag and drop (mouse and pen; touch uses the Move to… menu) ──
	let finePointer = $state(false);
	$effect(() => {
		const query = matchMedia('(pointer: fine)');
		const update = () => (finePointer = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});
	let dragging = $state<Card | null>(null);
	let over = $state<string | null>(null);
	function dropState(col: Col): 'self' | 'ok' | string | null {
		if (!dragging || !col.status) return null;
		if (dragging.status === col.status) return 'self';
		return problem(dragging, col.status) ?? 'ok';
	}
	function dragOver(e: DragEvent, col: Col) {
		const state = dropState(col);
		if (!state) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = state === 'ok' ? 'move' : 'none';
		over = col.id;
	}
	function drop(e: DragEvent, col: Col) {
		e.preventDefault();
		const card = dragging;
		const state = dropState(col);
		dragging = null;
		over = null;
		if (!card || !col.status) return;
		if (state === 'ok') void move(card, col.status);
		else if (state !== 'self' && state) toast.error(state);
	}
	const movable = (card: Card) =>
		(workflow ? allowedTargets(workflow, card.status as TicketStatus) : []).filter(
			(s) => s !== 'duplicate'
		);

	// ── Columns for the chosen grouping ──
	interface Col {
		id: string;
		/** Set when the column is a status (cards can be dropped on it). */
		status: ColumnStatus | null;
		label: string;
		hint: string;
		cards: Card[];
		total: number;
		icon: 'status' | 'flag' | 'month';
	}
	const columns = $derived.by<Col[]>(() => {
		const statuses = allColumns.filter((c) => c.status !== 'open' || r.show.open);
		if (group === 'status')
			return statuses.map((c) => {
				const cards = local[c.status].filter(visible);
				return {
					id: c.status,
					status: c.status,
					label: columnLabel(c.status),
					hint: c.hint,
					cards,
					// With a filter on, the count is what is shown; otherwise the real total.
					total: typeFilter ? cards.length : totals[c.status],
					icon: 'status'
				};
			});
		const all = statuses.flatMap((c) => local[c.status]).filter(visible);
		if (group === 'milestone') {
			const order = r.milestones.map((m) => m.name);
			const names = [...new Set(all.map((c) => c.milestone ?? ''))].sort((a, b) => {
				if (!a) return 1;
				if (!b) return -1;
				const ia = order.indexOf(a);
				const ib = order.indexOf(b);
				return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
			});
			return names.map((name) => {
				const cards = all.filter((c) => (c.milestone ?? '') === name);
				return {
					id: `ms-${name || 'none'}`,
					status: null,
					label: name || 'No milestone',
					hint: '',
					cards,
					total: cards.length,
					icon: 'flag'
				};
			});
		}
		const months: Record<number, { label: string; cards: Card[] }> = {};
		for (const c of all) {
			const m = monthKey(cardDate(c, now, (x) => shortDate(x, now)).at);
			(months[m.key] ??= { label: m.label, cards: [] }).cards.push(c);
		}
		return Object.entries(months)
			.map(([key, m]) => [Number(key), m] as const)
			.sort((a, b) => b[0] - a[0])
			.map(([key, m]) => ({
				id: `month-${key}`,
				status: null,
				label: m.label,
				hint: '',
				cards: m.cards,
				total: m.cards.length,
				icon: 'month'
			}));
	});

	type Row =
		| { key: string; kind: 'header'; label: string; text: string }
		| { key: string; kind: 'card'; card: Card };
	/** The rows of a column under the cap (completed cards are grouped by time). */
	function rowsOf(col: Col): { rows: Row[]; hidden: number } {
		const limit = expanded[col.id] ? null : COLUMN_CAP;
		if (col.status === 'completed') {
			const groups = capGroups(groupCompleted(col.cards, now), limit);
			const full = groupCompleted(col.cards, now);
			const rows: Row[] = [];
			let shown = 0;
			for (const g of groups) {
				const size = full.find((x) => x.key === g.key)?.cards.length ?? g.total;
				rows.push({
					key: `h-${g.key}`,
					kind: 'header',
					label: g.label,
					text: g.cards.length < size ? `${g.cards.length} of ${size}` : String(size)
				});
				for (const card of g.cards) rows.push({ key: `c-${card.number}`, kind: 'card', card });
				shown += g.cards.length;
			}
			return { rows, hidden: col.cards.length - shown };
		}
		const shown = limit === null ? col.cards : col.cards.slice(0, limit);
		return {
			rows: shown.map((card) => ({ key: `c-${card.number}`, kind: 'card' as const, card })),
			hidden: col.cards.length - shown.length
		};
	}

	const timelineCards = $derived({
		open: r.show.open ? local.open.filter(visible) : [],
		planned: local.planned.filter(visible),
		in_progress: local.in_progress.filter(visible),
		completed: local.completed.filter(visible)
	});
	const progressItems = $derived(r.milestones.map((m) => ({ ...m, targetDate: m.targetDate })));
</script>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			{#if view === 'timeline'}
				See when each ticket was created, started and finished. Hover a row for exact dates.
			{:else}
				The roadmap is generated automatically from ticket statuses.{#if data.project.votingEnabled && r.show.votes}
					Vote on the requests that matter most to you.{/if}
			{/if}
		</p>
		<div class="flex flex-wrap items-center gap-3">
			{#if data.permissions.isStaff || data.permissions.isOwner}
				<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
					<Lock class="size-3.5" /> Visible to: {ROADMAP_AUDIENCE_LABEL[data.audience]}
					{#if data.permissions.isOwner}·
						<a
							href={projectPath(data.project.key, 'settings/roadmap')}
							class="text-link hover:underline">Change</a
						>{/if}
				</span>
			{/if}
			<Button
				variant="outline"
				size="sm"
				href={projectPath(data.project.key, 'roadmap/export.png?download=1')}
				download="{data.project.key.toLowerCase()}-roadmap.png"
				data-sveltekit-reload
			>
				<Download /> Export image
			</Button>
		</div>
	</div>

	{#if r.milestones.length}
		<ProgressStrip items={progressItems} icon={Flag} label="Milestones" {accent} />
	{/if}
	{#if r.releases.length}
		<ProgressStrip
			items={r.releases.map((x) => ({
				id: x.id,
				name: x.version,
				done: x.done,
				total: x.total,
				targetDate: x.targetDate
			}))}
			icon={Package}
			label="Upcoming releases"
			{accent}
		/>
	{/if}

	<RoadmapControls type={typeFilter} {group} {view} onchange={changeControls} />

	{#if view === 'timeline'}
		<RoadmapTimeline
			projectKey={data.project.key}
			{now}
			open={timelineCards.open}
			planned={timelineCards.planned}
			inProgress={timelineCards.in_progress}
			completed={timelineCards.completed}
			{totals}
			showOpen={r.show.open}
			filtered={typeFilter !== null}
		/>
	{:else}
		<!-- A scrollable region must be focusable so keyboard users can scroll it. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="relative -mx-1 overflow-x-auto px-1 pb-2"
			role="region"
			aria-label="Roadmap columns"
			tabindex="0"
		>
			<div class="grid grid-cols-1 gap-4 sm:auto-cols-[minmax(15rem,1fr)] sm:grid-flow-col">
				{#each columns as col (col.id)}
					{@const state = dropState(col)}
					{@const built = rowsOf(col)}
					<section
						class={[
							'flex flex-col rounded-xl border bg-surface-2/60 transition-colors',
							state === 'ok' && 'border-primary-border bg-primary-soft/20',
							state && state !== 'ok' && state !== 'self' && 'opacity-60',
							!state && 'border-border'
						]}
						aria-labelledby="col-{col.id}"
						ondragover={(e) => dragOver(e, col)}
						ondragleave={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === col.id)
								over = null;
						}}
						ondrop={(e) => drop(e, col)}
					>
						<header
							class="border-b border-border px-4 py-3"
							style:box-shadow={accent ? `inset 0 2px 0 ${accent}` : undefined}
						>
							<div class="flex items-center justify-between gap-2">
								<h2 id="col-{col.id}" class="flex items-center gap-2 text-sm font-semibold">
									{#if col.icon === 'status' && col.status}
										<StatusBadge status={col.status} iconOnly />
									{:else if col.icon === 'flag'}
										<Flag class="size-4 text-muted-foreground" />
									{:else}
										<CalendarDays class="size-4 text-muted-foreground" />
									{/if}{col.label}
									<span class="font-normal text-muted-foreground tabular-nums">{col.total}</span>
								</h2>
								{#if col.status === 'completed'}
									<a
										href={projectPath(data.project.key, 'tickets?status=completed')}
										class="text-xs text-link hover:underline">All tickets</a
									>
								{/if}
							</div>
							{#if col.hint}<p class="text-xs text-muted-foreground">{col.hint}</p>{/if}
						</header>
						<!-- While dragging, the list itself (not a card that may be re-rendered) is the drop target. -->
						<ul
							class={[
								'grid min-h-24 content-start gap-2 p-2',
								dragging && '[&>li]:pointer-events-none'
							]}
						>
							{#if over === col.id && state}
								{#if state === 'ok'}
									<li
										class="rounded-lg border-2 border-dashed border-primary-border px-3 py-4 text-center text-xs font-medium"
										aria-hidden="true"
									>
										Drop to move to {col.label}
									</li>
								{:else if state !== 'self'}
									<li
										class="rounded-lg border-2 border-dashed border-destructive/60 px-3 py-3 text-center text-xs text-destructive"
										role="status"
									>
										{state}
									</li>
								{/if}
							{/if}
							{#each built.rows as row (row.key)}
								<li
									in:receive|local={{ key: row.key }}
									out:send|local={{ key: row.key }}
									animate:flip={{ duration: ms(200) }}
									role={row.kind === 'header' ? 'presentation' : undefined}
									class={row.kind === 'header'
										? 'flex items-baseline gap-2 px-1 pt-2 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase first:pt-0'
										: [
												'group relative rounded-lg border border-border bg-surface transition-colors hover:border-border-strong',
												staff &&
													finePointer &&
													group === 'status' &&
													'cursor-grab active:cursor-grabbing',
												row.kind === 'card' && dragging?.number === row.card.number && 'opacity-40',
												row.kind === 'card' &&
													busy === row.card.number &&
													'pointer-events-none opacity-60'
											]}
									draggable={row.kind === 'card' &&
										staff &&
										finePointer &&
										busy === null &&
										group === 'status'}
									aria-busy={row.kind === 'card' && busy === row.card.number}
									ondragstart={(e) => {
										if (row.kind !== 'card') return;
										const card = row.card;
										// Restyling the card in the same tick would cancel the drag in Chromium.
										setTimeout(() => (dragging = card), 0);
										if (e.dataTransfer) {
											e.dataTransfer.effectAllowed = 'move';
											e.dataTransfer.setData('text/plain', ref(card.number));
										}
									}}
									ondragend={() => {
										dragging = null;
										over = null;
									}}
								>
									{#if row.kind === 'header'}
										<h3 class="contents">
											{row.label} <span class="tabular-nums">{row.text}</span>
										</h3>
									{:else}
										<RoadmapCard
											card={row.card}
											projectKey={data.project.key}
											{now}
											canVote={data.canVote}
											onvote={vote}
										>
											{#snippet actions()}
												{#if staff}
													{@render cardMenu(row.card)}
												{/if}
											{/snippet}
										</RoadmapCard>
										{#if staff && finePointer && group === 'status'}
											<GripVertical
												class="pointer-events-none absolute top-1/2 -left-0.5 size-3.5 -translate-y-1/2 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100"
												aria-hidden="true"
											/>
										{/if}
									{/if}
								</li>
							{:else}
								{#if !(over === col.id && state === 'ok')}
									<li
										class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
									>
										<span class="block font-medium">No tickets</span>
										{#if staff && col.status}<span class="mt-0.5 block"
												>Drag a ticket here or change its status.</span
											>{/if}
									</li>
								{/if}
							{/each}
							{#if col.cards.length > COLUMN_CAP}
								<li role="presentation">
									<button
										type="button"
										aria-expanded={!!expanded[col.id]}
										onclick={() => (expanded = { ...expanded, [col.id]: !expanded[col.id] })}
										class="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground pointer-coarse:h-11"
									>
										{expanded[col.id] ? 'Show less' : `Show ${built.hidden} more`}
										<ChevronDown class="size-4 {expanded[col.id] ? 'rotate-180' : ''}" />
									</button>
								</li>
							{/if}
						</ul>
					</section>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#snippet cardMenu(t: Card)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover pointer-coarse:size-11 {finePointer
				? 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100'
				: ''}"
			aria-label="Actions for {ref(t.number)}"
		>
			<Ellipsis class="size-4" />
		</DropdownMenu.Trigger>
		<MenuContent align="end" class="w-56">
			<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
				Move {ref(t.number)} to…
			</div>
			{#each movable(t) as target (target)}
				{@const reason = problem(t, target)}
				<MenuItem
					disabled={!!reason}
					onSelect={() => move(t, target as ColumnStatus)}
					title={reason ?? undefined}
				>
					<StatusBadge status={target} iconOnly />
					{STATUS_META[target].label}
					{#if reason}<span class="ml-auto text-xs text-muted-foreground">needs a note</span>{/if}
				</MenuItem>
			{:else}
				<p class="px-2 py-1.5 text-xs text-muted-foreground">
					No other status is allowed from here.
				</p>
			{/each}
			{#if data.canAssignSelf}
				<div class="-mx-1 my-1 h-px bg-border"></div>
				{#if t.assigneeId === data.user?.id}
					<MenuItem disabled><UserCheck /> Assigned to you</MenuItem>
				{:else}
					<MenuItem onSelect={() => assignToMe(t)}><UserCheck /> Assign to me</MenuItem>
				{/if}
			{/if}
		</MenuContent>
	</DropdownMenu.Root>
{/snippet}
