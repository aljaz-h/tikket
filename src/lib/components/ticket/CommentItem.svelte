<script lang="ts">
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Lock from '@lucide/svelte/icons/lock';
	import RichText from '../RichText.svelte';
	import RichTextEditor from '../RichTextEditor.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import TimeAgo from '../TimeAgo.svelte';
	import AttachmentGallery from '../AttachmentGallery.svelte';
	import ConfirmDialog from '../ui/confirm-dialog.svelte';
	import Button from '../ui/button.svelte';
	import Badge from '../ui/badge.svelte';
	import { formatDateTime } from '$lib/shared/format';
	import { PROJECT_ROLE_META, type ProjectRole } from '$lib/shared/constants';
	import { quickSubmit } from './enhance';

	interface Props {
		comment: {
			id: number;
			bodyHtml: string;
			internal: boolean;
			createdAt: Date;
			editedAt: Date | null;
			deletedAt: Date | null;
			author: { id: number; username: string; displayName: string; avatarId: string | null };
			authorRole: ProjectRole | null;
			authorGlobalRole: string;
			attachments: {
				id: string;
				originalName: string;
				size: number;
				width: number | null;
				height: number | null;
				hasThumbnail: boolean;
			}[];
			canEdit: boolean;
			canDelete: boolean;
		};
		isReporter: boolean;
		currentUserId: number | null;
	}
	let { comment, isReporter, currentUserId }: Props = $props();
	let editing = $state(false);
	let confirmOpen = $state(false);
	const roleLabel = $derived(
		comment.authorRole && comment.authorRole !== 'member'
			? PROJECT_ROLE_META[comment.authorRole].label
			: comment.authorGlobalRole === 'admin'
				? 'Admin'
				: null
	);
</script>

<article
	id="comment-{comment.id}"
	class="flex scroll-mt-24 gap-3"
	aria-label="{comment.internal ? 'Internal note' : 'Comment'} by {comment.author.displayName}"
	data-internal={comment.internal || undefined}
>
	<UserAvatar user={comment.author} size="md" class="mt-0.5" />
	<div
		class="min-w-0 flex-1 rounded-xl border {comment.internal
			? 'border-[var(--internal-border)] bg-[var(--internal-bg)]'
			: 'border-border bg-surface'}"
	>
		<header
			class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3.5 py-2 text-sm {comment.internal
				? 'border-[var(--internal-border)]'
				: 'border-border'}"
		>
			<span class="font-medium">{comment.author.displayName}</span>
			{#if comment.internal}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-[var(--internal-border)] px-2 py-0.5 text-xs font-medium text-[var(--internal-fg)]"
					title="Only project staff can see this note"><Lock class="size-3" /> Internal note</span
				>
			{/if}
			{#if roleLabel}<Badge variant="muted">{roleLabel}</Badge>{/if}
			{#if isReporter}<Badge>Reporter</Badge>{/if}
			<a href="#comment-{comment.id}" class="text-xs text-muted-foreground hover:underline"
				><TimeAgo date={comment.createdAt} /></a
			>
			{#if comment.editedAt && !comment.deletedAt}
				<span
					class="text-xs text-subtle-foreground"
					title="Edited {formatDateTime(comment.editedAt)}">(edited)</span
				>
			{/if}
			{#if !comment.deletedAt && (comment.canEdit || comment.canDelete)}
				<span class="ml-auto flex gap-0.5">
					{#if comment.canEdit}
						<Button
							variant="subtle"
							size="icon-xs"
							aria-label="Edit comment"
							onclick={() => (editing = !editing)}><Pencil class="size-3.5" /></Button
						>
					{/if}
					{#if comment.canDelete}
						<Button
							variant="subtle"
							size="icon-xs"
							aria-label="Delete comment"
							onclick={() => (confirmOpen = true)}><Trash2 class="size-3.5" /></Button
						>
					{/if}
				</span>
			{/if}
		</header>
		<div class="px-3.5 py-3">
			{#if comment.deletedAt}
				<p class="text-sm text-subtle-foreground italic">This comment was removed.</p>
			{:else if editing}
				<form
					method="POST"
					action="?/editComment"
					class="grid gap-2"
					use:enhance={quickSubmit({
						success: 'Comment updated',
						onSuccess: () => (editing = false)
					})}
				>
					<input type="hidden" name="commentId" value={comment.id} />
					<RichTextEditor
						id="edit-comment-{comment.id}"
						name="body"
						label="Edit comment"
						value={comment.bodyHtml}
						compact
						minHeight="4rem"
					/>
					<div class="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={() => (editing = false)}>Cancel</Button>
						<Button size="sm" type="submit">Save</Button>
					</div>
				</form>
			{:else}
				<RichText html={comment.bodyHtml} class="text-sm" />
				{#if comment.attachments.length}
					<div class="mt-3"><AttachmentGallery items={comment.attachments} size="sm" /></div>
				{/if}
			{/if}
		</div>
	</div>
</article>

{#if comment.canDelete}
	<ConfirmDialog
		bind:open={confirmOpen}
		title={comment.internal ? 'Delete this internal note?' : 'Delete this comment?'}
		description={comment.author.id === currentUserId
			? 'The comment will be replaced by a “removed” note.'
			: 'You are removing another user’s comment as a moderator. This is recorded in the activity history.'}
		confirmLabel="Delete"
		destructive
		action="?/deleteComment"
		fields={{ commentId: comment.id }}
		successMessage="Comment deleted"
	/>
{/if}
