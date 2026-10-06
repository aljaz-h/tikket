<script lang="ts">
	import { onMount } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Send from '@lucide/svelte/icons/send';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Info from '@lucide/svelte/icons/info';
	import AttachmentUploader, { type UploadedItem } from '$lib/components/AttachmentUploader.svelte';
	import TemplateQuestions from '$lib/components/TemplateQuestions.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';
	import { TYPE_ICONS, TYPE_TONES } from '$lib/components/icons';
	import { TYPE_META, type TicketType } from '$lib/shared/constants';
	import { ENVIRONMENT_LABELS, sanitizeEnvironment } from '$lib/shared/widget';
	import { validateTemplateAnswers } from '$lib/shared/templates';
	import { cn } from '$lib/utils';

	let { data } = $props();

	const TYPES: TicketType[] = ['bug', 'feature', 'improvement'];
	const storageKey = $derived(`tikket:widget:${data.key}`);

	let token = $state<string | null>(null);
	let me = $state<string | null>(null);
	let type = $state<TicketType>('bug');
	let title = $state('');
	let description = $state('');
	let attachments = $state<UploadedItem[]>([]);
	let answers = $state<Record<string, string | boolean>>({});
	let templateId = $state<number | null>(null);
	let context = $state<Record<string, unknown> | null>(null);
	let includeContext = $state(true);
	let honeypot = $state('');
	let errors = $state<Record<string, string>>({});
	let sending = $state(false);
	let submitted = $state<{ ref: string; path: string } | null>(null);
	let popupBlocked = $state(false);
	let pendingSubmit = false;
	let popup: Window | null = null;
	let openedAt = Date.now();

	$effect.pre(() => {
		type = data.config.defaultType as TicketType;
	});

	const templates = $derived(data.templates.filter((t) => t.type === type));
	const template = $derived(
		templates.find((t) => t.id === templateId) ??
			templates.find((t) => t.isDefault) ??
			templates[0] ??
			null
	);
	const preview = $derived(context ? sanitizeEnvironment(context, data.host ?? undefined) : null);
	const authHeaders = $derived<Record<string, string>>(
		token ? { authorization: `Bearer ${token}` } : {}
	);
	const tikketLink = $derived(
		`/new?project=${data.key}&type=${type}` +
			(title ? `&title=${encodeURIComponent(title.slice(0, 160))}` : '') +
			(description ? `&description=${encodeURIComponent(description.slice(0, 2000))}` : '')
	);

	function store(value: { token: string; expiresAt: string; displayName: string } | null) {
		try {
			if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
			else sessionStorage.removeItem(storageKey);
		} catch {
			/* storage may be blocked in third-party contexts – the token then lives in memory only */
		}
	}

	onMount(() => {
		try {
			const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
			if (saved && new Date(saved.expiresAt) > new Date()) {
				token = saved.token;
				me = saved.displayName;
				// Confirm the token is still valid (access may have been revoked).
				fetch(`/api/widget/${data.key}/me`, {
					headers: { authorization: `Bearer ${saved.token}` }
				}).then((r) => {
					if (!r.ok) signOutLocal();
				});
			}
		} catch {
			/* ignore */
		}

		const onMessage = (e: MessageEvent) => {
			const msg = e.data as { type?: string; [k: string]: unknown } | null;
			if (!msg || typeof msg !== 'object') return;
			// Context from the embedding page: exact parent window and exact allowed origin only.
			if (
				msg.type === 'tikket:context' &&
				data.host &&
				e.source === window.parent &&
				e.origin === data.host
			) {
				context =
					msg.context && typeof msg.context === 'object'
						? (msg.context as Record<string, unknown>)
						: null;
				return;
			}
			// Token from our own sign-in popup: our origin and the window we opened only.
			if (
				msg.type === 'tikket:token' &&
				popup &&
				e.source === popup &&
				e.origin === location.origin
			) {
				if (typeof msg.token !== 'string' || typeof msg.expiresAt !== 'string') return;
				token = msg.token;
				me = typeof msg.displayName === 'string' ? msg.displayName : null;
				store({ token: msg.token, expiresAt: msg.expiresAt, displayName: me ?? '' });
				popup = null;
				if (pendingSubmit) void submit();
			}
		};
		window.addEventListener('message', onMessage);
		if (data.host && window.parent !== window)
			window.parent.postMessage({ type: 'tikket:ready' }, data.host);
		return () => window.removeEventListener('message', onMessage);
	});

	function signIn() {
		if (!data.host) return;
		popupBlocked = false;
		popup = window.open(
			`/embed/${data.key}/auth?host=${encodeURIComponent(data.host)}`,
			'tikket-widget-auth',
			'popup,width=460,height=680'
		);
		if (!popup) {
			popupBlocked = true;
			pendingSubmit = false;
		}
	}

	function signOutLocal() {
		token = null;
		me = null;
		store(null);
	}

	async function signOut() {
		if (token)
			await fetch(`/api/widget/${data.key}/me`, { method: 'DELETE', headers: authHeaders }).catch(
				() => {}
			);
		signOutLocal();
	}

	function close() {
		if (data.host && window.parent !== window)
			window.parent.postMessage({ type: 'tikket:close' }, data.host);
	}

	function validate() {
		const e: Record<string, string> = {};
		if (title.trim().length < 4) e.title = 'Give your report a short title (at least 4 characters)';
		if (!description.trim()) e.description = 'Please describe what you would like to report';
		if (template) {
			const result = validateTemplateAnswers(template.fields, answers);
			if (!result.ok) Object.assign(e, result.errors);
		}
		errors = e;
		return !Object.keys(e).length;
	}

	async function submit() {
		pendingSubmit = false;
		if (!validate()) return;
		if (!token) {
			pendingSubmit = true;
			signIn();
			return;
		}
		sending = true;
		try {
			const res = await fetch(`/api/widget/${data.key}/tickets`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...authHeaders },
				body: JSON.stringify({
					type,
					title,
					description,
					attachmentIds: attachments.map((a) => a.id),
					context: includeContext && data.config.collectContext ? context : null,
					templateId: template?.id ?? null,
					answers,
					website: honeypot,
					elapsedMs: Date.now() - openedAt
				})
			});
			const body = await res.json().catch(() => ({}));
			if (res.status === 401) {
				signOutLocal();
				errors = { form: 'Your sign-in expired. Please sign in again.' };
			} else if (!res.ok) {
				errors = body.errors ?? { form: body.message ?? 'Your report could not be sent.' };
			} else {
				submitted = body;
			}
		} catch {
			errors = { form: 'Network error – please try again.' };
		} finally {
			sending = false;
		}
	}

	function reset() {
		submitted = null;
		title = '';
		description = '';
		attachments = [];
		answers = {};
		errors = {};
		openedAt = Date.now();
	}
</script>

<main
	id="main"
	class="flex h-dvh flex-col bg-background"
	style="--primary:{data.config.accentColor}; --ring:{data.config
		.accentColor}99; --primary-hover:{data.config
		.accentColor}; --primary-foreground:#ffffff; --primary-soft:{data.config.accentColor}22"
>
	<header class="flex items-center gap-2 border-b border-border px-4 py-3">
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-sm font-semibold">Send feedback</h1>
			<p class="truncate text-xs text-muted-foreground">to {data.projectName}</p>
		</div>
		{#if me}
			<span
				class="hidden max-w-32 truncate text-xs text-muted-foreground min-[360px]:inline"
				title="Signed in as {me}">{me}</span
			>
			<button
				type="button"
				class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
				onclick={signOut}
				aria-label="Sign out of the widget"
				title="Sign out"><LogOut class="size-4" /></button
			>
		{/if}
		<button
			type="button"
			class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
			onclick={close}
			aria-label="Close feedback"><X class="size-4" /></button
		>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
		{#if !data.host}
			<FormMessage
				message="This website is not allowed to use the Tikket feedback widget. Ask the project owner to add it in the widget settings."
			/>
		{:else if submitted}
			<div class="flex flex-col items-center gap-3 py-10 text-center" role="status">
				<CircleCheck class="size-10 text-[var(--tone-completed)]" />
				<h2 class="text-base font-semibold">Thanks for your feedback!</h2>
				<p class="text-sm text-muted-foreground">
					Your report <strong class="font-mono text-foreground">{submitted.ref}</strong> was created.
					You’ll be notified about updates.
				</p>
				<div class="flex gap-2">
					<Button href={submitted.path} target="_blank" rel="noopener" variant="secondary" size="sm"
						><ExternalLink /> View in Tikket</Button
					>
					<Button size="sm" onclick={reset}>Send another</Button>
				</div>
			</div>
		{:else}
			<form
				class="grid gap-4"
				novalidate
				onsubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<FormMessage message={errors.form} />
				<fieldset class="grid gap-2">
					<legend class="mb-2 text-[0.8125rem] font-medium">What would you like to report?</legend>
					<div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Report type">
						{#each TYPES as t (t)}
							{@const Icon = TYPE_ICONS[t]}
							<label
								class="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-border bg-surface px-1 py-2 text-center text-xs font-medium transition-colors hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
							>
								<input type="radio" name="type" value={t} bind:group={type} class="sr-only" />
								<Icon class={cn('tone-text size-4', TYPE_TONES[t])} />
								{TYPE_META[t].short}
							</label>
						{/each}
					</div>
				</fieldset>

				<Field label="Title" for="w-title" required error={errors.title}>
					<Input
						id="w-title"
						bind:value={title}
						maxlength={160}
						placeholder={TYPE_META[type].titlePlaceholder}
						aria-invalid={!!errors.title}
					/>
				</Field>
				<Field
					label={TYPE_META[type].descriptionLabel}
					for="w-description"
					required
					error={errors.description}
				>
					<Textarea
						id="w-description"
						bind:value={description}
						rows={4}
						maxlength={20000}
						placeholder={TYPE_META[type].descriptionHint}
						aria-invalid={!!errors.description}
					/>
				</Field>

				{#if templates.length > 1}
					<Field label="Form" for="w-template">
						<NativeSelect
							id="w-template"
							value={String(template?.id ?? '')}
							onchange={(e) => (templateId = Number((e.currentTarget as HTMLSelectElement).value))}
						>
							{#each templates as t (t.id)}<option value={String(t.id)}>{t.name}</option>{/each}
						</NativeSelect>
					</Field>
				{/if}
				{#if template}
					<TemplateQuestions
						fields={template.fields}
						bind:values={answers}
						{errors}
						idPrefix="w-tpl"
					/>
				{/if}

				{#if data.config.screenshotsEnabled}
					<Field label="Screenshots" optional error={errors.attachments}>
						<AttachmentUploader
							bind:items={attachments}
							compact
							label="Screenshots"
							maxFiles={data.limits.maxFiles}
							maxSize={data.limits.maxSize}
							accept={data.limits.accept}
							uploadUrl="/api/widget/{data.key}/uploads"
							deleteUrl={(id) => `/api/widget/${data.key}/uploads/${id}`}
							headers={authHeaders}
							disabledHint={token ? null : 'Sign in to attach screenshots.'}
						/>
					</Field>
				{/if}

				{#if data.config.collectContext && preview}
					<div class="rounded-lg border border-border text-xs">
						<label class="flex items-center gap-2 px-3 py-2">
							<input
								type="checkbox"
								bind:checked={includeContext}
								class="size-3.5 accent-[var(--primary)]"
							/>
							<Info class="size-3.5 text-muted-foreground" />
							<span class="flex-1">Include page information</span>
						</label>
						<details class="border-t border-border">
							<summary class="cursor-pointer px-3 py-1.5 text-muted-foreground"
								>Review what is sent</summary
							>
							<dl class="grid gap-1 px-3 pb-2 text-muted-foreground">
								{#each Object.entries(preview) as [k, v] (k)}
									<div class="flex gap-2">
										<dt class="w-24 shrink-0">
											{ENVIRONMENT_LABELS[k as keyof typeof ENVIRONMENT_LABELS]}
										</dt>
										<dd class="min-w-0 break-all text-foreground">{v}</dd>
									</div>
								{/each}
							</dl>
							<p class="border-t border-border px-3 py-2 text-muted-foreground">
								Query parameters, cookies, form contents and page content are never collected.
							</p>
						</details>
					</div>
				{/if}

				<!-- Honeypot for bots: hidden from people and assistive technology. -->
				<div class="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
					<label>Website <input tabindex="-1" autocomplete="off" bind:value={honeypot} /></label>
				</div>

				{#if popupBlocked}
					<FormMessage
						variant="info"
						message="Your browser blocked the sign-in window. Allow pop-ups for this site, or continue in Tikket."
					/>
				{/if}

				<div class="grid gap-2">
					<Button type="submit" class="w-full" loading={sending}>
						{#if token}<Send /> Send feedback{:else}<LogIn /> Sign in & send{/if}
					</Button>
					<p class="text-center text-xs text-muted-foreground">
						{#if token}Sending as {me}.{:else}You’ll sign in to Tikket in a small window; your text
							stays here.{/if}
						<a
							href={tikketLink}
							target="_blank"
							rel="noopener"
							class="underline-offset-2 hover:underline">Open in Tikket instead</a
						>
					</p>
				</div>
			</form>
		{/if}
	</div>
</main>
