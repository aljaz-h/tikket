<script lang="ts">
	import {
		MILESTONE_STATUS_META,
		RELEASE_STATUS_META,
		type MilestoneStatus,
		type ReleaseStatus
	} from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	let {
		status,
		kind,
		class: className
	}: { status: string; kind: 'release' | 'milestone'; class?: string } = $props();
	const meta = $derived(
		kind === 'release'
			? RELEASE_STATUS_META[status as ReleaseStatus]
			: MILESTONE_STATUS_META[status as MilestoneStatus]
	);
</script>

<span
	class={cn(
		'tone inline-flex h-5.5 items-center rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
		meta?.tone,
		className
	)}>{meta?.label ?? status}</span
>
