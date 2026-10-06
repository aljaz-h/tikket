<script lang="ts" module>
	export interface SelectItem {
		value: string;
		label: string;
		/** Items with the same group are listed under a heading, in order of first appearance. */
		group?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Combobox, Select } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import NativeSelect from './native-select.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		items: SelectItem[];
		value?: string;
		name?: string;
		id?: string;
		placeholder?: string;
		/** Adds a filter field – use for long lists such as people. */
		searchable?: boolean;
		/** Submits the surrounding form when the value changes. */
		autosubmit?: boolean;
		required?: boolean;
		disabled?: boolean;
		size?: 'default' | 'sm';
		class?: string;
		'aria-label'?: string;
		'aria-invalid'?: boolean;
		onchange?: (value: string) => void;
	}
	let {
		items,
		value = $bindable(''),
		name,
		id,
		placeholder = 'Select…',
		searchable = false,
		autosubmit = false,
		required = false,
		disabled = false,
		size = 'default',
		class: className,
		'aria-label': ariaLabel,
		'aria-invalid': ariaInvalid,
		onchange
	}: Props = $props();

	/*
	 * Progressive enhancement: the server (and browsers without JavaScript) render a themed
	 * native <select> with the same name and options; after hydration it is swapped for the
	 * custom listbox, which submits the value through a hidden input.
	 * `required` is only enforced natively by the fallback: the custom control's hidden input
	 * can't show a validation message, so it is announced via aria-required and the server
	 * reports a missing value next to the field.
	 */
	let mounted = $state(false);
	onMount(() => (mounted = true));

	let root: HTMLElement | undefined = $state();
	let search = $state('');
	let open = $state(false);

	const selected = $derived(items.find((i) => i.value === value));
	const filtered = $derived(
		search.trim()
			? items.filter((i) => i.label.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);
	const groups = $derived.by(() => {
		const out: { name: string | undefined; items: SelectItem[] }[] = [];
		for (const item of filtered) {
			const g = out.find((x) => x.name === item.group);
			if (g) g.items.push(item);
			else out.push({ name: item.group, items: [item] });
		}
		return out;
	});

	async function changed(next: string) {
		value = next;
		// Let the hidden input pick up the new value before anyone reads or submits the form.
		await tick();
		onchange?.(next);
		if (autosubmit) root?.closest('form')?.requestSubmit();
	}

	const control = $derived(
		cn(
			'flex w-full min-w-0 items-center gap-2 rounded-md border border-input bg-surface pr-2 pl-3 text-left text-sm text-foreground shadow-card transition-colors outline-none hover:border-border-strong focus-visible:border-primary-border focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=open]:border-primary-border',
			size === 'sm' ? 'h-8 text-[0.8125rem]' : 'h-9'
		)
	);
	const content =
		'z-50 max-h-[min(20rem,var(--bits-select-content-available-height,20rem))] w-[var(--bits-select-anchor-width)] min-w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-sm shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]';
	const itemClass =
		'relative flex min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover data-[selected]:font-medium';
</script>

{#snippet itemList(
	Item: typeof Select.Item | typeof Combobox.Item,
	Group: typeof Select.Group,
	Heading: typeof Select.GroupHeading
)}
	{#each groups as group (group.name ?? '')}
		{#if group.name}
			<Group>
				<Heading class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
					>{group.name}</Heading
				>
				{#each group.items as item (item.value)}
					<Item value={item.value} label={item.label} disabled={item.disabled} class={itemClass}>
						{#snippet children({ selected: isSelected })}
							<span class="truncate">{item.label}</span>
							{#if isSelected}<Check class="absolute right-2 size-4 text-link" />{/if}
						{/snippet}
					</Item>
				{/each}
			</Group>
		{:else}
			{#each group.items as item (item.value)}
				<Item value={item.value} label={item.label} disabled={item.disabled} class={itemClass}>
					{#snippet children({ selected: isSelected })}
						<span class="truncate">{item.label}</span>
						{#if isSelected}<Check class="absolute right-2 size-4 text-link" />{/if}
					{/snippet}
				</Item>
			{/each}
		{/if}
	{:else}
		<p class="px-2 py-3 text-center text-muted-foreground">No matches</p>
	{/each}
{/snippet}

<span bind:this={root} class={cn('block min-w-0', className)} data-select>
	{#if !mounted}
		<NativeSelect
			{id}
			{name}
			bind:value
			{required}
			{disabled}
			aria-label={ariaLabel}
			aria-invalid={ariaInvalid}
			class={size === 'sm' ? '[&_select]:h-8 [&_select]:text-[0.8125rem]' : undefined}
		>
			{#if !required || !value}<option value="" disabled={required}>{placeholder}</option>{/if}
			{#each groups as group (group.name ?? '')}
				{#if group.name}
					<optgroup label={group.name}>
						{#each group.items as item (item.value)}
							<option value={item.value} disabled={item.disabled}>{item.label}</option>
						{/each}
					</optgroup>
				{:else}
					{#each group.items as item (item.value)}
						<option value={item.value} disabled={item.disabled}>{item.label}</option>
					{/each}
				{/if}
			{/each}
		</NativeSelect>
	{:else if searchable}
		<Combobox.Root
			type="single"
			{name}
			{disabled}
			{value}
			items={filtered}
			bind:open
			onValueChange={(v) => void changed(v)}
			onOpenChange={(o) => {
				if (!o) search = '';
			}}
		>
			<div class="relative">
				<Combobox.Input
					{id}
					class={cn(control, 'pr-8')}
					placeholder={selected?.label ?? placeholder}
					defaultValue={selected?.label ?? ''}
					aria-label={ariaLabel}
					aria-invalid={ariaInvalid}
					aria-required={required || undefined}
					oninput={(e) => {
						search = e.currentTarget.value;
						open = true;
					}}
					onfocus={(e) => e.currentTarget.select()}
				/>
				<Combobox.Trigger
					class="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
					aria-label="Show options"
					tabindex={-1}
				>
					<ChevronsUpDown class="size-4" />
				</Combobox.Trigger>
			</div>
			<Combobox.Portal>
				<Combobox.Content
					class={cn(content, 'w-[var(--bits-combobox-anchor-width)]')}
					sideOffset={6}
				>
					<Combobox.Viewport class="max-h-72 overflow-y-auto">
						{@render itemList(Combobox.Item, Combobox.Group, Combobox.GroupHeading)}
					</Combobox.Viewport>
				</Combobox.Content>
			</Combobox.Portal>
		</Combobox.Root>
	{:else}
		<Select.Root
			type="single"
			{name}
			{disabled}
			{value}
			{items}
			bind:open
			onValueChange={(v) => void changed(v)}
		>
			<Select.Trigger
				{id}
				class={control}
				aria-label={ariaLabel}
				aria-invalid={ariaInvalid}
				aria-required={required || undefined}
			>
				<span class={cn('min-w-0 flex-1 truncate', !selected && 'text-subtle-foreground')}
					>{selected?.label ?? placeholder}</span
				>
				<ChevronDown
					class={cn(
						'size-4 shrink-0 text-muted-foreground transition-transform',
						open && 'rotate-180'
					)}
				/>
			</Select.Trigger>
			<Select.Portal>
				<Select.Content class={content} sideOffset={6}>
					<Select.Viewport class="max-h-72 overflow-y-auto">
						{@render itemList(Select.Item, Select.Group, Select.GroupHeading)}
					</Select.Viewport>
				</Select.Content>
			</Select.Portal>
		</Select.Root>
	{/if}
</span>
