<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { goto } from '$app/navigation';
	import Search from '@lucide/svelte/icons/search';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import StatusBadge from '../StatusBadge.svelte';
	import ProjectIcon from '../ProjectIcon.svelte';
	import { projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketStatus } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	interface Result {
		tickets: {
			number: number;
			title: string;
			status: TicketStatus;
			projectKey: string;
			projectName: string;
		}[];
		projects: { key: string; name: string; icon: string | null; color: string }[];
	}
	let q = $state('');
	let results = $state<Result>({ tickets: [], projects: [] });
	let loading = $state(false);
	let active = $state(0);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	const flat = $derived([
		...results.projects.map((p) => ({ href: projectPath(p.key), key: `p-${p.key}` })),
		...results.tickets.map((t) => ({
			href: ticketPath(t.projectKey, t.number),
			key: `t-${t.projectKey}-${t.number}`
		}))
	]);

	function search(value: string) {
		clearTimeout(timer);
		if (value.trim().length < 2) {
			results = { tickets: [], projects: [] };
			loading = false;
			return;
		}
		loading = true;
		timer = setTimeout(async () => {
			controller?.abort();
			controller = new AbortController();
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
					signal: controller.signal
				});
				if (res.ok) {
					results = await res.json();
					active = 0;
				}
			} catch {
				/* aborted */
			} finally {
				loading = false;
			}
		}, 200);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			active = Math.min(active + 1, flat.length - 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = Math.max(active - 1, 0);
			e.preventDefault();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const target = flat[active];
			if (target) {
				open = false;
				goto(target.href);
			} else if (q.trim()) {
				open = false;
				goto(`/search?q=${encodeURIComponent(q)}`);
			}
		}
	}

	$effect(() => {
		if (!open) {
			q = '';
			results = { tickets: [], projects: [] };
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-pop outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
		>
			<Dialog.Title class="sr-only">Search</Dialog.Title>
			<div class="flex items-center gap-2 border-b border-border px-3">
				<Search class="size-4 shrink-0 text-muted-foreground" />
				<input
					bind:value={q}
					oninput={() => search(q)}
					onkeydown={onKey}
					placeholder="Search tickets and projects…  (try SPL-12)"
					class="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
					role="combobox"
					aria-expanded={flat.length > 0}
					aria-controls="search-results"
					aria-activedescendant={flat[active] ? `sr-${flat[active].key}` : undefined}
					aria-autocomplete="list"
				/>
				{#if loading}<LoaderCircle class="size-4 animate-spin text-muted-foreground" />{/if}
			</div>
			<div id="search-results" role="listbox" class="max-h-[60vh] overflow-y-auto p-1.5">
				{#if q.trim().length < 2}
					<p class="px-3 py-6 text-center text-sm text-muted-foreground">
						Type at least two characters to search.
					</p>
				{:else if !loading && !flat.length}
					<p class="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{q}”.</p>
				{/if}
				{#if results.projects.length}
					<p class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Projects</p>
					{#each results.projects as p, i (p.key)}
						<a
							id="sr-p-{p.key}"
							role="option"
							aria-selected={active === i}
							href={projectPath(p.key)}
							onclick={() => (open = false)}
							onmouseenter={() => (active = i)}
							class={cn(
								'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
								active === i && 'bg-hover'
							)}
						>
							<ProjectIcon project={p} />
							<span class="flex-1 truncate">{p.name}</span>
							<span class="font-mono text-xs text-muted-foreground">{p.key}</span>
						</a>
					{/each}
				{/if}
				{#if results.tickets.length}
					<p class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">Tickets</p>
					{#each results.tickets as t, j (`${t.projectKey}-${t.number}`)}
						{@const i = results.projects.length + j}
						<a
							id="sr-t-{t.projectKey}-{t.number}"
							role="option"
							aria-selected={active === i}
							href={ticketPath(t.projectKey, t.number)}
							onclick={() => (open = false)}
							onmouseenter={() => (active = i)}
							class={cn(
								'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
								active === i && 'bg-hover'
							)}
						>
							<StatusBadge status={t.status} iconOnly />
							<span class="w-16 shrink-0 font-mono text-xs text-muted-foreground"
								>{ticketRef(t.projectKey, t.number)}</span
							>
							<span class="flex-1 truncate">{t.title}</span>
							{#if active === i}<CornerDownLeft class="size-3.5 text-muted-foreground" />{/if}
						</a>
					{/each}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
