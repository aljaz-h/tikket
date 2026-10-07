<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/components/ui/button.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	/** Shared error content: concise explanation, back action, dashboard link. No stack traces. */
	const status = $derived(page.status);
	const copy = $derived(
		status === 404
			? {
					title: 'We couldn’t find that page',
					text: 'The link may be wrong, or the page was moved or deleted – or it belongs to a project you can’t see.'
				}
			: status === 403
				? {
						title: 'You don’t have access to this',
						text: 'Ask a project owner or an administrator if you think you should.'
					}
				: status === 401
					? { title: 'Please sign in', text: 'You need to be signed in to see this page.' }
					: status === 429
						? {
								title: 'Slow down a little',
								text: 'Too many requests – wait a moment and try again.'
							}
						: status >= 500
							? {
									title: 'Something went wrong on our side',
									text: 'Your data is safe. Try again in a moment; if it keeps happening, tell an administrator the reference below.'
								}
							: { title: 'That didn’t work', text: '' }
	);
	// Specific messages from the app (e.g. "Ticket not found") are shown; generic ones are not.
	const detail = $derived(
		page.error?.message &&
			!['Not found', 'Not Found', 'Internal Error', 'Something went wrong on our side.'].includes(
				page.error.message
			)
			? page.error.message
			: ''
	);
	const Icon = $derived(
		status === 404 ? SearchX : status === 403 || status === 401 ? Lock : CircleAlert
	);
	const next = $derived(encodeURIComponent(page.url.pathname + page.url.search));
</script>

<div class="mx-auto max-w-md py-12 text-center" role="alert" aria-labelledby="error-title">
	<div
		class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"
	>
		<Icon class="size-6" />
	</div>
	<p class="text-sm font-medium text-muted-foreground">Error {status}</p>
	<h1 id="error-title" class="mt-1 text-xl font-semibold tracking-tight">{copy.title}</h1>
	{#if detail}<p class="mt-2 text-sm">{detail}</p>{/if}
	{#if copy.text}<p class="mt-2 text-sm text-muted-foreground">{copy.text}</p>{/if}
	{#if page.error?.errorId}
		<p class="mt-3 font-mono text-xs text-subtle-foreground">Reference: {page.error.errorId}</p>
	{/if}
	<div class="mt-6 flex flex-wrap justify-center gap-2">
		<Button variant="ghost" onclick={() => history.back()}><ArrowLeft /> Back</Button>
		<Button href="/" variant="secondary">Go to dashboard</Button>
		{#if status === 401 || (status === 404 && !page.data.user)}<Button href="/login?next={next}"
				>Sign in</Button
			>{/if}
	</div>
</div>
