<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { DropdownMenu } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import Download from '@lucide/svelte/icons/download';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import Button from '$lib/components/ui/button.svelte';
	import MenuContent from '$lib/components/ui/menu-content.svelte';
	import MenuItem from '$lib/components/ui/menu-item.svelte';
	import { allowedTargets, checkTransition } from '$lib/shared/workflow-settings';
	import Flag from '@lucide/svelte/icons/flag';
	import Package from '@lucide/svelte/icons/package';
	import Lock from '@lucide/svelte/icons/lock';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import {
		ROADMAP_AUDIENCE_LABEL,
		STATUS_META,
		type TicketPriority,
		type TicketStatus,
		type TicketType
	} from '$lib/shared/constants';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const allColumns = [
		{ status: 'open', hint: 'Not yet committed to the roadmap' },
		{ status: 'planned', hint: 'Accepted for future development' },
		{ status: 'in_progress', hint: 'Currently being implemented' },
		{ status: 'completed', hint: 'Finished in the last 90 days' }
	] as const;
	type ColumnStatus = (typeof allColumns)[number]['status'];
	type Card = (typeof data.roadmap.columns.planned)[number];
	const accent = $derived(data.project.accentColor);
	const r = $derived(data.roadmap);
	const columns = $derived(allColumns.filter((c) => c.status !== 'open' || r.show.open));
	const columnLabel = (status: ColumnStatus) =>
		status === 'open'
			? 'Open / Unplanned'
			: status === 'completed'
				? 'Recently completed'
				: STATUS_META[status].label;

	// ── Moving tickets between columns (staff) ──
	// A local copy of the columns lets a card move at once; it is replaced by the server's
	// answer after every change and restored if the server refuses.
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

	/** Why `card` cannot go to `to` (null = allowed). The server enforces the same rules. */
	function problem(card: Card, to: TicketStatus): string | null {
		if (!workflow) return 'Only staff can move tickets';
		const reason = checkTransition(workflow, card.status as TicketStatus, to, null);
		return reason?.startsWith('A note is required')
			? `${reason} Open the ticket to add one.`
			: reason;
	}

	let busy = $state<number | null>(null);
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
		const moved = { ...card, status: to, completedAt: to === 'completed' ? new Date() : null };
		local[from] = local[from].filter((c) => c.number !== card.number);
		const list = local[to];
		const at =
			to === 'completed' ? 0 : list.findIndex((c) => (c.voteCount ?? 0) <= (moved.voteCount ?? 0));
		local[to] = at < 0 ? [...list, moved] : [...list.slice(0, at), moved, ...list.slice(at)];
		totals[from] = Math.max(0, totals[from] - 1);
		totals[to] += 1;
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
	let over = $state<ColumnStatus | null>(null);
	function dropState(status: ColumnStatus): 'self' | 'ok' | string | null {
		if (!dragging) return null;
		if (dragging.status === status) return 'self';
		return problem(dragging, status) ?? 'ok';
	}
	function dragOver(e: DragEvent, status: ColumnStatus) {
		const state = dropState(status);
		if (!state) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = state === 'ok' ? 'move' : 'none';
		over = status;
	}
	function drop(e: DragEvent, status: ColumnStatus) {
		e.preventDefault();
		const card = dragging;
		const state = dropState(status);
		dragging = null;
		over = null;
		if (!card) return;
		if (state === 'ok') void move(card, status);
		else if (state !== 'self' && state) toast.error(state);
	}
	const movable = (card: Card) =>
		(workflow ? allowedTargets(workflow, card.status as TicketStatus) : []).filter(
			(s) => s !== 'duplicate'
		);
	const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
</script>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			The roadmap is generated automatically from ticket statuses.{#if data.project.votingEnabled && r.show.votes}
				Vote on the requests that matter most to you.{/if}
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

	{#if r.releases.length || r.milestones.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#if r.releases.length}
				<section
					class="rounded-xl border border-border bg-surface p-4"
					aria-labelledby="rm-releases"
				>
					<h2 id="rm-releases" class="mb-3 flex items-center gap-2 text-sm font-semibold">
						<Package class="size-4 text-muted-foreground" /> Upcoming releases
					</h2>
					<ul class="grid gap-3">
						{#each r.releases as rel (rel.id)}
							<li class="grid gap-1.5">
								<div class="flex items-baseline justify-between gap-2 text-sm">
									<span class="font-medium [overflow-wrap:anywhere]">{rel.version}</span>
									<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
										{rel.done}/{rel.total}{#if rel.targetDate}
											· {formatDate(rel.targetDate)}{/if}
									</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-primary"
										style:width="{pct(rel.done, rel.total)}%"
										style:background={accent ?? undefined}
									></div>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if r.milestones.length}
				<section
					class="rounded-xl border border-border bg-surface p-4"
					aria-labelledby="rm-milestones"
				>
					<h2 id="rm-milestones" class="mb-3 flex items-center gap-2 text-sm font-semibold">
						<Flag class="size-4 text-muted-foreground" /> Milestones
					</h2>
					<ul class="grid gap-3">
						{#each r.milestones as m (m.id)}
							<li class="grid gap-1.5">
								<div class="flex items-baseline justify-between gap-2 text-sm">
									<span class="font-medium [overflow-wrap:anywhere]">{m.name}</span>
									<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
										{m.done}/{m.total}{#if m.targetDate}
											· {formatDate(m.targetDate)}{/if}
									</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-primary"
										style:width="{pct(m.done, m.total)}%"
										style:background={accent ?? undefined}
									></div>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	{/if}

	<!-- A scrollable region must be focusable so keyboard users can scroll it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="relative -mx-1 overflow-x-auto px-1 pb-2"
		role="region"
		aria-label="Roadmap columns"
		tabindex="0"
	>
		<div
			class="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-4"
			style:min-width="min(100%, {columns.length * 15}rem)"
		>
			{#each columns as col (col.status)}
				{@const items = local[col.status]}
				{@const state = dropState(col.status)}
				<section
					class={[
						'flex flex-col rounded-xl border bg-surface-2/60 transition-colors',
						state === 'ok' && 'border-primary-border bg-primary-soft/20',
						state && state !== 'ok' && state !== 'self' && 'opacity-60',
						!state && 'border-border'
					]}
					aria-labelledby="col-{col.status}"
					ondragover={(e) => dragOver(e, col.status)}
					ondragleave={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === col.status)
							over = null;
					}}
					ondrop={(e) => drop(e, col.status)}
				>
					<header
						class="border-b border-border px-4 py-3"
						style:box-shadow={accent ? `inset 0 2px 0 ${accent}` : undefined}
					>
						<h2 id="col-{col.status}" class="flex items-center gap-2 text-sm font-semibold">
							<StatusBadge status={col.status} iconOnly />{columnLabel(col.status)}
							<span class="font-normal text-muted-foreground tabular-nums"
								>{totals[col.status]}</span
							>
						</h2>
						<p class="text-xs text-muted-foreground">{col.hint}</p>
					</header>
					<!-- While dragging, the list itself (not a card that may be re-rendered) is the drop target. -->
					<ul
						class={[
							'grid min-h-24 content-start gap-2 p-2',
							dragging && '[&>li]:pointer-events-none'
						]}
					>
						{#if over === col.status && state}
							{#if state === 'ok'}
								<li
									class="rounded-lg border-2 border-dashed border-primary-border px-3 py-4 text-center text-xs font-medium"
									aria-hidden="true"
								>
									Drop to move to {columnLabel(col.status)}
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
						{#each items as t (t.number)}
							{@const targets = movable(t)}
							<li
								class={[
									'group relative rounded-lg border border-border bg-surface transition-colors hover:border-border-strong',
									staff && finePointer && 'cursor-grab active:cursor-grabbing',
									dragging?.number === t.number && 'opacity-40',
									busy === t.number && 'pointer-events-none opacity-60'
								]}
								draggable={staff && finePointer && busy === null}
								aria-busy={busy === t.number}
								ondragstart={(e) => {
									// Restyling the card in the same tick would cancel the drag in Chromium.
									setTimeout(() => (dragging = t), 0);
									if (e.dataTransfer) {
										e.dataTransfer.effectAllowed = 'move';
										e.dataTransfer.setData('text/plain', ref(t.number));
									}
								}}
								ondragend={() => {
									dragging = null;
									over = null;
								}}
							>
								<a
									href={ticketPath(data.project.key, t.number)}
									draggable="false"
									class={['flex gap-3 rounded-lg p-3', staff && 'pr-10']}
								>
									{#if t.voteCount !== null}
										<span
											class="flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-border text-xs font-semibold tabular-nums"
										>
											<ArrowBigUp class="size-3.5 text-muted-foreground" />{t.voteCount}
										</span>
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block text-sm font-medium [overflow-wrap:anywhere]">{t.title}</span
										>
										<span
											class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
										>
											<span class="font-mono">{ref(t.number)}</span>
											<TypeBadge type={t.type as TicketType} />
											{#if t.priority}<PriorityBadge priority={t.priority as TicketPriority} />{/if}
											{#if t.release}<span class="inline-flex items-center gap-1"
													><Package class="size-3" />{t.release}</span
												>{/if}
											{#if t.milestone}<span class="inline-flex items-center gap-1"
													><Flag class="size-3" />{t.milestone}</span
												>{/if}
											{#if t.assignee}<span>· {t.assignee}</span>{/if}
											{#if t.status === 'completed' && t.completedAt}<span
													>Done {formatDate(t.completedAt)}</span
												>{/if}
										</span>
									</span>
								</a>
								{#if staff}
									{#if finePointer}
										<GripVertical
											class="pointer-events-none absolute right-2.5 bottom-2.5 size-4 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100"
											aria-hidden="true"
										/>
									{/if}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger
											class="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover {finePointer
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
											{#each targets as target (target)}
												{@const reason = problem(t, target)}
												<MenuItem
													disabled={!!reason}
													onSelect={() => move(t, target as ColumnStatus)}
													title={reason ?? undefined}
												>
													<StatusBadge status={target} iconOnly />
													{STATUS_META[target].label}
													{#if reason}<span class="ml-auto text-xs text-muted-foreground"
															>needs a note</span
														>{/if}
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
													<MenuItem onSelect={() => assignToMe(t)}
														><UserCheck /> Assign to me</MenuItem
													>
												{/if}
											{/if}
										</MenuContent>
									</DropdownMenu.Root>
								{/if}
							</li>
						{:else}
							{#if !(over === col.status && state === 'ok')}
								<li
									class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
								>
									<span class="block font-medium">No tickets</span>
									{#if staff}<span class="mt-0.5 block"
											>Drag a ticket here or change its status.</span
										>{/if}
								</li>
							{/if}
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	</div>
</div>
