<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { SCOPE_META, type ApiScope } from '$lib/shared/constants';
	import { formatDate } from '$lib/shared/format';

	interface Token {
		id: number;
		name: string;
		prefix: string;
		scopes: string[];
		createdAt: Date;
		lastUsedAt: Date | null;
		expiresAt: Date | null;
		createdBy: string;
		state: 'active' | 'expired' | 'revoked';
	}
	interface Props {
		kind: 'personal' | 'project';
		tokens: Token[];
		scopes: string[];
		form: Record<string, unknown> | null | undefined;
		title: string;
		description: string;
		projectKey?: string;
	}
	let { kind, tokens, scopes, form, title, description, projectKey }: Props = $props();

	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let createOpen = $state(false);
	let revoking = $state<Token | null>(null);
	let revokeOpen = $state(false);
	let busy = $state(false);
	let selected = $state<string[]>([]);
	let expiry = $state('90');
	/** The full token is shown once, right after creation, and never again. */
	let created = $state<{ name: string; token: string } | null>(null);
	let showInactive = $state(false);

	const active = $derived(tokens.filter((t) => t.state === 'active'));
	const inactive = $derived(tokens.filter((t) => t.state !== 'active'));
	const exampleBase = $derived(
		projectKey ? `/api/v1/projects/${projectKey}/tickets` : '/api/v1/projects'
	);

	function openCreate() {
		selected = kind === 'personal' ? ['projects:read', 'tickets:read'] : ['tickets:read'];
		expiry = '90';
		createOpen = true;
	}
	async function copy() {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created.token);
			toast.success('Token copied');
		} catch {
			toast.error('Copy failed – select the token manually');
		}
	}
	const stateOf = (t: Token) =>
		t.state === 'active'
			? ({ state: 'ok', label: 'Active' } as const)
			: t.state === 'expired'
				? ({ state: 'warn', label: 'Expired' } as const)
				: ({ state: 'off', label: 'Revoked' } as const);
</script>

<div class="grid gap-6">
	<Card class="grid gap-4 p-5 sm:p-6">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-xl min-w-0">
				<h2 class="text-base font-semibold">{title}</h2>
				<p class="text-sm text-muted-foreground">{description}</p>
			</div>
			<Button onclick={openCreate}><Plus /> New token</Button>
		</div>
		<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
			<a href="/docs/api" class="inline-flex items-center gap-1 text-link hover:underline"
				><BookOpen class="size-3.5" /> API documentation</a
			>
			<span>Send it as <code class="font-mono">Authorization: Bearer &lt;token&gt;</code></span>
		</p>
	</Card>

	{#if created}
		<div
			role="status"
			class="grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4"
			data-testid="new-token"
		>
			<p class="flex items-start gap-2 text-sm font-medium">
				<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" /> Copy “{created.name}” now – it
				will not be shown again.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<code
					class="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
					>{created.token}</code
				>
				<Button variant="outline" size="sm" onclick={copy}><Copy /> Copy</Button>
				<Button variant="ghost" size="sm" onclick={() => (created = null)}>I saved it</Button>
			</div>
			<pre
				class="overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">curl -H "Authorization: Bearer $TIKKET_TOKEN" {exampleBase}</pre>
			<p class="text-xs text-muted-foreground">
				Keep it in a secret store (CI secrets, a password manager). Anyone with it can use the API
				with its scopes. If it leaks, revoke it.
			</p>
		</div>
	{/if}

	{#if active.length}
		<ul class="grid gap-3" aria-label="Active tokens">
			{#each active as token (token.id)}
				{@render row(token)}
			{/each}
		</ul>
	{:else}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
		>
			No active tokens.
		</p>
	{/if}

	{#if inactive.length}
		<div class="grid gap-3">
			<button
				type="button"
				class="justify-self-start text-xs font-medium text-muted-foreground hover:text-foreground"
				aria-expanded={showInactive}
				onclick={() => (showInactive = !showInactive)}
			>
				{showInactive ? 'Hide' : 'Show'} expired and revoked tokens ({inactive.length})
			</button>
			{#if showInactive}
				<ul class="grid gap-3" aria-label="Expired and revoked tokens">
					{#each inactive as token (token.id)}
						{@render row(token)}
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

{#snippet row(token: Token)}
	{@const st = stateOf(token)}
	<li>
		<Card class="grid gap-3 p-4 sm:p-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<h3 class="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<KeyRound class="size-4 text-muted-foreground" />
						<span class="[overflow-wrap:anywhere]">{token.name}</span>
						<IntegrationStatus state={st.state} label={st.label} />
					</h3>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{token.prefix}</p>
				</div>
				{#if token.state !== 'revoked'}
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						onclick={() => {
							revoking = token;
							revokeOpen = true;
						}}>Revoke</Button
					>
				{/if}
			</div>
			<ul class="flex flex-wrap gap-1.5" aria-label="Scopes">
				{#each token.scopes as s (s)}
					<li class="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs">
						{s}
					</li>
				{/each}
			</ul>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
				<div>
					<dt class="text-muted-foreground">Created</dt>
					<dd><TimeAgo date={token.createdAt} /></dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Last used</dt>
					<dd>
						{#if token.lastUsedAt}<TimeAgo date={token.lastUsedAt} />{:else}Never{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Expires</dt>
					<dd>{token.expiresAt ? formatDate(token.expiresAt) : 'Never'}</dd>
				</div>
				{#if kind === 'project'}
					<div>
						<dt class="text-muted-foreground">Created by</dt>
						<dd class="[overflow-wrap:anywhere]">{token.createdBy}</dd>
					</div>
				{/if}
			</dl>
		</Card>
	</li>
{/snippet}

<Dialog
	bind:open={createOpen}
	title="New {kind === 'personal' ? 'personal access' : 'project API'} token"
	description="The token is shown once after it is created."
	size="lg"
>
	<form
		method="POST"
		action="?/create"
		class="grid gap-4"
		autocomplete="off"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					const e = (result.data?.errors ?? {}) as Record<string, string>;
					toast.error(Object.values(e)[0] ?? 'That did not work.');
					await update({ reset: false });
					return;
				}
				if (result.type === 'error') {
					toast.error(result.error?.message ?? 'Something went wrong.');
					return;
				}
				if (result.type === 'success') {
					const c = result.data?.created as { name: string; token: string } | undefined;
					if (c) created = { name: c.name, token: c.token };
					createOpen = false;
					toast.success('Token created');
				}
				await update({ reset: false });
			};
		}}
	>
		<FormMessage message={errors.form} />
		<Field
			label="Name"
			for="token-name"
			error={errors.name}
			required
			hint="What uses it, e.g. “GitHub Actions”."
		>
			<Input id="token-name" name="name" required maxlength={60} placeholder="CI pipeline" />
		</Field>
		<Field label="Expires" for="token-expiry">
			<Select
				id="token-expiry"
				name="expiry"
				bind:value={expiry}
				items={[
					{ value: '7', label: 'In 7 days' },
					{ value: '30', label: 'In 30 days' },
					{ value: '90', label: 'In 90 days' },
					{ value: '365', label: 'In 1 year' },
					{ value: 'never', label: 'Never' }
				]}
			/>
		</Field>
		<fieldset class="grid gap-2">
			<legend class="mb-1 text-[0.8125rem] font-medium">Scopes</legend>
			{#if errors.scopes}<p class="text-xs text-destructive">{errors.scopes}</p>{/if}
			<div class="grid gap-2 sm:grid-cols-2">
				{#each scopes as s (s)}
					<label
						class="flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft"
					>
						<Checkbox name="scopes" value={s} bind:group={selected} class="mt-0.5" />
						<span class="min-w-0">
							<span class="block font-mono text-xs font-medium">{s}</span>
							<span class="block text-xs text-muted-foreground">{SCOPE_META[s as ApiScope]}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>
		<div class="flex flex-wrap justify-end gap-2">
			<Button type="button" variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" loading={busy} disabled={!selected.length}>Create token</Button>
		</div>
	</form>
</Dialog>

<ConfirmDialog
	bind:open={revokeOpen}
	title="Revoke “{revoking?.name}”?"
	description="Anything using this token stops working immediately. This can't be undone."
	confirmLabel="Revoke token"
	destructive
	action="?/revoke"
	fields={{ id: revoking?.id ?? 0 }}
	successMessage="Token revoked"
/>
