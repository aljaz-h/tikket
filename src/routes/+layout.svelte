<script lang="ts">
	import '../app.css';
	import { Tooltip } from 'bits-ui';
	import { Toaster } from 'svelte-sonner';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { children, data } = $props();
	// Marks the document as interactive (used by end-to-end tests to avoid hydration races).
	onMount(() => {
		document.documentElement.dataset.hydrated = 'true';
	});
	const toasterTheme = $derived(
		data.theme === 'light' ? 'light' : data.theme === 'dark' ? 'dark' : 'system'
	);
</script>

<svelte:head>
	<title>{page.data.title ? `${page.data.title} · ${data.app.name}` : data.app.name}</title>
</svelte:head>

<a
	href="#main"
	class="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
	>Skip to content</a
>

<Tooltip.Provider>
	{@render children()}
</Tooltip.Provider>

<!-- Restrained notifications: at most three visible, dismissible, colour only on the icon. -->
<Toaster
	theme={toasterTheme}
	position="bottom-right"
	closeButton
	visibleToasts={3}
	duration={4500}
	toastOptions={{
		class:
			'!bg-popover !text-foreground !border-border !shadow-pop !rounded-lg !font-sans !text-[0.8125rem]',
		classes: {
			description: '!text-muted-foreground whitespace-pre-line',
			closeButton: '!bg-popover !border-border !text-muted-foreground hover:!text-foreground',
			success: '[&_[data-icon]]:!text-success',
			error: '[&_[data-icon]]:!text-destructive',
			warning: '[&_[data-icon]]:!text-warning',
			info: '[&_[data-icon]]:!text-info'
		}
	}}
/>
