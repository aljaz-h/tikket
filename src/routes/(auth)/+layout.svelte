<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	let { children, data } = $props();
</script>

<main id="main" class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
	<a href="/" class="mb-8 text-lg"><Logo name={data.app.name} /></a>
	<div class="w-full max-w-sm">
		{@render children()}
	</div>
</main>
