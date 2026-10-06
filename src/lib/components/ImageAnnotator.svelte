<script lang="ts" module>
	export type AnnotationTool =
		'arrow' | 'rect' | 'ellipse' | 'pen' | 'text' | 'highlight' | 'pixelate' | 'redact';

	export type Shape =
		| {
				kind: 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'pixelate' | 'redact';
				x1: number;
				y1: number;
				x2: number;
				y2: number;
				color: string;
				width: number;
		  }
		| { kind: 'pen'; points: [number, number][]; color: string; width: number }
		| { kind: 'text'; x: number; y: number; text: string; color: string; size: number };

	/** Normalised rectangle (positive width/height) clipped to the image. */
	export function normRect(
		s: { x1: number; y1: number; x2: number; y2: number },
		w: number,
		h: number
	) {
		const x = Math.max(0, Math.min(s.x1, s.x2));
		const y = Math.max(0, Math.min(s.y1, s.y2));
		const right = Math.min(w, Math.max(s.x1, s.x2));
		const bottom = Math.min(h, Math.max(s.y1, s.y2));
		return {
			x: Math.floor(x),
			y: Math.floor(y),
			w: Math.ceil(right - x),
			h: Math.ceil(bottom - y)
		};
	}

	/**
	 * Draws the image and all shapes onto a 2D context, in order. Redaction paints fully opaque
	 * pixels and pixelation replaces the area with averaged blocks, so after export the original
	 * pixels are gone – nothing is an overlay that could be removed later.
	 */
	export function renderAnnotations(
		ctx: CanvasRenderingContext2D,
		img: CanvasImageSource,
		w: number,
		h: number,
		shapes: Shape[]
	) {
		ctx.save();
		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(img, 0, 0, w, h);
		for (const s of shapes) {
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			if (s.kind === 'pen') {
				ctx.strokeStyle = s.color;
				ctx.lineWidth = s.width;
				ctx.beginPath();
				s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
				ctx.stroke();
				continue;
			}
			if (s.kind === 'text') {
				ctx.font = `600 ${s.size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
				ctx.textBaseline = 'top';
				ctx.lineWidth = Math.max(2, s.size / 6);
				ctx.strokeStyle = 'rgba(0,0,0,0.65)';
				ctx.strokeText(s.text, s.x, s.y);
				ctx.fillStyle = s.color;
				ctx.fillText(s.text, s.x, s.y);
				continue;
			}
			const r = normRect(s, w, h);
			if (r.w < 1 || r.h < 1) continue;
			switch (s.kind) {
				case 'redact':
					ctx.globalAlpha = 1;
					ctx.fillStyle = '#000000';
					ctx.fillRect(r.x, r.y, r.w, r.h);
					break;
				case 'pixelate': {
					const block = Math.max(10, Math.round(Math.max(w, h) / 80));
					const sw = Math.max(1, Math.ceil(r.w / block));
					const sh = Math.max(1, Math.ceil(r.h / block));
					const small = document.createElement('canvas');
					small.width = sw;
					small.height = sh;
					const sctx = small.getContext('2d')!;
					sctx.imageSmoothingEnabled = true;
					sctx.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
					ctx.imageSmoothingEnabled = false;
					ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
					ctx.imageSmoothingEnabled = true;
					break;
				}
				case 'highlight':
					ctx.fillStyle = 'rgba(255, 214, 0, 0.35)';
					ctx.fillRect(r.x, r.y, r.w, r.h);
					break;
				case 'rect':
					ctx.strokeStyle = s.color;
					ctx.lineWidth = s.width;
					ctx.strokeRect(r.x, r.y, r.w, r.h);
					break;
				case 'ellipse':
					ctx.strokeStyle = s.color;
					ctx.lineWidth = s.width;
					ctx.beginPath();
					ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
					ctx.stroke();
					break;
				case 'arrow': {
					const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
					const head = s.width * 4;
					ctx.strokeStyle = s.color;
					ctx.fillStyle = s.color;
					ctx.lineWidth = s.width;
					ctx.beginPath();
					ctx.moveTo(s.x1, s.y1);
					ctx.lineTo(s.x2 - Math.cos(angle) * head * 0.6, s.y2 - Math.sin(angle) * head * 0.6);
					ctx.stroke();
					ctx.beginPath();
					ctx.moveTo(s.x2, s.y2);
					ctx.lineTo(
						s.x2 - head * Math.cos(angle - Math.PI / 7),
						s.y2 - head * Math.sin(angle - Math.PI / 7)
					);
					ctx.lineTo(
						s.x2 - head * Math.cos(angle + Math.PI / 7),
						s.y2 - head * Math.sin(angle + Math.PI / 7)
					);
					ctx.closePath();
					ctx.fill();
					break;
				}
			}
		}
		ctx.restore();
	}
</script>

<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { tick } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Square from '@lucide/svelte/icons/square';
	import Circle from '@lucide/svelte/icons/circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Type from '@lucide/svelte/icons/type';
	import Highlighter from '@lucide/svelte/icons/highlighter';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Button from './ui/button.svelte';
	import { formatBytes } from '$lib/shared/text';
	import { cn } from '$lib/utils';

	interface Props {
		open?: boolean;
		src: string;
		name: string;
		maxSize: number;
		onsave: (blob: Blob, name: string) => Promise<void> | void;
		oncancel?: () => void;
	}
	let { open = $bindable(false), src, name, maxSize, onsave, oncancel }: Props = $props();

	const TOOLS: { id: AnnotationTool; label: string; key: string; icon: typeof Square }[] = [
		{ id: 'arrow', label: 'Arrow', key: 'a', icon: ArrowUpRight },
		{ id: 'rect', label: 'Rectangle', key: 'r', icon: Square },
		{ id: 'ellipse', label: 'Circle', key: 'o', icon: Circle },
		{ id: 'pen', label: 'Freehand', key: 'p', icon: Pencil },
		{ id: 'text', label: 'Text', key: 't', icon: Type },
		{ id: 'highlight', label: 'Highlight', key: 'h', icon: Highlighter },
		{ id: 'pixelate', label: 'Pixelate', key: 'b', icon: Grid3x3 },
		{ id: 'redact', label: 'Redact (solid black, permanent)', key: 'x', icon: EyeOff }
	];
	const COLORS = [
		{ value: '#ef4444', label: 'Red' },
		{ value: '#f59e0b', label: 'Amber' },
		{ value: '#22c55e', label: 'Green' },
		{ value: '#3b82f6', label: 'Blue' },
		{ value: '#ffffff', label: 'White' },
		{ value: '#111111', label: 'Black' }
	];

	let canvas: HTMLCanvasElement | undefined = $state();
	let image: HTMLImageElement | null = null;
	let loading = $state(true);
	let loadError = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let tool = $state<AnnotationTool>('arrow');
	let color = $state('#ef4444');
	/** History of states; index points at the current one. Reset is just another state. */
	let history = $state<Shape[][]>([[]]);
	let index = $state(0);
	let draft: Shape | null = null;
	let textEntry = $state<{ x: number; y: number; left: number; top: number; value: string } | null>(
		null
	);
	let textInput: HTMLInputElement | undefined = $state();
	let announcement = $state('');
	let size = $state({ w: 0, h: 0 });

	const shapes = $derived(history[index]);
	const canUndo = $derived(index > 0);
	const canRedo = $derived(index < history.length - 1);
	const strokeWidth = $derived(Math.max(3, Math.round(Math.max(size.w, size.h) / 300)));

	$effect(() => {
		if (open) void load(src);
	});

	async function load(url: string) {
		loading = true;
		loadError = '';
		history = [[]];
		index = 0;
		textEntry = null;
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		try {
			await img.decode();
		} catch {
			loadError = 'The image could not be opened for editing.';
			loading = false;
			return;
		}
		image = img;
		size = { w: img.naturalWidth, h: img.naturalHeight };
		loading = false;
		await tick();
		redraw();
	}

	function redraw() {
		if (!canvas || !image) return;
		canvas.width = size.w;
		canvas.height = size.h;
		const ctx = canvas.getContext('2d')!;
		renderAnnotations(ctx, image, size.w, size.h, draft ? [...shapes, draft] : shapes);
	}

	function commit(next: Shape[], message: string) {
		history = [...history.slice(0, index + 1), next];
		index = history.length - 1;
		announcement = message;
		redraw();
	}

	function undo() {
		if (!canUndo) return;
		index--;
		announcement = 'Undone';
		redraw();
	}
	function redo() {
		if (!canRedo) return;
		index++;
		announcement = 'Redone';
		redraw();
	}
	function reset() {
		if (!shapes.length) return;
		commit([], 'All annotations removed');
	}

	/** Maps a pointer position to image pixels (the canvas is scaled to fit, never stretched). */
	function toImage(e: PointerEvent) {
		const rect = canvas!.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) * size.w) / rect.width,
			y: ((e.clientY - rect.top) * size.h) / rect.height,
			left: e.clientX - rect.left,
			top: e.clientY - rect.top
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (!canvas || loading || e.button !== 0) return;
		const p = toImage(e);
		if (tool === 'text') {
			textEntry = { x: p.x, y: p.y, left: p.left, top: p.top, value: '' };
			void tick().then(() => textInput?.focus());
			return;
		}
		canvas.setPointerCapture(e.pointerId);
		draft =
			tool === 'pen'
				? { kind: 'pen', points: [[p.x, p.y]], color, width: strokeWidth }
				: { kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width: strokeWidth };
		redraw();
	}

	function onPointerMove(e: PointerEvent) {
		if (!draft) return;
		const p = toImage(e);
		if (draft.kind === 'pen') draft.points.push([p.x, p.y]);
		else if (draft.kind !== 'text') {
			draft.x2 = p.x;
			draft.y2 = p.y;
		}
		redraw();
	}

	function onPointerUp() {
		if (!draft) return;
		const shape = draft;
		draft = null;
		const tiny =
			shape.kind === 'pen'
				? shape.points.length < 2
				: shape.kind !== 'text' &&
					Math.abs(shape.x2 - shape.x1) < 3 &&
					Math.abs(shape.y2 - shape.y1) < 3;
		if (tiny) return redraw();
		commit([...shapes, shape], `${TOOLS.find((t) => t.id === shape.kind)?.label ?? 'Shape'} added`);
	}

	function addText() {
		if (!textEntry) return;
		const text = textEntry.value.trim().slice(0, 200);
		const entry = textEntry;
		textEntry = null;
		if (text)
			commit(
				[...shapes, { kind: 'text', x: entry.x, y: entry.y, text, color, size: strokeWidth * 7 }],
				'Text added'
			);
	}

	function onKey(e: KeyboardEvent) {
		if (textEntry || (e.target as HTMLElement).tagName === 'INPUT') return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && e.key.toLowerCase() === 'y') {
			e.preventDefault();
			redo();
			return;
		}
		if (mod || e.altKey) return;
		const found = TOOLS.find((t) => t.key === e.key.toLowerCase());
		if (found) {
			tool = found.id;
			announcement = `${found.label} tool`;
		}
	}

	function toBlob(c: HTMLCanvasElement, type: string, quality?: number) {
		return new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));
	}

	/**
	 * Exports the flattened image at its original size. Canvas output carries no EXIF/GPS metadata
	 * (and the server re-encodes again). Large results fall back to JPEG and, if needed, downscaling
	 * so the edited image stays within the upload limit.
	 */
	async function save() {
		if (!canvas || !image) return;
		saving = true;
		saveError = '';
		textEntry = null;
		draft = null;
		redraw();
		try {
			const isJpeg = /\.jpe?g$/i.test(name);
			let blob = await toBlob(canvas, isJpeg ? 'image/jpeg' : 'image/png', 0.92);
			let type = isJpeg ? 'image/jpeg' : 'image/png';
			for (const q of [0.88, 0.8]) {
				if (blob && blob.size <= maxSize) break;
				blob = await toBlob(canvas, 'image/jpeg', q);
				type = 'image/jpeg';
			}
			let scale = 0.8;
			while (blob && blob.size > maxSize && scale > 0.2) {
				const off = document.createElement('canvas');
				off.width = Math.round(size.w * scale);
				off.height = Math.round(size.h * scale);
				off.getContext('2d')!.drawImage(canvas, 0, 0, off.width, off.height);
				blob = await toBlob(off, 'image/jpeg', 0.85);
				type = 'image/jpeg';
				scale -= 0.2;
			}
			if (!blob || blob.size > maxSize)
				throw new Error(`The edited image is larger than ${formatBytes(maxSize)}.`);
			const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/-annotated$/, '');
			await onsave(blob, `${base}-annotated.${type === 'image/jpeg' ? 'jpg' : 'png'}`);
			open = false;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Saving failed.';
		} finally {
			saving = false;
		}
	}

	function cancel() {
		open = false;
		oncancel?.();
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && oncancel?.()}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-pop outline-none sm:inset-6"
			onkeydown={onKey}
		>
			<header class="flex items-center gap-3 border-b border-border px-4 py-2.5">
				<Dialog.Title class="min-w-0 flex-1 truncate text-sm font-semibold"
					>Annotate {name}</Dialog.Title
				>
				<Dialog.Description class="sr-only">
					Draw on the screenshot. Redact permanently blacks out sensitive areas. Keyboard: A arrow,
					R rectangle, O circle, P freehand, T text, H highlight, B pixelate, X redact, Ctrl+Z undo,
					Ctrl+Shift+Z redo.
				</Dialog.Description>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
					onclick={cancel}
					aria-label="Cancel editing"
				>
					<X class="size-4" />
				</button>
			</header>

			<div
				class="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5"
				role="toolbar"
				aria-label="Annotation tools"
			>
				{#each TOOLS as t (t.id)}
					{@const Icon = t.icon}
					<button
						type="button"
						class={cn(
							'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground',
							tool === t.id && 'bg-primary-soft text-link hover:bg-primary-soft hover:text-link',
							t.id === 'redact' && tool !== t.id && 'text-destructive'
						)}
						aria-pressed={tool === t.id}
						aria-label={t.label}
						title="{t.label} ({t.key.toUpperCase()})"
						onclick={() => (tool = t.id)}
					>
						<Icon class="size-4" />
					</button>
				{/each}
				<span class="mx-1 h-6 w-px bg-border" aria-hidden="true"></span>
				<div class="flex items-center gap-1" role="radiogroup" aria-label="Colour">
					{#each COLORS as c (c.value)}
						<button
							type="button"
							role="radio"
							aria-checked={color === c.value}
							aria-label={c.label}
							title={c.label}
							class={cn(
								'size-6 rounded-full border border-border-strong',
								color === c.value && 'ring-2 ring-primary ring-offset-2 ring-offset-popover'
							)}
							style="background:{c.value}"
							onclick={() => (color = c.value)}
						></button>
					{/each}
				</div>
				<span class="mx-1 h-6 w-px bg-border" aria-hidden="true"></span>
				<button
					type="button"
					class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
					onclick={undo}
					disabled={!canUndo}
					aria-label="Undo"
					title="Undo (Ctrl+Z)"><Undo2 class="size-4" /></button
				>
				<button
					type="button"
					class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
					onclick={redo}
					disabled={!canRedo}
					aria-label="Redo"
					title="Redo (Ctrl+Shift+Z)"><Redo2 class="size-4" /></button
				>
				<button
					type="button"
					class="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
					onclick={reset}
					disabled={!shapes.length}
					aria-label="Reset all annotations"><RotateCcw class="size-4" /> Reset</button
				>
			</div>

			<div
				class="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] [background-size:16px_16px] p-3"
			>
				{#if loading}
					<LoaderCircle class="size-6 animate-spin text-muted-foreground" />
				{:else if loadError}
					<p class="text-sm text-destructive" role="alert">{loadError}</p>
				{:else}
					<div class="relative inline-block max-h-full max-w-full">
						<canvas
							bind:this={canvas}
							class="block h-auto max-h-[calc(100dvh-14rem)] w-auto max-w-full cursor-crosshair touch-none shadow-pop"
							aria-label="Screenshot being annotated, {shapes.length} annotation{shapes.length === 1
								? ''
								: 's'}"
							data-testid="annotation-canvas"
							onpointerdown={onPointerDown}
							onpointermove={onPointerMove}
							onpointerup={onPointerUp}
							onpointercancel={onPointerUp}
						></canvas>
						{#if textEntry}
							<form
								class="absolute z-10 flex gap-1 rounded-md border border-border bg-popover p-1 shadow-pop"
								style="left:{Math.max(0, textEntry.left)}px; top:{Math.max(0, textEntry.top)}px"
								onsubmit={(e) => {
									e.preventDefault();
									addText();
								}}
							>
								<input
									bind:this={textInput}
									bind:value={textEntry.value}
									class="h-7 w-48 rounded border border-input bg-surface px-2 text-sm outline-none"
									placeholder="Text"
									aria-label="Annotation text"
									maxlength="200"
									onkeydown={(e) => {
										if (e.key === 'Escape') {
											e.stopPropagation();
											e.preventDefault();
											textEntry = null;
										}
									}}
								/>
								<button
									type="submit"
									class="rounded bg-primary px-2 text-xs font-medium text-primary-foreground"
									>Add</button
								>
							</form>
						{/if}
					</div>
				{/if}
			</div>

			<footer class="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
				<p class="min-w-0 flex-1 text-xs text-muted-foreground">
					{#if tool === 'redact'}Redacted areas are replaced with solid black pixels in the saved
						image.{:else if tool === 'pixelate'}Pixelation can leave large text partly readable –
						use Redact for passwords or personal data.{:else}{size.w}×{size.h}px · The original
						upload is replaced when you save.{/if}
				</p>
				{#if saveError}<p class="text-xs text-destructive" role="alert">{saveError}</p>{/if}
				<Button variant="ghost" onclick={cancel}>Cancel</Button>
				<Button onclick={save} loading={saving} disabled={loading || !!loadError}>Save image</Button
				>
			</footer>
			<div class="sr-only" aria-live="polite">{announcement}</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
