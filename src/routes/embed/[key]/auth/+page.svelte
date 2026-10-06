<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';

	let { data } = $props();
	let error = $state('');
	let pending = $state(false);
	let done = $state(false);
	const hostName = $derived(new URL(data.host).host);
</script>

<main id="main" class="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
	<div class="mb-6"><Logo name={data.app.name} /></div>
	<Card class="w-full max-w-sm p-6">
		{#if done}
			<div class="grid gap-2 text-center" role="status">
				<ShieldCheck class="mx-auto size-8 text-[var(--tone-completed)]" />
				<h1 class="text-base font-semibold">You’re signed in</h1>
				<p class="text-sm text-muted-foreground">
					Return to {hostName} to continue. You can close this window.
				</p>
			</div>
		{:else if !data.signedInAs}
			<h1 class="text-base font-semibold">Sign in to send feedback</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				{hostName} uses Tikket to collect feedback for {data.projectName}.
			</p>
			<form
				method="POST"
				action="?/login&host={encodeURIComponent(data.host)}"
				class="mt-5 grid gap-4"
				use:enhance={() => {
					pending = true;
					error = '';
					return async ({ result }) => {
						pending = false;
						if (result.type === 'failure')
							error =
								Object.values((result.data?.errors ?? {}) as Record<string, string>)[0] ??
								'Sign-in failed';
						else if (result.type === 'success') await invalidateAll();
						else if (result.type === 'error') error = 'Something went wrong.';
					};
				}}
			>
				<FormMessage message={error} />
				<Field label="Username or email" for="identifier"
					><Input id="identifier" name="identifier" autocomplete="username" required /></Field
				>
				<Field label="Password" for="password"
					><Input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
					/></Field
				>
				<Button type="submit" class="w-full" loading={pending}>Sign in</Button>
			</form>
			{#if data.registrationEnabled}
				<p class="mt-4 text-center text-sm text-muted-foreground">
					No account? <a
						href="/register"
						target="_blank"
						rel="noopener"
						class="font-medium text-primary hover:underline">Create one</a
					>, then sign in here.
				</p>
			{/if}
		{:else if !data.canSubmit}
			<h1 class="text-base font-semibold">No access to {data.projectName}</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				You’re signed in as {data.signedInAs}, but this account can’t submit feedback to this
				project. Ask the project owner for an invitation.
			</p>
		{:else}
			<h1 class="text-base font-semibold">Allow feedback from {hostName}?</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				The feedback form on <strong class="text-foreground">{data.host}</strong> will be able to
				submit reports to
				<strong class="text-foreground">{data.projectName}</strong> as
				<strong class="text-foreground">{data.signedInAs}</strong>
				for the next {data.hours} hours. It cannot read your tickets or change anything else.
			</p>
			<form
				method="POST"
				action="?/authorize&host={encodeURIComponent(data.host)}"
				class="mt-5 grid gap-2"
				use:enhance={() => {
					pending = true;
					error = '';
					return async ({ result }) => {
						pending = false;
						if (result.type === 'success' && result.data?.token) {
							const msg = {
								type: 'tikket:token',
								token: result.data.token,
								expiresAt: result.data.expiresAt,
								displayName: result.data.displayName
							};
							// Hand the token to the widget iframe (same origin as this page) and close.
							if (window.opener) {
								window.opener.postMessage(msg, location.origin);
								window.close();
							}
							done = true;
						} else if (result.type === 'failure')
							error =
								Object.values((result.data?.errors ?? {}) as Record<string, string>)[0] ??
								'Not allowed';
						else error = 'Something went wrong.';
					};
				}}
			>
				<FormMessage message={error} />
				<Button type="submit" class="w-full" loading={pending}>Allow and continue</Button>
				<Button variant="ghost" class="w-full" onclick={() => window.close()}>Cancel</Button>
			</form>
		{/if}
	</Card>
</main>
