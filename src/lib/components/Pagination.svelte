<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Button from './ui/button.svelte';

	interface Props {
		page: number;
		pages: number;
		total: number;
		href: (page: number) => string;
		label?: string;
	}
	let { page, pages, total, href, label = 'items' }: Props = $props();
</script>

{#if pages > 1}
	<nav class="flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
		<p class="text-muted-foreground">
			Page <span class="font-medium text-foreground">{page}</span> of {pages} · {total}
			{label}
		</p>
		<div class="flex gap-2">
			<Button
				variant="outline"
				size="sm"
				href={page > 1 ? href(page - 1) : undefined}
				disabled={page <= 1}
				aria-label="Previous page"
			>
				<ChevronLeft /> Previous
			</Button>
			<Button
				variant="outline"
				size="sm"
				href={page < pages ? href(page + 1) : undefined}
				disabled={page >= pages}
				aria-label="Next page"
			>
				Next <ChevronRight />
			</Button>
		</div>
	</nav>
{/if}
