import Bug from '@lucide/svelte/icons/bug';
import Circle from '@lucide/svelte/icons/circle';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import CircleDashed from '@lucide/svelte/icons/circle-dashed';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import CirclePause from '@lucide/svelte/icons/circle-pause';
import CircleX from '@lucide/svelte/icons/circle-x';
import Copy from '@lucide/svelte/icons/copy';
import MessageSquareText from '@lucide/svelte/icons/message-square-text';
import Sparkles from '@lucide/svelte/icons/sparkles';
import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
import SignalHigh from '@lucide/svelte/icons/signal-high';
import SignalMedium from '@lucide/svelte/icons/signal-medium';
import SignalLow from '@lucide/svelte/icons/signal-low';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import type { TicketPriority, TicketStatus, TicketType } from '$lib/shared/constants';

export const STATUS_ICONS: Record<TicketStatus, typeof Circle> = {
	open: Circle,
	planned: CircleDashed,
	in_progress: CircleDot,
	completed: CircleCheck,
	on_hold: CirclePause,
	declined: CircleX,
	duplicate: Copy
};

export const TYPE_ICONS: Record<TicketType, typeof Circle> = {
	bug: Bug,
	feature: Sparkles,
	improvement: WandSparkles,
	feedback: MessageSquareText
};

export const PRIORITY_ICONS: Record<TicketPriority, typeof Circle> = {
	low: SignalLow,
	medium: SignalMedium,
	high: SignalHigh,
	critical: TriangleAlert
};

export const TYPE_TONES: Record<TicketType, string> = {
	bug: 'tone-bug',
	feature: 'tone-feature',
	improvement: 'tone-improvement',
	feedback: 'tone-feedback'
};
