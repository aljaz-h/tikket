<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/components/ui/button.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
</script>

<svelte:head><title>{page.status} · Tikket</title></svelte:head>

<main id="main" class="flex min-h-dvh items-center justify-center px-4">
	<div class="max-w-md text-center">
		<div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
			<CircleAlert class="size-6" />
		</div>
		<p class="text-sm font-medium text-muted-foreground">Error {page.status}</p>
		<h1 class="mt-1 text-xl font-semibold tracking-tight">
			{page.status === 404
				? 'We couldn’t find that page'
				: page.status === 403
					? 'You don’t have access to this'
					: page.status === 401
						? 'Please sign in'
						: 'Something went wrong'}
		</h1>
		<p class="mt-2 text-sm text-muted-foreground">{page.error?.message}</p>
		{#if page.error?.errorId}
			<p class="mt-2 font-mono text-xs text-subtle-foreground">Reference: {page.error.errorId}</p>
		{/if}
		<div class="mt-6 flex justify-center gap-2">
			<Button href="/" variant="secondary">Go to dashboard</Button>
			{#if page.status === 401}<Button href="/login">Sign in</Button>{/if}
		</div>
	</div>
</main>
