<script lang="ts">
	import { page } from '$app/state';
	import ErrorView from '$lib/components/ErrorView.svelte';
</script>

<svelte:head><title>{page.status} · Tikket</title></svelte:head>

<ErrorView />
