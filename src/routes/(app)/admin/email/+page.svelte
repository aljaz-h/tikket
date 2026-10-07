<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Mail from '@lucide/svelte/icons/mail';
	import Send from '@lucide/svelte/icons/send';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { SMTP_SECURITY, type SmtpSecurity } from '$lib/shared/constants';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);

	let enabled = $state(false);
	let security = $state<SmtpSecurity>('starttls');
	let port = $state('587');
	let clearPassword = $state(false);
	let testTo = $state('');
	let testing = $state(false);
	$effect.pre(() => {
		const s = data.smtp;
		enabled = s?.enabled ?? false;
		security = (values.security as SmtpSecurity) ?? s?.security ?? 'starttls';
		port = values.port ?? String(s?.port ?? 587);
		testTo = data.adminEmail;
		clearPassword = false;
	});
	const securityLabel: Record<SmtpSecurity, string> = {
		starttls: 'STARTTLS (port 587)',
		tls: 'TLS (port 465)',
		none: 'None (not recommended)'
	};
	const defaultPorts: Record<SmtpSecurity, string> = { starttls: '587', tls: '465', none: '25' };
	const status = $derived(
		!data.smtp
			? ({ state: 'off', label: 'Not configured' } as const)
			: !data.smtp.enabled
				? ({ state: 'off', label: 'Disabled' } as const)
				: data.smtp.lastTest && !data.smtp.lastTest.ok
					? ({ state: 'error', label: 'Last test failed' } as const)
					: data.problems.some((p) => p.status === 'dead')
						? ({ state: 'warn', label: 'Recent delivery failures' } as const)
						: ({ state: 'ok', label: 'Enabled' } as const)
	);
	const v = (key: string, fallback: unknown) => values[key] ?? String(fallback ?? '');
</script>

<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
	<Card class="p-5 sm:p-6">
		<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
			<h2 class="flex items-center gap-2 text-base font-semibold">
				<Mail class="size-4 text-muted-foreground" /> Email (SMTP)
			</h2>
			<IntegrationStatus state={status.state} label={status.label} />
		</div>
		<p class="mb-5 text-sm text-muted-foreground">
			Optional. When enabled, people can receive notification emails (each person chooses which),
			invitations can be emailed and users can reset forgotten passwords themselves. Without email,
			Tikket works exactly as before.
		</p>

		{#if data.envManaged && data.smtp}
			<FormMessage
				variant="info"
				message="Email is configured with environment variables (SMTP_HOST …). Those settings take precedence and are shown read-only; change them in your deployment."
			/>
			<dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
				<dt class="text-muted-foreground">Status</dt>
				<dd>{data.smtp.enabled ? 'Enabled' : 'Disabled (SMTP_ENABLED=false)'}</dd>
				<dt class="text-muted-foreground">Server</dt>
				<dd class="font-mono text-xs [overflow-wrap:anywhere]">
					{data.smtp.host}:{data.smtp.port}
				</dd>
				<dt class="text-muted-foreground">Encryption</dt>
				<dd>{securityLabel[data.smtp.security]}</dd>
				<dt class="text-muted-foreground">Username</dt>
				<dd class="[overflow-wrap:anywhere]">{data.smtp.username || '—'}</dd>
				<dt class="text-muted-foreground">Password</dt>
				<dd>{data.smtp.hasPassword ? '•••••••• (set)' : 'Not set'}</dd>
				<dt class="text-muted-foreground">Sender</dt>
				<dd class="[overflow-wrap:anywhere]">
					{data.smtp.fromName
						? `${data.smtp.fromName} <${data.smtp.fromAddress}>`
						: data.smtp.fromAddress}
				</dd>
			</dl>
		{:else}
			<form
				method="POST"
				action="?/save"
				class="grid gap-5"
				use:enhance={quickSubmit({ success: 'Email settings saved' })}
				autocomplete="off"
			>
				<FormMessage message={errors.form} />
				<label class="flex items-start gap-3">
					<Switch name="enabled" bind:checked={enabled} class="mt-0.5" />
					<span>
						<span class="block text-sm font-medium">Send emails</span>
						<span class="block text-xs text-muted-foreground"
							>Turn off to pause all email without losing the configuration.</span
						>
					</span>
				</label>

				<fieldset class="grid gap-4">
					<legend class="mb-3 text-sm font-medium">Server</legend>
					<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
						<Field label="SMTP host" for="host" error={errors.host} required>
							<Input
								id="host"
								name="host"
								required
								placeholder="smtp.example.com"
								value={v('host', data.smtp?.host)}
								aria-invalid={!!errors.host}
								spellcheck="false"
							/>
						</Field>
						<Field label="Port" for="port" error={errors.port} required>
							<Input
								id="port"
								name="port"
								inputmode="numeric"
								required
								bind:value={port}
								aria-invalid={!!errors.port}
							/>
						</Field>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<Field label="Encryption" for="security">
							<Select
								id="security"
								name="security"
								bind:value={security}
								onchange={(next: string) => {
									if (Object.values(defaultPorts).includes(port))
										port = defaultPorts[next as SmtpSecurity];
								}}
								items={SMTP_SECURITY.map((s) => ({ value: s, label: securityLabel[s] }))}
							/>
						</Field>
						<Field
							label="Timeout (seconds)"
							for="timeoutSec"
							error={errors.timeoutSec}
							hint="Connection and greeting timeout"
						>
							<Input
								id="timeoutSec"
								name="timeoutSec"
								inputmode="numeric"
								value={v('timeoutSec', data.smtp?.timeoutSec ?? 15)}
							/>
						</Field>
					</div>
					{#if security === 'none'}
						<FormMessage
							variant="info"
							message="Without encryption the password and every email travel in plain text. Use this only for a relay on a trusted local network."
						/>
					{/if}
					<div class="grid gap-4 sm:grid-cols-2">
						<Field label="Username" for="username" error={errors.username} optional>
							<Input
								id="username"
								name="username"
								autocomplete="off"
								value={v('username', data.smtp?.username)}
								spellcheck="false"
							/>
						</Field>
						<Field
							label="Password"
							for="password"
							error={errors.password}
							optional
							hint={data.smtp?.hasPassword
								? 'A password is stored. Leave empty to keep it.'
								: data.encryptionAvailable
									? 'Stored encrypted; never shown again.'
									: 'Storing a password requires ENCRYPTION_KEY on the server.'}
						>
							<Input
								id="password"
								name="password"
								type="password"
								autocomplete="new-password"
								placeholder={data.smtp?.hasPassword ? '••••••••' : ''}
								disabled={clearPassword}
								aria-invalid={!!errors.password}
							/>
						</Field>
					</div>
					{#if data.smtp?.hasPassword}
						<label class="-mt-2 flex items-center gap-2 text-sm">
							<Checkbox name="clearPassword" bind:checked={clearPassword} />
							Remove the stored password
						</label>
					{/if}
				</fieldset>

				<fieldset class="grid gap-4">
					<legend class="mb-3 text-sm font-medium">Sender</legend>
					<div class="grid gap-4 sm:grid-cols-2">
						<Field label="From name" for="fromName" optional>
							<Input
								id="fromName"
								name="fromName"
								placeholder="Tikket"
								value={v('fromName', data.smtp?.fromName)}
							/>
						</Field>
						<Field label="From address" for="fromAddress" error={errors.fromAddress} required>
							<Input
								id="fromAddress"
								name="fromAddress"
								type="email"
								required
								placeholder="tikket@example.com"
								value={v('fromAddress', data.smtp?.fromAddress)}
								aria-invalid={!!errors.fromAddress}
							/>
						</Field>
					</div>
					<Field
						label="Reply-to address"
						for="replyTo"
						error={errors.replyTo}
						optional
						hint="Where replies go. Tikket does not read incoming email."
					>
						<Input
							id="replyTo"
							name="replyTo"
							type="email"
							placeholder="support@example.com"
							value={v('replyTo', data.smtp?.replyTo)}
						/>
					</Field>
				</fieldset>
				<div class="flex justify-end border-t border-border pt-5">
					<Button type="submit">Save email settings</Button>
				</div>
			</form>
		{/if}
	</Card>

	<aside class="grid content-start gap-6">
		<Card class="grid gap-3 p-5">
			<h2 class="text-sm font-semibold">Send a test email</h2>
			<form
				method="POST"
				action="?/test"
				class="grid gap-3"
				use:enhance={() => {
					testing = true;
					return async ({ result, update }) => {
						testing = false;
						if (result.type === 'success') toast.success(String(result.data?.tested ?? 'Sent'));
						await update({ reset: false });
					};
				}}
			>
				<Field label="Recipient" for="to">
					<Input id="to" name="to" type="email" bind:value={testTo} required />
				</Field>
				<FormMessage message={errors.test} />
				<Button type="submit" variant="outline" loading={testing} disabled={!data.smtp}
					><Send /> Send test</Button
				>
			</form>
			{#if data.smtp?.lastTest}
				<p class="text-xs text-muted-foreground">
					Latest test <TimeAgo date={data.smtp.lastTest.at} />:
					<span class={data.smtp.lastTest.ok ? 'text-success' : 'text-destructive'}
						>{data.smtp.lastTest.ok ? 'delivered to the server' : 'failed'}</span
					>{#if !data.smtp.lastTest.ok}
						– {data.smtp.lastTest.message}{/if}
				</p>
			{/if}
		</Card>

		<Card class="grid gap-3 p-5">
			<h2 class="text-sm font-semibold">Delivery queue</h2>
			<dl class="grid grid-cols-3 gap-2 text-center">
				{#each [{ k: 'pending', l: 'Waiting' }, { k: 'done', l: 'Sent (7 days)' }, { k: 'dead', l: 'Failed' }] as s (s.k)}
					<div class="rounded-lg border border-border p-2">
						<dt class="text-[0.6875rem] text-muted-foreground">{s.l}</dt>
						<dd class="text-lg font-semibold tabular-nums">
							{data.stats[s.k as 'pending' | 'done' | 'dead']}
						</dd>
					</div>
				{/each}
			</dl>
			{#if data.problems.length}
				<ul class="grid gap-2">
					{#each data.problems as p (p.id)}
						<li class="grid gap-1 rounded-lg border border-border p-2.5 text-xs">
							<div class="flex items-center justify-between gap-2">
								<span class={p.status === 'dead' ? 'font-medium text-destructive' : 'font-medium'}
									>{p.status === 'dead'
										? 'Failed'
										: `Retrying (attempt ${p.attempts}/${p.maxAttempts})`}</span
								>
								<TimeAgo date={p.updatedAt} />
							</div>
							<p class="[overflow-wrap:anywhere] text-muted-foreground">{p.lastError}</p>
							{#if p.status === 'dead'}
								<form
									method="POST"
									action="?/retry"
									use:enhance={quickSubmit({ success: 'Queued again' })}
								>
									<input type="hidden" name="id" value={p.id} />
									<Button type="submit" variant="ghost" size="xs"><RotateCcw /> Retry</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-muted-foreground">No delivery problems.</p>
			{/if}
			<p class="text-xs text-muted-foreground">
				Temporary failures are retried with increasing delays (up to 6 attempts). Failed emails
				never affect the action that caused them.
			</p>
		</Card>
	</aside>
</div>
