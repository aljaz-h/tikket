<script lang="ts">
	import { page } from '$app/state';
	import { DropdownMenu } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { menuContentClass, menuItemClass } from '$lib/components/ui/menu-styles';
	import { projectPath } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { children, data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings'));
	const path = $derived(page.url.pathname.replace(/\/$/, ''));

	// "General" groups several pages. The active one is derived from the URL, so the label stays
	// right for links, reloads and back/forward navigation alike.
	const general = $derived([
		{ href: base, label: 'General settings', short: 'General' },
		{ href: `${base}/members`, label: 'Members', short: 'Members' },
		{ href: `${base}/labels`, label: 'Labels', short: 'Labels' },
		{ href: `${base}/roadmap`, label: 'Roadmap visibility', short: 'Roadmap' },
		{ href: `${base}/export`, label: 'Export data', short: 'Export' },
		{ href: `${base}/danger`, label: 'Danger zone', short: 'Danger zone' }
	]);
	const currentGeneral = $derived(general.find((g) => g.href === path) ?? null);
	const tabs = $derived([
		{ href: `${base}/widget`, label: 'Feedback widget' },
		{ href: `${base}/templates`, label: 'Ticket templates' },
		{ href: `${base}/integrations`, label: 'Integrations' }
	]);
	const tabActive = (href: string) => path === href || path.startsWith(`${href}/`);
	let open = $state(false);
	const tabClass = (active: boolean) =>
		cn(
			'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors',
			active
				? 'bg-hover font-medium text-foreground'
				: 'text-muted-foreground hover:text-foreground'
		);
</script>

<div class="grid gap-6">
	<nav
		class="flex w-full flex-wrap gap-1 rounded-lg border border-border bg-surface p-1 sm:w-fit"
		aria-label="Settings sections"
	>
		<DropdownMenu.Root bind:open>
			<DropdownMenu.Trigger
				class={cn(tabClass(!!currentGeneral), 'data-[state=open]:bg-hover')}
				aria-label="General settings: {currentGeneral?.label ?? 'choose a section'}"
				aria-current={currentGeneral ? 'page' : undefined}
			>
				{currentGeneral?.short ?? 'General'}
				<ChevronDown class={cn('size-3.5 transition-transform', open && 'rotate-180')} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content class={menuContentClass} align="start" sideOffset={6}>
					{#each general as g (g.href)}
						<DropdownMenu.Item class={cn(menuItemClass, 'pr-8')}>
							{#snippet child({ props })}
								<a
									{...props}
									href={g.href}
									aria-current={currentGeneral?.href === g.href ? 'page' : undefined}
									class={cn(
										props.class as string,
										'relative',
										g.href.endsWith('/danger') && 'text-destructive'
									)}
								>
									{g.label}
									{#if currentGeneral?.href === g.href}<Check
											class="absolute right-2 !text-link"
										/>{/if}
								</a>
							{/snippet}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={tabActive(tab.href) ? 'page' : undefined}
				class={tabClass(tabActive(tab.href))}>{tab.label}</a
			>
		{/each}
	</nav>
	{@render children()}
</div>
