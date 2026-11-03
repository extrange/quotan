import {
	Alert,
	Badge,
	Card,
	Center,
	Group,
	Loader,
	Paper,
	SegmentedControl,
	Select,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import type { Delivery } from "@quotan/shared";
import { IconSend, IconStarFilled } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/api/client";
import { formatDateTime } from "@/lib/format";

type StarFilter = "all" | "starred" | "unstarred";

type Row =
	| { kind: "header"; key: string; date: string }
	| { kind: "delivery"; key: string; delivery: Delivery };

export function SentPage() {
	const [channel, setChannel] = useState<string | null>(null);
	const [starred, setStarred] = useState<StarFilter>("all");
	const parentRef = useRef<HTMLDivElement>(null);

	const deliveriesQuery = useInfiniteQuery({
		queryKey: ["deliveries", channel, starred],
		queryFn: ({ pageParam }) =>
			api.deliveries({
				cursor: pageParam,
				limit: 50,
				channel: channel ?? undefined,
				starred: starred === "all" ? undefined : starred === "starred",
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});

	const rows = useMemo<Row[]>(() => {
		const deliveries = deliveriesQuery.data?.pages.flatMap((page) => page.items) ?? [];
		const result: Row[] = [];
		let lastDate: string | null = null;
		for (const delivery of deliveries) {
			if (delivery.date !== lastDate) {
				lastDate = delivery.date;
				result.push({ kind: "header", key: `header-${delivery.date}`, date: delivery.date });
			}
			result.push({ kind: "delivery", key: `delivery-${delivery.id}`, delivery });
		}
		return result;
	}, [deliveriesQuery.data]);

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (index) => (rows[index]?.kind === "header" ? 44 : 132),
		overscan: 6,
		getItemKey: (index) => rows[index]?.key ?? index,
	});

	const lastVisible = virtualizer.getVirtualItems().at(-1)?.index ?? 0;
	useEffect(() => {
		if (!deliveriesQuery.hasNextPage || deliveriesQuery.isFetchingNextPage) return;
		if (lastVisible >= rows.length - 4) void deliveriesQuery.fetchNextPage();
	}, [deliveriesQuery, lastVisible, rows.length]);

	if (deliveriesQuery.isLoading) {
		return (
			<Center h="60dvh">
				<Loader />
			</Center>
		);
	}

	return (
		<div className="page-container" style={{ maxWidth: 840 }}>
			<Group justify="space-between" align="flex-end" mb="md">
				<div>
					<Title order={2}>Sent</Title>
					<Text size="sm" c="dimmed">
						Daily pairs sent by Quotan or recorded from the Today screen.
					</Text>
				</div>
			</Group>

			<Group gap="xs" mb="md" wrap="wrap">
				<SegmentedControl
					size="xs"
					value={starred}
					onChange={(value) => setStarred(value as StarFilter)}
					data={[
						{ label: "All", value: "all" },
						{ label: "Starred", value: "starred" },
						{ label: "Inbox", value: "unstarred" },
					]}
				/>
				<Select
					size="xs"
					clearable
					placeholder="Any channel"
					value={channel}
					onChange={setChannel}
					data={[
						{ value: "api", label: "API" },
						{ value: "telegram", label: "Telegram" },
						{ value: "manual", label: "Manual" },
					]}
					w={160}
				/>
			</Group>

			{deliveriesQuery.error && (
				<Alert color="red" mb="md">
					{deliveriesQuery.error instanceof ApiError
						? deliveriesQuery.error.message
						: "Could not load delivery history"}
				</Alert>
			)}

			{rows.length === 0 ? (
				<Card withBorder padding="xl">
					<Stack align="center" gap="xs">
						<IconSend size={30} className="muted" />
						<Text fw={650}>Nothing has been sent yet</Text>
						<Text size="sm" c="dimmed" ta="center">
							Telegram sends and manual records will appear here, newest first.
						</Text>
					</Stack>
				</Card>
			) : (
				<div
					ref={parentRef}
					style={{
						height: "calc(100dvh - 260px)",
						minHeight: 320,
						overflowY: "auto",
						overscrollBehavior: "contain",
					}}
				>
					<div
						style={{
							height: virtualizer.getTotalSize(),
							position: "relative",
							width: "100%",
						}}
					>
						{virtualizer.getVirtualItems().map((virtualItem) => {
							const row = rows[virtualItem.index];
							if (!row) return null;
							return (
								<div
									key={virtualItem.key}
									ref={virtualizer.measureElement}
									data-index={virtualItem.index}
									style={{
										position: "absolute",
										top: 0,
										left: 0,
										width: "100%",
										transform: `translateY(${virtualItem.start}px)`,
									}}
								>
									{row.kind === "header" ? (
										<Text size="xs" fw={700} c="dimmed" py="xs" tt="uppercase">
											{row.date}
										</Text>
									) : (
										<DeliveryCard delivery={row.delivery} />
									)}
								</div>
							);
						})}
					</div>
					<Group justify="center" py="md">
						{deliveriesQuery.isFetchingNextPage && <Loader size="sm" />}
						{!deliveriesQuery.hasNextPage && rows.length > 0 && (
							<Text size="xs" c="dimmed">
								End of delivery history.
							</Text>
						)}
					</Group>
				</div>
			)}
		</div>
	);
}

function DeliveryCard({ delivery }: { delivery: Delivery }) {
	return (
		<Paper withBorder p="md" mb="xs">
			<Group justify="space-between" align="flex-start" mb={6} wrap="nowrap">
				<Group gap={6}>
					{delivery.starred ? (
						<Badge
							size="xs"
							color="yellow"
							variant="light"
							leftSection={<IconStarFilled size={10} />}
						>
							Starred
						</Badge>
					) : (
						<Badge size="xs" color="gray" variant="light">
							Inbox
						</Badge>
					)}
					<Badge size="xs" color="blue" variant="light">
						{delivery.channel}
					</Badge>
				</Group>
				<Text size="xs" c="dimmed">
					{formatDateTime(delivery.sentAt)}
				</Text>
			</Group>
			<Text className="quote-text" lineClamp={4}>
				{delivery.quoteText}
			</Text>
			<Text size="sm" fw={600} mt={6}>
				— {delivery.quoteAuthor}
			</Text>
		</Paper>
	);
}
