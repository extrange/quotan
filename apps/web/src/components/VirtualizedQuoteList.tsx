import { Center, Loader, Stack, Text } from "@mantine/core";
import type { Quote } from "@quotan/shared";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { QuoteCard } from "./QuoteCard";

interface VirtualizedQuoteListProps {
	items: Quote[];
	query?: string;
	onOpen: (quote: Quote) => void;
	onToggleStar: (quote: Quote) => void;
	starPendingId?: number | null;
	hasMore?: boolean;
	isFetchingNextPage?: boolean;
	onLoadMore?: () => void;
	scrollToEndSignal?: number;
	emptyState?: React.ReactNode;
	loading?: boolean;
}

export function VirtualizedQuoteList({
	items,
	query,
	onOpen,
	onToggleStar,
	starPendingId,
	hasMore,
	isFetchingNextPage,
	onLoadMore,
	scrollToEndSignal,
	emptyState,
	loading,
}: VirtualizedQuoteListProps) {
	const parentRef = useRef<HTMLDivElement>(null);
	const [scrollMargin, setScrollMargin] = useState(0);
	useLayoutEffect(() => {
		const element = parentRef.current;
		if (!element) return;
		setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
	});
	const virtualizer = useWindowVirtualizer({
		count: items.length,
		estimateSize: () => 172,
		overscan: 8,
		getItemKey: (index) => items[index]?.id ?? index,
		scrollMargin,
	});

	const lastVisible = virtualizer.getVirtualItems().at(-1)?.index ?? 0;
	useEffect(() => {
		if (!hasMore || isFetchingNextPage) return;
		if (lastVisible >= items.length - 4) onLoadMore?.();
	}, [hasMore, isFetchingNextPage, items.length, lastVisible, onLoadMore]);

	// The page loads every remaining cursor page in a burst and then bumps this
	// signal. Wait until the last page is rendered before scrolling so the
	// virtualizer's total size includes the complete list.
	const handledScrollToEndSignal = useRef(0);
	useEffect(() => {
		if (!scrollToEndSignal || scrollToEndSignal === handledScrollToEndSignal.current) return;
		if (hasMore || items.length === 0) return;
		handledScrollToEndSignal.current = scrollToEndSignal;
		virtualizer.scrollToEnd();
	}, [scrollToEndSignal, hasMore, items.length, virtualizer]);

	if (loading && items.length === 0) {
		return (
			<Center h={240}>
				<Loader />
			</Center>
		);
	}

	if (!loading && items.length === 0) {
		return <>{emptyState}</>;
	}

	return (
		<div ref={parentRef}>
			<div
				style={{
					height: virtualizer.getTotalSize(),
					width: "100%",
					position: "relative",
				}}
			>
				{virtualizer.getVirtualItems().map((virtualItem) => {
					const quote = items[virtualItem.index];
					if (!quote) return null;
					return (
						<div
							key={virtualItem.key}
							data-index={virtualItem.index}
							ref={virtualizer.measureElement}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${virtualItem.start - scrollMargin}px)`,
								paddingBottom: 10,
							}}
						>
							<QuoteCard
								quote={quote}
								query={query}
								onOpen={onOpen}
								onToggleStar={onToggleStar}
								starPending={starPendingId === quote.id}
							/>
						</div>
					);
				})}
			</div>
			<Stack align="center" py="md">
				{isFetchingNextPage && <Loader size="sm" />}
				{!hasMore && items.length > 0 && (
					<Text size="xs" c="dimmed">
						That’s the end of the list.
					</Text>
				)}
			</Stack>
		</div>
	);
}
