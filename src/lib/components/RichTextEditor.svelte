<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import Strikethrough from '@lucide/svelte/icons/strikethrough';
	import Code from '@lucide/svelte/icons/code';
	import Heading2 from '@lucide/svelte/icons/heading-2';
	import Heading3 from '@lucide/svelte/icons/heading-3';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Quote from '@lucide/svelte/icons/quote';
	import SquareCode from '@lucide/svelte/icons/square-code';
	import LinkIcon from '@lucide/svelte/icons/link';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import { cn } from '$lib/utils';

	/**
	 * Rich-text editor (Tiptap, loaded lazily). Without JavaScript a plain textarea is submitted
	 * instead; `${name}Format` tells the server which representation it received.
	 */
	interface Props {
		name: string;
		id: string;
		value?: string;
		placeholder?: string;
		label?: string;
		invalid?: boolean;
		describedby?: string;
		minHeight?: string;
		compact?: boolean;
		onchange?: (html: string, text: string) => void;
		onsubmitshortcut?: () => void;
	}

	let {
		name,
		id,
		value = '',
		placeholder = '',
		label = 'Description',
		invalid = false,
		describedby,
		minHeight = '9rem',
		compact = false,
		onchange,
		onsubmitshortcut
	}: Props = $props();

	let element: HTMLDivElement | undefined = $state();
	let editor: Editor | null = $state(null);
	let html = $state('');
	let version = $state(0);
	let linkOpen = $state(false);
	let linkValue = $state('');
	let linkInput: HTMLInputElement | undefined = $state();

	/** Plain-text approximation of the initial HTML for the no-JS textarea. */
	function toPlain(source: string) {
		return source
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|h2|h3|li|blockquote|pre)>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	export function setContent(next: string) {
		html = next;
		editor?.commands.setContent(next || '', { emitUpdate: false });
	}

	export function focus() {
		editor?.commands.focus('end');
	}

	onMount(async () => {
		const [{ Editor }, { default: StarterKit }, { Placeholder }] = await Promise.all([
			import('@tiptap/core'),
			import('@tiptap/starter-kit'),
			import('@tiptap/extension-placeholder')
		]);
		if (!element) return;
		html = value;
		editor = new Editor({
			element,
			content: value || '',
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3] },
					underline: false,
					link: {
						openOnClick: false,
						autolink: true,
						linkOnPaste: true,
						defaultProtocol: 'https',
						protocols: ['http', 'https', 'mailto'],
						HTMLAttributes: { rel: 'noopener noreferrer nofollow ugc', target: '_blank' },
						isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url)
					}
				}),
				Placeholder.configure({ placeholder })
			],
			editorProps: {
				// A function so the accessible name/description follow prop changes (e.g. ticket type).
				attributes: () => ({
					id,
					class: 'tiptap rich-text px-3 py-2.5 text-sm',
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-label': label,
					...(describedby ? { 'aria-describedby': describedby } : {}),
					...(invalid ? { 'aria-invalid': 'true' } : {}),
					style: `min-height:${minHeight}`
				}),
				handleKeyDown: (_view, event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && onsubmitshortcut) {
						onsubmitshortcut();
						return true;
					}
					if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
						openLink();
						return true;
					}
					return false;
				}
			},
			onTransaction: () => {
				version++;
			},
			onUpdate: ({ editor: e }) => {
				html = e.isEmpty ? '' : e.getHTML();
				onchange?.(html, e.getText());
			}
		});
	});

	onDestroy(() => editor?.destroy());

	$effect(() => {
		// Re-apply attributes when the label or validation state changes.
		void label;
		void invalid;
		if (editor && !editor.isDestroyed) editor.view.setProps({});
	});

	const isActive = (nameOrAttrs: string, attrs?: Record<string, unknown>) => {
		void version;
		return editor?.isActive(nameOrAttrs, attrs) ?? false;
	};

	function openLink() {
		if (!editor) return;
		linkValue = editor.getAttributes('link').href ?? '';
		linkOpen = true;
		queueMicrotask(() => linkInput?.focus());
	}

	function applyLink(e?: Event) {
		e?.preventDefault();
		if (!editor) return;
		const raw = linkValue.trim();
		if (!raw) {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			const href = /^(https?:\/\/|mailto:)/i.test(raw) ? raw : `https://${raw}`;
			if (editor.state.selection.empty && !editor.isActive('link')) {
				editor
					.chain()
					.focus()
					.insertContent({ type: 'text', text: raw, marks: [{ type: 'link', attrs: { href } }] })
					.run();
			} else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
		}
		linkOpen = false;
	}

	type Tool = {
		label: string;
		icon: typeof Bold;
		shortcut?: string;
		active?: () => boolean;
		run: () => void;
	};
	const tools: (Tool | 'sep')[] = [
		{
			label: 'Bold',
			icon: Bold,
			shortcut: 'Ctrl+B',
			active: () => isActive('bold'),
			run: () => editor?.chain().focus().toggleBold().run()
		},
		{
			label: 'Italic',
			icon: Italic,
			shortcut: 'Ctrl+I',
			active: () => isActive('italic'),
			run: () => editor?.chain().focus().toggleItalic().run()
		},
		{
			label: 'Strikethrough',
			icon: Strikethrough,
			active: () => isActive('strike'),
			run: () => editor?.chain().focus().toggleStrike().run()
		},
		{
			label: 'Inline code',
			icon: Code,
			shortcut: 'Ctrl+E',
			active: () => isActive('code'),
			run: () => editor?.chain().focus().toggleCode().run()
		},
		'sep',
		{
			label: 'Heading',
			icon: Heading2,
			active: () => isActive('heading', { level: 2 }),
			run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run()
		},
		{
			label: 'Subheading',
			icon: Heading3,
			active: () => isActive('heading', { level: 3 }),
			run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run()
		},
		{
			label: 'Bulleted list',
			icon: List,
			active: () => isActive('bulletList'),
			run: () => editor?.chain().focus().toggleBulletList().run()
		},
		{
			label: 'Numbered list',
			icon: ListOrdered,
			active: () => isActive('orderedList'),
			run: () => editor?.chain().focus().toggleOrderedList().run()
		},
		{
			label: 'Quote',
			icon: Quote,
			active: () => isActive('blockquote'),
			run: () => editor?.chain().focus().toggleBlockquote().run()
		},
		{
			label: 'Code block',
			icon: SquareCode,
			active: () => isActive('codeBlock'),
			run: () => editor?.chain().focus().toggleCodeBlock().run()
		},
		{
			label: 'Link',
			icon: LinkIcon,
			shortcut: 'Ctrl+K',
			active: () => isActive('link'),
			run: openLink
		},
		'sep',
		{
			label: 'Undo',
			icon: Undo2,
			shortcut: 'Ctrl+Z',
			run: () => editor?.chain().focus().undo().run()
		},
		{
			label: 'Redo',
			icon: Redo2,
			shortcut: 'Ctrl+Shift+Z',
			run: () => editor?.chain().focus().redo().run()
		}
	];

	function onToolbarKey(e: KeyboardEvent) {
		// Roving focus between toolbar buttons with the arrow keys.
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll('button')];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			buttons[(index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
		next?.focus();
		e.preventDefault();
	}
</script>

<div
	class={cn(
		'rounded-md border border-input bg-surface shadow-card transition-colors focus-within:border-primary-border focus-within:ring-3 focus-within:ring-ring/40',
		invalid && 'border-destructive'
	)}
>
	{#if editor}
		<div
			role="toolbar"
			aria-label="Formatting"
			aria-controls={id}
			tabindex="-1"
			onkeydown={onToolbarKey}
			class={cn(
				'flex scrollbar-thin items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1',
				compact && 'py-0.5'
			)}
		>
			{#each tools as tool, i (i)}
				{#if tool === 'sep'}
					<span class="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true"></span>
				{:else}
					{@const Icon = tool.icon}
					{@const active = tool.active?.() ?? false}
					<button
						type="button"
						tabindex={i === 0 ? 0 : -1}
						class={cn(
							'inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
							active && 'bg-primary-soft text-link hover:bg-primary-soft hover:text-link'
						)}
						aria-label={tool.label}
						aria-pressed={tool.active ? active : undefined}
						title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
						onclick={tool.run}
					>
						<Icon class="size-4" />
					</button>
				{/if}
			{/each}
		</div>
		{#if linkOpen}
			<div class="flex items-center gap-2 border-b border-border px-2 py-1.5">
				<LinkIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<input
					bind:this={linkInput}
					bind:value={linkValue}
					type="url"
					inputmode="url"
					placeholder="https://example.com"
					aria-label="Link address"
					class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
					onkeydown={(e) => {
						if (e.key === 'Enter') applyLink(e);
						if (e.key === 'Escape') {
							e.preventDefault();
							e.stopPropagation();
							linkOpen = false;
							editor?.commands.focus();
						}
					}}
				/>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs font-medium text-link hover:bg-hover"
					onclick={applyLink}
				>
					Apply
				</button>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-hover"
					onclick={() => {
						linkOpen = false;
						editor?.commands.focus();
					}}>Cancel</button
				>
			</div>
		{/if}
	{/if}

	<div bind:this={element} class={editor ? '' : 'hidden'}></div>

	{#if editor}
		<input type="hidden" {name} value={html} />
		<input type="hidden" name="{name}Format" value="html" />
	{:else}
		<textarea
			{id}
			{name}
			{placeholder}
			aria-label={label}
			aria-invalid={invalid || undefined}
			aria-describedby={describedby}
			class="block w-full resize-y rounded-md bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-subtle-foreground"
			style="min-height:{minHeight}">{toPlain(value)}</textarea
		>
		<input type="hidden" name="{name}Format" value="text" />
	{/if}
</div>
