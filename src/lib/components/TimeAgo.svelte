<script lang="ts">
	import { formatDateTime, timeAgo } from '$lib/shared/format';
	let { date, class: className }: { date: Date | string | number; class?: string } = $props();
	const iso = $derived(new Date(date).toISOString());
</script>

<time datetime={iso} title={formatDateTime(date)} class={className}>{timeAgo(date)}</time>
