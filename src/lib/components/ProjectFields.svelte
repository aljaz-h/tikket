<script lang="ts">
	import Field from './ui/field.svelte';
	import Input from './ui/input.svelte';
	import Textarea from './ui/textarea.svelte';
	import Switch from './ui/switch.svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import Globe from '@lucide/svelte/icons/globe';
	import Lock from '@lucide/svelte/icons/lock';
	import { PROJECT_COLORS } from '$lib/shared/constants';
	import { cn } from '$lib/utils';
	import { readableOn } from '$lib/shared/color';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		errors?: Record<string, string>;
		values: Record<string, string | boolean | null | undefined>;
		keyLocked?: boolean;
	}
	let { errors = {}, values, keyLocked = false }: Props = $props();

	let name = $state('');
	let key = $state('');
	let icon = $state('');
	let color = $state('indigo');
	let visibility = $state('private');
	let anonymous = $state(false);
	let keyTouched = $state(false);
	let accent = $state('');

	$effect.pre(() => {
		name = String(values.name ?? '');
		key = String(values.key ?? '');
		icon = String(values.icon ?? '');
		color = String(values.color ?? 'indigo');
		visibility = String(values.visibility ?? 'private');
		anonymous = values.allowAnonymousRead === true || values.allowAnonymousRead === 'on';
		keyTouched = !!values.key;
		accent = String(values.accentColor ?? '');
	});

	const validAccent = $derived(/^#[0-9a-f]{6}$/i.test(accent) ? accent : null);

	function suggestKey(source: string) {
		const words = source
			.toUpperCase()
			.replace(/[^A-Z0-9 ]/g, '')
			.split(/\s+/)
			.filter(Boolean);
		if (!words.length) return '';
		const candidate =
			words.length > 1
				? words.map((w) => w[0]).join('')
				: words[0].replace(/[AEIOU]/g, (m, i) => (i === 0 ? m : '')).slice(0, 3);
		const cleaned = candidate.replace(/^[0-9]+/, '').slice(0, 5);
		return cleaned.length >= 2 ? cleaned : words[0].slice(0, 3);
	}
</script>

<div class="grid gap-5">
	<div class="grid gap-4 sm:grid-cols-[1fr_9rem]">
		<Field label="Project name" for="name" error={errors.name} required>
			<Input
				id="name"
				name="name"
				required
				maxlength={80}
				placeholder="Spool"
				bind:value={name}
				oninput={() => {
					if (!keyTouched && !keyLocked) key = suggestKey(name);
				}}
				aria-invalid={!!errors.name}
			/>
		</Field>
		<Field
			label="Key"
			for="key"
			error={errors.key}
			required
			hint={keyLocked ? undefined : 'Prefix for ticket numbers'}
		>
			<Input
				id="key"
				name="key"
				required
				maxlength={10}
				placeholder="SPL"
				class="font-mono uppercase"
				bind:value={key}
				oninput={() => (keyTouched = true)}
				aria-invalid={!!errors.key}
				autocapitalize="characters"
				spellcheck="false"
			/>
		</Field>
	</div>
	{#if keyLocked}
		<p class="-mt-3 text-xs text-muted-foreground">
			Tickets will be numbered <span class="font-mono">{(key || 'KEY').toUpperCase()}-1</span>,
			<span class="font-mono">{(key || 'KEY').toUpperCase()}-2</span>… Changing the key renames
			every ticket reference and changes ticket URLs.
		</p>
	{/if}

	<Field label="Description" for="description" error={errors.description} optional>
		<Textarea
			id="description"
			name="description"
			maxlength={500}
			rows={2}
			placeholder="What is this project about?"
			value={String(values.description ?? '')}
		/>
	</Field>

	<div class="grid gap-4 sm:grid-cols-[7rem_1fr]">
		<Field label="Icon" for="icon" optional error={errors.icon}>
			<div class="flex items-center gap-2">
				<ProjectIcon
					project={{ name: name || '?', icon, color, accentColor: validAccent }}
					size="md"
				/>
				<Input
					id="icon"
					name="icon"
					maxlength={4}
					placeholder="🎬"
					bind:value={icon}
					class="w-14 text-center"
					aria-describedby="icon-hint"
				/>
			</div>
		</Field>
		<fieldset class="grid gap-1.5">
			<legend class="mb-1.5 text-[0.8125rem] font-medium">Colour</legend>
			<div class="flex flex-wrap gap-1.5">
				{#each PROJECT_COLORS as c (c)}
					<label class="relative cursor-pointer">
						<input type="radio" name="color" value={c} bind:group={color} class="peer sr-only" />
						<span
							class={cn(
								`swatch-${c} swatch-solid block size-7 rounded-md ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring`
							)}
						></span>
						<span class="sr-only">{c}</span>
					</label>
				{/each}
			</div>
		</fieldset>
	</div>
	<p id="icon-hint" class="-mt-3 text-xs text-muted-foreground">
		Use an emoji or leave empty to show the first letter.
	</p>

	<Field
		label="Accent colour"
		for="accentColor"
		error={errors.accentColor}
		optional
		hint="Used sparingly for this project: its icon, roadmap and main buttons. Text on it switches between dark and light automatically."
	>
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="color"
				value={validAccent ?? '#b8f779'}
				oninput={(e) => (accent = e.currentTarget.value)}
				aria-label="Pick accent colour"
				class="h-9 w-12 cursor-pointer rounded-md border border-input bg-surface p-1"
			/>
			<Input
				id="accentColor"
				name="accentColor"
				bind:value={accent}
				maxlength={7}
				placeholder="#b8f779"
				class="w-28 font-mono"
				aria-invalid={!!errors.accentColor}
			/>
			{#if validAccent}
				<span
					class="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
					style:background-color={validAccent}
					style:color={readableOn(validAccent)}>New ticket</span
				>
			{/if}
			{#if accent}
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
					onclick={() => (accent = '')}
					aria-label="Remove accent colour"><X class="size-4" /></button
				>
			{/if}
		</div>
	</Field>

	<Field label="Project website" for="url" error={errors.url} optional>
		<Input
			id="url"
			name="url"
			type="url"
			inputmode="url"
			placeholder="https://spool.example.com"
			value={String(values.url ?? '')}
			aria-invalid={!!errors.url}
		/>
	</Field>

	<Field
		label="Support or documentation link"
		for="docsUrl"
		error={errors.docsUrl}
		optional
		hint="Shown in the project header, e.g. your docs or help centre."
	>
		<Input
			id="docsUrl"
			name="docsUrl"
			type="url"
			inputmode="url"
			placeholder="https://docs.spool.example.com"
			value={String(values.docsUrl ?? '')}
			aria-invalid={!!errors.docsUrl}
		/>
	</Field>

	<fieldset class="grid gap-2">
		<legend class="mb-1.5 text-[0.8125rem] font-medium">Visibility</legend>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each [{ value: 'private', label: 'Private', icon: Lock, text: 'Only members and administrators can see this project.' }, { value: 'public', label: 'Public', icon: Globe, text: 'Every signed-in user can see and contribute.' }] as option (option.value)}
				{@const Icon = option.icon}
				<label
					class={cn(
						'flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors hover:border-border-strong has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring'
					)}
				>
					<input
						type="radio"
						name="visibility"
						value={option.value}
						bind:group={visibility}
						class="sr-only"
					/>
					<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<span>
						<span class="block text-sm font-medium">{option.label}</span>
						<span class="block text-xs text-muted-foreground">{option.text}</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
	{#if visibility === 'public'}
		<label class="flex items-start gap-3">
			<Switch name="allowAnonymousRead" bind:checked={anonymous} class="mt-0.5" />
			<span>
				<span class="block text-sm font-medium">Allow read-only access without signing in</span>
				<span class="block text-xs text-muted-foreground"
					>Visitors can browse tickets, the roadmap and changelog. Contributing still requires an
					account.</span
				>
			</span>
		</label>
	{/if}
</div>
