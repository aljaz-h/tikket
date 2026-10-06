<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Popover } from 'bits-ui';
	import Columns3Cog from '@lucide/svelte/icons/columns-3-cog';
	import PopoverContent from './ui/popover-content.svelte';
	import Checkbox from './ui/checkbox.svelte';
	import Button from './ui/button.svelte';
	import {
		COLUMNS_COOKIE,
		DEFAULT_TICKET_COLUMNS,
		TICKET_COLUMN_META,
		type TicketColumn
	} from '$lib/shared/constants';

	interface Props {
		columns: TicketColumn[];
		available: TicketColumn[];
	}
	let { columns, available }: Props = $props();
	let open = $state(false);
	let chosen = $state<TicketColumn[]>([]);
	$effect.pre(() => {
		if (!open) chosen = [...columns];
	});

	function apply(next: TicketColumn[]) {
		// Keep the chosen order of the full column list, not click order.
		const cols = available.filter((c) => next.includes(c));
		try {
			document.cookie = `${COLUMNS_COOKIE}=${cols.join(',')}; path=/; max-age=31536000; samesite=lax`;
		} catch {
			/* ignore */
		}
		const url = new URL(page.url);
		url.searchParams.set('cols', cols.join(','));
		open = false;
		goto(url, { noScroll: true, keepFocus: true });
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" aria-label="Choose columns"
				><Columns3Cog /> <span class="hidden sm:inline">Columns</span></Button
			>
		{/snippet}
	</Popover.Trigger>
	<PopoverContent class="w-60" align="end">
		<fieldset class="grid gap-1">
			<legend class="mb-1 text-xs font-semibold text-muted-foreground">Visible columns</legend>
			<p class="mb-1 text-xs text-muted-foreground">The title is always shown.</p>
			{#each available as c (c)}
				<label class="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-hover">
					<Checkbox
						checked={chosen.includes(c)}
						onchange={(e) =>
							(chosen = (e.currentTarget as HTMLInputElement).checked
								? [...chosen, c]
								: chosen.filter((x) => x !== c))}
					/>{TICKET_COLUMN_META[c].label}
				</label>
			{/each}
		</fieldset>
		<div class="mt-3 flex justify-between gap-2">
			<Button
				size="sm"
				variant="ghost"
				onclick={() => apply(DEFAULT_TICKET_COLUMNS.filter((c) => available.includes(c)))}
				>Reset</Button
			>
			<Button size="sm" onclick={() => apply(chosen)}>Apply columns</Button>
		</div>
	</PopoverContent>
</Popover.Root>
