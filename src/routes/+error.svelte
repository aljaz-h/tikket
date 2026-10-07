<script lang="ts">
	import { page } from '$app/state';
	import ErrorView from '$lib/components/ErrorView.svelte';
</script>

<svelte:head><title>{page.status} · Tikket</title></svelte:head>

<main id="main" class="flex min-h-dvh items-center justify-center px-4">
	<ErrorView />
</main>
