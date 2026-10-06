<script lang="ts" module>
	import type { UploadedItem as Uploaded } from './AttachmentUploader.svelte';
	export interface TicketDraft {
		title: string;
		description: string;
		context: Record<string, string>;
		attachments: Uploaded[];
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import RichTextEditor from './RichTextEditor.svelte';
	import AttachmentUploader from './AttachmentUploader.svelte';
	import Field from './ui/field.svelte';
	import Input from './ui/input.svelte';
	import Textarea from './ui/textarea.svelte';
	import { CONTEXT_FIELDS, TYPE_META, type TicketType } from '$lib/shared/constants';

	interface Props {
		type: TicketType;
		draft: TicketDraft;
		errors?: Record<string, string>;
		allowAttachments: boolean;
		limits: { maxFiles: number; maxSize: number; accept: string[] };
		showUploader?: boolean;
		afterTitle?: Snippet;
		/** Extra questions (ticket templates) shown before the screenshots. */
		extra?: Snippet;
		onchange?: () => void;
		onsubmitshortcut?: () => void;
		editorKey?: string | number;
	}

	let {
		type,
		draft = $bindable(),
		errors = {},
		allowAttachments,
		limits,
		showUploader = true,
		afterTitle,
		extra,
		onchange,
		onsubmitshortcut,
		editorKey = 0
	}: Props = $props();

	const meta = $derived(TYPE_META[type]);
	const fields = $derived(CONTEXT_FIELDS[type]);
	const textFields = $derived(fields.filter((f) => f.kind === 'text'));
	const urlFields = $derived(fields.filter((f) => f.kind === 'url'));
	const filledContext = $derived(textFields.some((f) => draft.context[f.key]));
	let moreOpen = $state(false);
</script>

<div class="grid min-w-0 grid-cols-1 gap-5">
	<Field label="Title" for="title" required error={errors.title}>
		<Input
			id="title"
			name="title"
			required
			minlength={4}
			maxlength={160}
			autocomplete="off"
			placeholder={meta.titlePlaceholder}
			bind:value={draft.title}
			oninput={onchange}
			aria-invalid={!!errors.title}
			aria-describedby={errors.title ? 'title-error' : undefined}
			class="h-10 text-[0.9375rem]"
		/>
	</Field>

	{@render afterTitle?.()}

	<Field label={meta.descriptionLabel} for="description" required error={errors.description}>
		<p id="description-hint" class="-mt-0.5 text-xs text-muted-foreground">
			{meta.descriptionHint} You can paste links and formatted text.
		</p>
		{#key editorKey}
			<RichTextEditor
				id="description"
				name="description"
				label={meta.descriptionLabel}
				value={draft.description}
				placeholder={type === 'bug'
					? 'When I mark an episode as watched, the progress bar still shows the previous percentage…'
					: 'Describe it in your own words…'}
				invalid={!!errors.description}
				describedby="description-hint"
				onchange={(html) => {
					draft.description = html;
					onchange?.();
				}}
				{onsubmitshortcut}
			/>
		{/key}
	</Field>

	{#each urlFields as field (field.key)}
		<Field
			label={field.label}
			for="ctx_{field.key}"
			optional
			error={errors[`ctx_${field.key}`]}
			hint="The page where the problem happens."
		>
			<Input
				id="ctx_{field.key}"
				name="ctx_{field.key}"
				type="url"
				inputmode="url"
				placeholder={field.placeholder}
				bind:value={draft.context[field.key]}
				oninput={onchange}
				aria-invalid={!!errors[`ctx_${field.key}`]}
			/>
		</Field>
	{/each}

	{#if textFields.length}
		<details
			class="group rounded-lg border border-border"
			open={moreOpen || filledContext || type === 'bug' || undefined}
			ontoggle={(e) => (moreOpen = (e.currentTarget as HTMLDetailsElement).open)}
		>
			<summary
				class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium select-none [&::-webkit-details-marker]:hidden"
			>
				<ChevronRight
					class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
				/>
				More details
				<span class="text-xs font-normal text-subtle-foreground"
					>Optional — helps us understand faster</span
				>
			</summary>
			<div class="grid gap-4 border-t border-border p-3">
				{#each textFields as field (field.key)}
					<Field
						label={field.label}
						for="ctx_{field.key}"
						optional
						error={errors[`ctx_${field.key}`]}
					>
						<Textarea
							id="ctx_{field.key}"
							name="ctx_{field.key}"
							rows={field.key === 'steps' ? 4 : 2}
							maxlength={5000}
							placeholder={field.placeholder}
							bind:value={draft.context[field.key]}
							oninput={onchange}
						/>
					</Field>
				{/each}
			</div>
		</details>
	{/if}

	{@render extra?.()}

	{#if allowAttachments && showUploader}
		<Field label="Screenshots" optional error={errors.attachments}>
			<AttachmentUploader
				bind:items={draft.attachments}
				maxFiles={limits.maxFiles}
				maxSize={limits.maxSize}
				accept={limits.accept}
				onchange={() => onchange?.()}
			/>
		</Field>
	{/if}
</div>
