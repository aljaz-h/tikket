<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AccountFields from '$lib/components/AccountFields.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { PROJECT_ROLE_META } from '$lib/shared/constants';

	let { data, form } = $props();
	let pending = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<Card class="p-6">
	{#if !data.valid}
		<h1 class="text-lg font-semibold tracking-tight">Invitation unavailable</h1>
		<p class="mt-2 text-sm text-muted-foreground">
			This invitation link is invalid, has expired or was already used. Ask the person who invited
			you for a new link.
		</p>
		<Button href="/login" variant="secondary" class="mt-5 w-full">Go to sign in</Button>
	{:else}
		<h1 class="text-lg font-semibold tracking-tight">You’re invited</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			{data.inviterName} invited you
			{#if data.projectName}
				to join <strong class="text-foreground">{data.projectName}</strong> as
				{PROJECT_ROLE_META[data.projectRole ?? 'member'].label.toLowerCase()}{:else}to join Tikket{/if}{#if data.role === 'admin'}
				with administrator access{/if}.
		</p>
		<div class="mt-5">
			<FormMessage message={errors.form} />
		</div>
		{#if data.signedInAs && data.projectName}
			<form method="POST" action="?/accept" class="mt-4 grid gap-3" use:enhance>
				<p class="text-sm">
					Signed in as <strong>{data.signedInAs.displayName}</strong> ({data.signedInAs.email}).
				</p>
				<Button type="submit" class="w-full">Join {data.projectName}</Button>
			</form>
		{:else if data.signedInAs}
			<p class="mt-4 text-sm text-muted-foreground">
				You already have an account. Sign out to use this invitation for a new account.
			</p>
		{:else}
			<form
				method="POST"
				action="?/register"
				class="mt-4 grid gap-4"
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						await update({ reset: false });
						pending = false;
					};
				}}
			>
				<AccountFields {errors} {values} lockedEmail={data.email} />
				<Button type="submit" class="w-full" loading={pending}>Create account & join</Button>
			</form>
			{#if data.projectName}
				<p class="mt-4 text-center text-sm text-muted-foreground">
					Already have an account?
					<a
						href="/login?next=/invite/{encodeURIComponent(page.params.token ?? '')}"
						class="font-medium text-primary hover:underline">Sign in to accept</a
					>
				</p>
			{/if}
		{/if}
	{/if}
</Card>
