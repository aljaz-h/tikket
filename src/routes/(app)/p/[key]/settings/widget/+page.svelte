<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { TYPE_META, WIDGET_POSITIONS, type WidgetPosition } from '$lib/shared/constants';
	import { cn } from '$lib/utils';
	import { DEFAULT_ACCENT, readableOn } from '$lib/shared/color';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	let enabled = $state(false);
	let label = $state('');
	let position = $state<WidgetPosition>('bottom-right');
	let accent = $state(DEFAULT_ACCENT);
	let defaultType = $state('bug');
	let screenshots = $state(true);
	let collect = $state(true);
	let origins = $state('');
	let showForm = $state(false);
	let checking = $state(false);
	$effect.pre(() => {
		const w = data.widget;
		enabled = w.enabled;
		label = w.buttonLabel;
		position = w.position;
		accent = w.accentColor;
		defaultType = w.defaultType === 'feedback' ? 'bug' : w.defaultType;
		screenshots = w.screenshotsEnabled;
		collect = w.collectContext;
		origins = data.origins.join('\n');
	});

	const previewAccent = $derived(/^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT);
	const snippet = $derived(
		`<script src="${data.baseUrl}/widget.js" data-project="${data.project.key}" async></${'script'}>`
	);
	const checks = $derived([
		{ ok: data.widget.enabled, label: 'Widget enabled', hint: 'Turn the widget on and save.' },
		{
			ok: data.origins.length > 0,
			label: `${data.origins.length} allowed website${data.origins.length === 1 ? '' : 's'}`,
			hint: 'Add the origin of every site that embeds the widget.'
		},
		{
			ok: data.baseUrl.startsWith('https://'),
			warn: !data.baseUrl.startsWith('https://'),
			label: data.baseUrl.startsWith('https://')
				? 'Tikket is served over HTTPS'
				: 'Tikket is not served over HTTPS',
			hint: 'HTTPS websites can only embed an HTTPS Tikket (mixed content).'
		},
		...data.origins
			.filter((o) => o.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o))
			.map((o) => ({
				ok: false,
				warn: true,
				label: `${o} uses plain HTTP`,
				hint: 'Browsers may block an HTTPS iframe there; prefer https.'
			})),
		{
			ok: !!data.widget.lastSeenAt,
			warn: !data.widget.lastSeenAt,
			label: data.widget.lastSeenAt
				? `Loader seen on ${data.widget.lastSeenOrigin}`
				: 'Loader not seen yet',
			hint: data.widget.lastSeenAt
				? ''
				: 'Add the snippet to your site, open a page, then check again.',
			at: data.widget.lastSeenAt
		}
	]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(snippet);
			toast.success('Embed code copied');
		} catch {
			toast.error('Copy failed – select the code manually');
		}
	}
	const positionLabel = (p: string) => p.replace('-', ' ').replace(/^./, (c) => c.toUpperCase());
</script>

<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
	<div class="grid content-start gap-6">
		<Card class="p-5 sm:p-6">
			<h2 class="text-base font-semibold">Feedback widget</h2>
			<p class="mb-5 text-sm text-muted-foreground">
				Let people report bugs and ideas from your own website without leaving it. Reporters sign in
				to Tikket in a small pop-up window the first time; their text stays in the form while they
				do.
			</p>
			<form
				method="POST"
				action="?/save"
				class="grid gap-5"
				use:enhance={quickSubmit({ success: 'Widget settings saved' })}
			>
				<FormMessage message={errors.form} />
				<label class="flex items-start gap-3">
					<Switch name="enabled" bind:checked={enabled} class="mt-0.5" />
					<span
						><span class="block text-sm font-medium">Enable the widget</span><span
							class="block text-xs text-muted-foreground"
							>When off, the loader shows nothing and all widget endpoints answer 404.</span
						></span
					>
				</label>

				<Field
					label="Allowed websites"
					for="origins"
					error={errors.origins}
					hint="One origin per line, e.g. https://spool.example.com – scheme and host (and port) only. Only these sites can show the widget."
				>
					<Textarea
						id="origins"
						name="origins"
						rows={3}
						bind:value={origins}
						placeholder="https://spool.example.com"
						class="font-mono text-xs"
					/>
				</Field>

				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Button label" for="buttonLabel"
						><Input id="buttonLabel" name="buttonLabel" maxlength={30} bind:value={label} /></Field
					>
					<Field label="Position" for="position">
						<Select
							id="position"
							name="position"
							bind:value={position}
							items={WIDGET_POSITIONS.map((p) => ({ value: p, label: positionLabel(p) }))}
						/>
					</Field>
					<Field label="Accent colour" for="accentColor" error={errors.accentColor}>
						<div class="flex gap-2">
							<input
								type="color"
								bind:value={accent}
								aria-label="Pick accent colour"
								class="h-9 w-12 cursor-pointer rounded-md border border-input bg-surface p-1"
							/>
							<Input
								id="accentColor"
								name="accentColor"
								bind:value={accent}
								maxlength={7}
								class="font-mono"
							/>
						</div>
					</Field>
					<Field label="Default report type" for="defaultType">
						<Select
							id="defaultType"
							name="defaultType"
							bind:value={defaultType}
							items={(['bug', 'feature', 'improvement'] as const).map((t) => ({
								value: t,
								label: TYPE_META[t].label
							}))}
						/>
					</Field>
				</div>
				<label class="flex items-start gap-3">
					<Switch name="screenshotsEnabled" bind:checked={screenshots} class="mt-0.5" />
					<span
						><span class="block text-sm font-medium">Allow screenshots</span><span
							class="block text-xs text-muted-foreground"
							>Also requires attachments to be enabled for the project.</span
						></span
					>
				</label>
				<label class="flex items-start gap-3">
					<Switch name="collectContext" bind:checked={collect} class="mt-0.5" />
					<span>
						<span class="block text-sm font-medium">Include page information</span>
						<span class="block text-xs text-muted-foreground"
							>Page address (without query string or fragment), title, browser, operating system and
							window size. Reporters see it and can opt out per report.</span
						>
					</span>
				</label>
				<div class="flex justify-end border-t border-border pt-5">
					<Button type="submit">Save widget settings</Button>
				</div>
			</form>
		</Card>

		<Card class="p-5 sm:p-6">
			<h2 class="text-base font-semibold">Installation</h2>
			<p class="mb-3 text-sm text-muted-foreground">
				Add this snippet before <code class="rounded bg-muted px-1 text-xs">&lt;/body&gt;</code> on each
				page of an allowed website.
			</p>
			<div class="relative">
				<pre
					class="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 pr-12 text-xs"><code
						>{snippet}</code
					></pre>
				<Button
					variant="ghost"
					size="icon-sm"
					class="absolute top-1.5 right-1.5"
					onclick={copy}
					aria-label="Copy embed code"><Copy /></Button
				>
			</div>
			<ul class="mt-4 grid gap-1.5 text-xs text-muted-foreground">
				<li>
					• The script is ~4 KB, loads asynchronously and renders inside a shadow root, so it does
					not affect your page’s styles.
				</li>
				<li>
					• If your site sends a Content-Security-Policy, allow <code class="rounded bg-muted px-1"
						>{data.baseUrl}</code
					>
					in <code class="rounded bg-muted px-1">script-src</code>,
					<code class="rounded bg-muted px-1">connect-src</code>
					and <code class="rounded bg-muted px-1">frame-src</code>.
				</li>
				{#if data.projectVisibility === 'private' || data.submissionPolicy === 'members'}
					<li>
						• Only members of this project can submit through the widget; others see a “no access”
						message after signing in.
					</li>
				{:else}
					<li>• Any signed-in Tikket user can submit. Anonymous submissions are not supported.</li>
				{/if}
			</ul>
		</Card>
	</div>

	<aside class="grid content-start gap-6">
		<Card class="grid gap-3 p-5">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Connection check</h2>
				<Button
					variant="ghost"
					size="xs"
					loading={checking}
					onclick={async () => {
						checking = true;
						await invalidateAll();
						checking = false;
					}}><RefreshCw /> Check again</Button
				>
			</div>
			<ul class="grid gap-2 text-sm" aria-live="polite">
				{#each checks as c, i (i)}
					<li class="flex gap-2">
						{#if c.ok}<CircleCheck
								class="mt-0.5 size-4 shrink-0 text-[var(--tone-completed)]"
							/>{:else if c.warn}<CircleAlert
								class="mt-0.5 size-4 shrink-0 text-[var(--tone-progress)]"
							/>{:else}<CircleX class="mt-0.5 size-4 shrink-0 text-destructive" />{/if}
						<span>
							{c.label}
							{#if 'at' in c && c.at}
								· <TimeAgo date={c.at} class="text-muted-foreground" />{/if}
							{#if !c.ok && c.hint}<span class="block text-xs text-muted-foreground">{c.hint}</span
								>{/if}
						</span>
					</li>
				{/each}
			</ul>
		</Card>

		<Card class="grid gap-3 p-5">
			<h2 class="text-sm font-semibold">Preview</h2>
			<div
				class="relative h-40 overflow-hidden rounded-lg border border-border bg-[linear-gradient(135deg,var(--surface-2),var(--muted))]"
				aria-hidden="true"
			>
				<div class="absolute inset-x-3 top-3 h-2 w-24 rounded bg-border"></div>
				<div class="absolute inset-x-3 top-7 h-2 w-36 rounded bg-border"></div>
				<span
					class={cn(
						'absolute flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-pop',
						position.startsWith('top') ? 'top-3' : 'bottom-3',
						position.endsWith('left') ? 'left-3' : 'right-3'
					)}
					style="background:{previewAccent};color:{readableOn(previewAccent)}"
				>
					<MessageSquare class="size-3.5" />{label || 'Feedback'}
				</span>
			</div>
			{#if data.widget.enabled}
				<Button
					variant="secondary"
					size="sm"
					onclick={() => (showForm = !showForm)}
					aria-expanded={showForm}>{showForm ? 'Hide' : 'Show'} the live form</Button
				>
				{#if showForm}
					<iframe
						title="Widget form preview"
						src="/embed/{data.project.key}?host={encodeURIComponent(data.selfOrigin)}"
						class="h-[34rem] w-full rounded-lg border border-border"
					></iframe>
					<p class="text-xs text-muted-foreground">
						This is the real form. Reports sent from here are created as normal tickets.
					</p>
				{/if}
			{:else}
				<p class="text-xs text-muted-foreground">
					Enable and save the widget to try the live form.
				</p>
			{/if}
		</Card>
	</aside>
</div>
