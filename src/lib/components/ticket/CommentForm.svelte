<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import RichTextEditor from '../RichTextEditor.svelte';
	import AttachmentUploader, { type UploadedItem } from '../AttachmentUploader.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import Button from '../ui/button.svelte';
	import Lock from '@lucide/svelte/icons/lock';

	interface Props {
		user: { displayName: string; avatarId: string | null };
		allowAttachments: boolean;
		limits: { maxFiles: number; maxSize: number; accept: string[] };
		draftKey: string;
		/** Staff may switch between a public reply and an internal (staff-only) note. */
		canWriteInternal?: boolean;
		/** False when only internal notes are possible (e.g. comments locked for the public). */
		canComment?: boolean;
	}
	let {
		user,
		allowAttachments,
		limits,
		draftKey,
		canWriteInternal = false,
		canComment = true
	}: Props = $props();
	let internal = $state(false);
	$effect.pre(() => {
		if (!canComment && canWriteInternal) internal = true;
	});
	let editorKey = $state(0);
	let initial = $state('');
	let attachments = $state<UploadedItem[]>([]);
	let pending = $state(false);
	let formEl: HTMLFormElement | undefined = $state();
	let hasContent = $state(false);

	$effect(() => {
		try {
			initial = localStorage.getItem(draftKey) ?? '';
			hasContent = !!initial;
			if (initial) editorKey++;
		} catch {
			/* ignore */
		}
	});

	function save(html: string) {
		hasContent = !!html;
		try {
			if (html) localStorage.setItem(draftKey, html);
			else localStorage.removeItem(draftKey);
		} catch {
			/* ignore */
		}
	}
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/comment"
	enctype="multipart/form-data"
	class="flex gap-3"
	use:enhance={() => {
		pending = true;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === 'failure') {
				const errors = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(errors)[0] ?? 'Could not post the comment.');
				return;
			}
			if (result.type === 'success') {
				save('');
				initial = '';
				attachments = [];
				editorKey++;
				toast.success(internal ? 'Internal note added' : 'Comment posted');
			}
			await update({ reset: false });
		};
	}}
>
	<UserAvatar {user} size="md" class="mt-1 hidden sm:inline-flex" />
	<div class="grid min-w-0 flex-1 gap-2">
		{#if canWriteInternal}
			<input type="hidden" name="internal" value={internal ? '1' : '0'} />
			<div
				role="radiogroup"
				aria-label="Comment visibility"
				class="inline-flex w-fit rounded-lg border border-border bg-surface-2 p-0.5 text-xs font-medium"
			>
				{#if canComment}
					<button
						type="button"
						role="radio"
						aria-checked={!internal}
						class="rounded-md px-2.5 py-1 transition-colors {internal
							? 'text-muted-foreground hover:text-foreground'
							: 'bg-surface text-foreground shadow-xs'}"
						onclick={() => (internal = false)}>Public reply</button
					>
				{/if}
				<button
					type="button"
					role="radio"
					aria-checked={internal}
					class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors {internal
						? 'bg-[var(--internal-bg)] text-[var(--internal-fg)] shadow-xs'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (internal = true)}><Lock class="size-3" /> Internal note</button
				>
			</div>
		{/if}
		<label for="comment-body" class="sr-only"
			>{internal ? 'Write an internal note' : 'Write a comment'}</label
		>
		{#key editorKey}
			<RichTextEditor
				id="comment-body"
				name="body"
				label="Comment"
				value={initial}
				compact
				minHeight="5rem"
				placeholder={internal
					? 'Only project staff will see this note. Use @username to mention a teammate.'
					: 'Write a comment… Use @username to mention someone.'}
				onchange={save}
				onsubmitshortcut={() => formEl?.requestSubmit()}
			/>
		{/key}
		{#if allowAttachments}
			<AttachmentUploader
				bind:items={attachments}
				compact
				label="Comment images"
				maxFiles={limits.maxFiles}
				maxSize={limits.maxSize}
				accept={limits.accept}
				onchange={(items) => (hasContent = hasContent || items.length > 0)}
			/>
		{/if}
		<div class="flex items-center justify-end gap-2">
			{#if internal}
				<span class="mr-auto text-xs text-[var(--internal-fg)]">Visible to project staff only</span>
			{/if}
			<span class="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter to post</span>
			<Button type="submit" loading={pending}>{internal ? 'Add note' : 'Comment'}</Button>
		</div>
	</div>
</form>
