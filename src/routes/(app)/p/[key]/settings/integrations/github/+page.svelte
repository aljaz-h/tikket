<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Unplug from '@lucide/svelte/icons/unplug';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationBack from '$lib/components/integrations/IntegrationBack.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { MERGE_ACTION_LABEL, MERGE_ACTIONS, type MergeAction } from '$lib/shared/constants';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);
	const conn = $derived(data.connection);
	let mergeAction = $state<MergeAction>('none');
	let clearToken = $state(false);
	let secret = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let disconnectOpen = $state(false);
	$effect.pre(() => {
		mergeAction = data.connection?.mergeAction ?? 'none';
		clearToken = false;
	});
	const status = $derived(
		!conn
			? ({ state: 'off', label: 'Not connected' } as const)
			: conn.lastError
				? ({ state: 'error', label: 'Error' } as const)
				: conn.lastEventAt
					? ({ state: 'ok', label: 'Connected' } as const)
					: ({ state: 'warn', label: 'Waiting for the first event' } as const)
	);

	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${what} copied`);
		} catch {
			toast.error('Copy failed – select the text manually');
		}
	}
	const withSecret = (name: string, success: string) => () => {
		busy = name;
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			busy = null;
			if (result.type === 'success') {
				if (typeof result.data?.secret === 'string') secret = result.data.secret;
				toast.success(success);
			} else if (result.type === 'failure') {
				const e = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(e)[0] ?? 'That did not work.');
			}
			await update({ reset: false });
		};
	};
	const testSubmit = () => {
		busy = 'test';
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			busy = null;
			if (result.type === 'success') toast.success(String(result.data?.tested ?? 'Reachable'));
			else if (result.type === 'failure')
				toast.error(String((result.data?.errors as Record<string, string>)?.form ?? 'Failed'));
			await update({ reset: false });
		};
	};
</script>

<IntegrationBack project={data.project.key} title="GitHub" />

<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
	<div class="grid content-start gap-6">
		<Card class="grid gap-4 p-5 sm:p-6">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-base font-semibold">GitHub</h2>
				<IntegrationStatus state={status.state} label={status.label} />
			</div>
			<p class="text-sm text-muted-foreground">
				Mention a ticket key such as <code class="font-mono text-xs">{data.project.key}-42</code> in a
				commit message or in a pull request title or description, and the ticket shows the commit or pull
				request in its Development section. Only keys of this project are linked. Tikket never changes
				your repository.
			</p>
			{#if !data.encryptionAvailable}
				<FormMessage
					message="ENCRYPTION_KEY is not set on the server, so the webhook secret can't be stored. Add a key and restart Tikket."
				/>
			{/if}

			{#if !conn}
				<form
					method="POST"
					action="?/connect"
					class="grid gap-4"
					autocomplete="off"
					use:enhance={withSecret('connect', 'Repository connected')}
				>
					<Field
						label="Repository"
						for="repository"
						error={errors.repository}
						required
						hint="owner/name or the repository URL. One repository per project."
					>
						<Input
							id="repository"
							name="repository"
							required
							placeholder="aljaz-h/spool-tracker"
							value={values.repository ?? ''}
							spellcheck="false"
						/>
					</Field>
					<Field
						label="Read-only token"
						for="token"
						error={errors.token}
						optional
						hint="Only needed for private repositories, to test the connection and read titles of links you add by hand. Use a fine-grained token limited to this repository with read-only Metadata, Contents and Pull requests access. Stored encrypted."
					>
						<Input id="token" name="token" type="password" autocomplete="off" />
					</Field>
					<Field label="When a linked pull request is merged" for="mergeAction">
						<Select
							id="mergeAction"
							name="mergeAction"
							bind:value={mergeAction}
							items={MERGE_ACTIONS.map((m) => ({ value: m, label: MERGE_ACTION_LABEL[m] }))}
						/>
					</Field>
					<div class="flex justify-end border-t border-border pt-4">
						<Button
							type="submit"
							loading={busy === 'connect'}
							disabled={!data.encryptionAvailable || data.archived}>Connect repository</Button
						>
					</div>
				</form>
			{:else}
				<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
					<dt class="text-muted-foreground">Repository</dt>
					<dd>
						<a
							href="https://github.com/{conn.owner}/{conn.repo}"
							target="_blank"
							rel="noopener noreferrer"
							class="font-medium [overflow-wrap:anywhere] text-link hover:underline"
							>{conn.owner}/{conn.repo}</a
						>
					</dd>
					<dt class="text-muted-foreground">Owner</dt>
					<dd>{conn.owner}</dd>
					<dt class="text-muted-foreground">Last event</dt>
					<dd>
						{#if conn.lastEventAt}{conn.lastEventType} · <TimeAgo
								date={conn.lastEventAt}
							/>{:else}None yet{/if}
					</dd>
					<dt class="text-muted-foreground">Token</dt>
					<dd>{conn.hasToken ? '•••••••• (stored)' : 'None (public repository)'}</dd>
					{#if conn.lastError}
						<dt class="text-muted-foreground">Recent error</dt>
						<dd class="[overflow-wrap:anywhere] text-destructive">
							{conn.lastError}
							{#if conn.lastErrorAt}<span class="text-muted-foreground">
									· <TimeAgo date={conn.lastErrorAt} /></span
								>{/if}
						</dd>
					{/if}
				</dl>
				<div class="flex flex-wrap gap-2">
					<form method="POST" action="?/test" use:enhance={testSubmit}>
						<Button type="submit" variant="outline" size="sm" loading={busy === 'test'}
							><RefreshCw /> Test connection</Button
						>
					</form>
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						onclick={() => (disconnectOpen = true)}
						disabled={data.archived}><Unplug /> Disconnect</Button
					>
				</div>
			{/if}
		</Card>

		{#if secret}
			<div role="status" class="grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
				<p class="flex items-start gap-2 text-sm font-medium">
					<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" /> Copy the webhook secret now –
					it will not be shown again.
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<code
						class="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
						>{secret}</code
					>
					<Button variant="outline" size="sm" onclick={() => copy(secret!, 'Webhook secret')}
						><Copy /> Copy</Button
					>
					<Button variant="ghost" size="sm" onclick={() => (secret = null)}>I saved it</Button>
				</div>
			</div>
		{/if}

		{#if conn}
			<Card class="grid gap-4 p-5 sm:p-6">
				<h2 class="text-base font-semibold">Set up the webhook on GitHub</h2>
				<ol class="grid list-decimal gap-3 pl-5 text-sm">
					<li>
						In <a
							href="https://github.com/{conn.owner}/{conn.repo}/settings/hooks/new"
							target="_blank"
							rel="noopener noreferrer"
							class="text-link hover:underline">Settings → Webhooks → Add webhook</a
						>
						of the repository, paste this payload URL:
						<div class="mt-2 flex items-center gap-2">
							<code
								class="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
								>{data.webhookUrl}</code
							>
							<Button
								variant="outline"
								size="icon-sm"
								onclick={() => copy(data.webhookUrl!, 'Payload URL')}
								aria-label="Copy payload URL"><Copy /></Button
							>
						</div>
					</li>
					<li>Content type: <code class="text-xs">application/json</code>.</li>
					<li>
						Secret: the webhook secret shown when you connected. Lost it? Create a new one, then
						update it on GitHub:
						<form
							method="POST"
							action="?/secret"
							class="mt-2"
							use:enhance={withSecret('secret', 'New webhook secret created')}
						>
							<Button
								type="submit"
								variant="outline"
								size="sm"
								loading={busy === 'secret'}
								disabled={data.archived}><KeyRound /> New webhook secret</Button
							>
						</form>
					</li>
					<li>
						Events: choose <em>Let me select individual events</em> and tick
						<strong>Pushes</strong> and <strong>Pull requests</strong>.
					</li>
				</ol>
				<p class="text-xs text-muted-foreground">
					GitHub must be able to reach this Tikket over the internet. Deliveries with a wrong
					signature, for another repository, or repeated (same delivery id) are rejected.
				</p>
			</Card>

			<Card class="p-5 sm:p-6">
				<h2 class="mb-4 text-base font-semibold">Automation and token</h2>
				<form
					method="POST"
					action="?/update"
					class="grid gap-4"
					autocomplete="off"
					use:enhance={quickSubmit({ success: 'GitHub settings saved' })}
				>
					<Field
						label="When a linked pull request is merged"
						for="mergeAction"
						hint="Only tickets that are still unresolved are changed. Each change is recorded in the ticket history as made by the GitHub automation."
					>
						<Select
							id="mergeAction"
							name="mergeAction"
							bind:value={mergeAction}
							items={MERGE_ACTIONS.map((m) => ({ value: m, label: MERGE_ACTION_LABEL[m] }))}
						/>
					</Field>
					<Field
						label={conn.hasToken ? 'Replace token' : 'Read-only token'}
						for="token"
						optional
						hint={conn.hasToken
							? 'A token is stored. Leave empty to keep it.'
							: 'Optional; for private repositories.'}
					>
						<Input
							id="token"
							name="token"
							type="password"
							autocomplete="off"
							placeholder={conn.hasToken ? '••••••••' : ''}
							disabled={clearToken}
						/>
					</Field>
					{#if conn.hasToken}
						<label class="-mt-2 flex items-center gap-2 text-sm">
							<Checkbox name="clearToken" bind:checked={clearToken} /> Remove the stored token
						</label>
					{/if}
					<div class="flex justify-end border-t border-border pt-4">
						<Button type="submit" disabled={data.archived}>Save</Button>
					</div>
				</form>
			</Card>
		{/if}
	</div>

	<aside class="grid content-start gap-4">
		<Card class="grid gap-2 p-5 text-sm">
			<h2 class="font-semibold">How linking works</h2>
			<ul class="grid gap-1.5 text-muted-foreground">
				<li>
					• <code class="text-xs">fix: keep progress ({data.project.key}-42)</code> links the commit.
				</li>
				<li>
					• A pull request titled or described with a key links the pull request and shows its
					state.
				</li>
				<li>• Staff can also add an issue, pull request or commit by hand on the ticket page.</li>
				<li>• Development references are shown to project members and staff.</li>
			</ul>
		</Card>
	</aside>
</div>

<ConfirmDialog
	bind:open={disconnectOpen}
	title="Disconnect {conn ? `${conn.owner}/${conn.repo}` : 'the repository'}?"
	description="Linked pull requests and commits are removed from tickets. Remember to delete the webhook on GitHub too."
	confirmLabel="Disconnect"
	destructive
	action="?/disconnect"
	successMessage="Repository disconnected"
/>
