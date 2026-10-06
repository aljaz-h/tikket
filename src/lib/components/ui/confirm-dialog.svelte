<script lang="ts">
	import { AlertDialog } from 'bits-ui';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { buttonVariants } from './button.svelte';
	import { cn } from '$lib/utils';

	/**
	 * Styled confirmation dialog that submits a form action. Replaces browser-native confirm().
	 */
	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		confirmLabel?: string;
		destructive?: boolean;
		action: string;
		fields?: Record<string, string | number>;
		successMessage?: string;
		children?: Snippet;
		onSuccess?: () => void;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = 'Confirm',
		destructive = false,
		action,
		fields = {},
		successMessage,
		children,
		onSuccess
	}: Props = $props();

	let pending = $state(false);

	const submit: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === 'failure') {
				const errors = (result.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(errors)[0] ?? 'That did not work. Please try again.');
				return;
			}
			if (result.type === 'error') {
				toast.error(result.error?.message ?? 'Something went wrong.');
				return;
			}
			open = false;
			if (successMessage) toast.success(successMessage);
			onSuccess?.();
			await update();
		};
	};
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Portal>
		<AlertDialog.Overlay
			class="fixed inset-0 z-50 bg-black/55 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<AlertDialog.Content
			class="fixed top-[50%] left-[50%] z-50 grid w-[calc(100vw-2rem)] max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border bg-popover p-5 shadow-pop data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
		>
			<div class="grid gap-1.5">
				<AlertDialog.Title class="text-base font-semibold">{title}</AlertDialog.Title>
				{#if description}
					<AlertDialog.Description class="text-sm text-muted-foreground"
						>{description}</AlertDialog.Description
					>
				{/if}
			</div>
			<form method="POST" {action} use:enhance={submit} class="grid gap-4">
				{#each Object.entries(fields) as [name, value] (name)}
					<input type="hidden" {name} {value} />
				{/each}
				{@render children?.()}
				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<AlertDialog.Cancel type="button" class={buttonVariants({ variant: 'outline' })}
						>Cancel</AlertDialog.Cancel
					>
					<button
						type="submit"
						disabled={pending}
						class={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
					>
						{pending ? 'Working…' : confirmLabel}
					</button>
				</div>
			</form>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
