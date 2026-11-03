import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Card,
	Center,
	Group,
	Loader,
	Menu,
	Modal,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { ActiveQuoteStatus, Quote } from "@quotan/shared";
import {
	IconAlertTriangle,
	IconArchive,
	IconCheck,
	IconDotsVertical,
	IconInbox,
	IconLock,
	IconRestore,
	IconSearch,
	IconStar,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { formatDateTime, formatNumber } from "@/lib/format";

const SOURCE_LABELS: Record<string, string> = {
	quote: "Quote menu",
	duplicates: "Duplicates",
	bulk: "Bulk action",
	daily: "Daily send",
};

const FROM_META: Record<
	ActiveQuoteStatus,
	{ label: string; color: string; icon: typeof IconStar }
> = {
	starred: { label: "Starred", color: "yellow", icon: IconStar },
	inbox: { label: "Inbox", color: "gray", icon: IconInbox },
	private: { label: "Private", color: "grape", icon: IconLock },
};

export function DroppedPage() {
	const queryClient = useQueryClient();
	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, 300);
	const [deleting, setDeleting] = useState<Quote | null>(null);

	const droppedQuery = useInfiniteQuery({
		queryKey: ["dropped", debouncedQuery],
		queryFn: ({ pageParam, signal }) =>
			api.dropped({ q: debouncedQuery.trim() || undefined, cursor: pageParam, limit: 50 }, signal),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["dropped"] });
		void queryClient.invalidateQueries({ queryKey: ["quotes"] });
		void queryClient.invalidateQueries({ queryKey: ["search"] });
		void queryClient.invalidateQueries({ queryKey: ["quote"] });
		void queryClient.invalidateQueries({ queryKey: ["stats"] });
		void queryClient.invalidateQueries({ queryKey: ["daily"] });
		void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
	};

	const restoreMutation = useMutation({
		mutationFn: ({ id, status }: { id: number; status: ActiveQuoteStatus }) =>
			api.restoreDropped(id, status),
		onSuccess: (quote) => {
			invalidate();
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message: `Restored as ${quote.status === "starred" ? "Starred" : quote.status === "private" ? "Private" : "Inbox"}`,
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not restore quote",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => api.deleteDropped(id),
		onSuccess: () => {
			invalidate();
			setDeleting(null);
			notifications.show({ color: "teal", message: "Quote permanently deleted" });
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not delete quote",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const items = droppedQuery.data?.pages.flatMap((page) => page.items) ?? [];
	const total = droppedQuery.data?.pages[0]?.total ?? items.length;
	const restoringId = restoreMutation.isPending ? restoreMutation.variables?.id : null;

	return (
		<div className="page-container" style={{ maxWidth: 900 }}>
			<Group justify="space-between" align="flex-end" mb="md">
				<div>
					<Title order={2}>Dropped</Title>
					<Text size="sm" c="dimmed">
						Archived quotes are never sent and exact re-imports are skipped.
					</Text>
				</div>
				<Group gap={6}>
					<IconArchive size={16} className="muted" />
					<Text size="sm" c="dimmed">
						{formatNumber(total)} archived
					</Text>
				</Group>
			</Group>

			<TextInput
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
				placeholder="Search Dropped by text or author…"
				leftSection={<IconSearch size={17} />}
				rightSection={
					query ? (
						<ActionIcon
							variant="subtle"
							color="gray"
							onClick={() => setQuery("")}
							aria-label="Clear search"
						>
							<IconX size={15} />
						</ActionIcon>
					) : null
				}
				mb="md"
				aria-label="Search Dropped quotes"
			/>

			{droppedQuery.isLoading && (
				<Center h={240}>
					<Loader />
				</Center>
			)}
			{droppedQuery.isError && (
				<Alert color="red" mb="md">
					{droppedQuery.error instanceof ApiError
						? droppedQuery.error.message
						: "Could not load Dropped quotes"}
				</Alert>
			)}

			{!droppedQuery.isLoading && items.length === 0 && (
				<Card withBorder padding="xl">
					<Stack align="center" gap="sm">
						<IconArchive size={30} className="muted" />
						<Text fw={650}>
							{debouncedQuery ? "No archived quotes match" : "Nothing is dropped"}
						</Text>
						<Text size="sm" c="dimmed" ta="center">
							{debouncedQuery
								? "Try a different word or author."
								: "Quotes you drop, or the daily Inbox quote after sending, appear here."}
						</Text>
					</Stack>
				</Card>
			)}

			<Stack gap="sm">
				{items.map((quote) => {
					const from = quote.droppedFrom;
					const fromMeta = from ? FROM_META[from] : null;
					return (
						<Card key={quote.id} withBorder padding="md">
							<Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
								<Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
									<Text className="quote-text" lineClamp={4}>
										{quote.text}
									</Text>
									<Text size="sm" fw={600}>
										— {quote.author}
									</Text>
									<Group gap={6} wrap="wrap">
										{fromMeta && (
											<Badge
												size="xs"
												variant="light"
												color={fromMeta.color}
												leftSection={<fromMeta.icon size={10} />}
											>
												From {fromMeta.label}
											</Badge>
										)}
										<Badge size="xs" variant="light" color="orange">
											{SOURCE_LABELS[quote.dropSource ?? ""] ?? "Dropped"}
										</Badge>
										<Text size="xs" c="dimmed">
											{formatDateTime(quote.droppedAt)}
										</Text>
									</Group>
								</Stack>
								<Group gap={4} wrap="nowrap">
									<Menu position="bottom-end" shadow="md" width={190}>
										<Menu.Target>
											<Tooltip label="Restore">
												<ActionIcon
													variant="light"
													color="teal"
													aria-label={`Restore ${quote.id}`}
													loading={restoringId === quote.id}
												>
													<IconRestore size={17} />
												</ActionIcon>
											</Tooltip>
										</Menu.Target>
										<Menu.Dropdown>
											<Menu.Label>Restore as</Menu.Label>
											<Menu.Item
												leftSection={<IconStar size={15} />}
												onClick={() => restoreMutation.mutate({ id: quote.id, status: "starred" })}
											>
												Starred
											</Menu.Item>
											<Menu.Item
												leftSection={<IconInbox size={15} />}
												onClick={() => restoreMutation.mutate({ id: quote.id, status: "inbox" })}
											>
												Inbox
											</Menu.Item>
											<Menu.Item
												leftSection={<IconLock size={15} />}
												onClick={() => restoreMutation.mutate({ id: quote.id, status: "private" })}
											>
												Private
											</Menu.Item>
										</Menu.Dropdown>
									</Menu>
									<Tooltip label="Delete permanently">
										<ActionIcon
											variant="light"
											color="red"
											aria-label={`Delete ${quote.id} permanently`}
											onClick={() => setDeleting(quote)}
										>
											<IconTrash size={17} />
										</ActionIcon>
									</Tooltip>
									<Menu position="bottom-end" shadow="md" width={190}>
										<Menu.Target>
											<ActionIcon variant="subtle" color="gray" aria-label="More actions">
												<IconDotsVertical size={17} />
											</ActionIcon>
										</Menu.Target>
										<Menu.Dropdown>
											<Menu.Item
												leftSection={<IconRestore size={15} />}
												onClick={() => restoreMutation.mutate({ id: quote.id, status: "inbox" })}
											>
												Restore to Inbox
											</Menu.Item>
											<Menu.Item
												color="red"
												leftSection={<IconTrash size={15} />}
												onClick={() => setDeleting(quote)}
											>
												Delete permanently
											</Menu.Item>
										</Menu.Dropdown>
									</Menu>
								</Group>
							</Group>
						</Card>
					);
				})}
			</Stack>

			{droppedQuery.hasNextPage && (
				<Group justify="center" mt="md">
					<Button
						variant="light"
						loading={droppedQuery.isFetchingNextPage}
						onClick={() => void droppedQuery.fetchNextPage()}
					>
						Load more
					</Button>
				</Group>
			)}

			<Modal
				opened={deleting !== null}
				onClose={() => setDeleting(null)}
				title="Delete permanently?"
				centered
			>
				<Stack gap="sm">
					<Alert color="red" icon={<IconAlertTriangle size={17} />}>
						This removes the quote for good. An identical quote could then be imported again.
					</Alert>
					{deleting && (
						<Text size="sm" className="quote-text" lineClamp={3}>
							{deleting.text}
						</Text>
					)}
					<Group justify="flex-end">
						<Button variant="default" onClick={() => setDeleting(null)}>
							Cancel
						</Button>
						<Button
							color="red"
							leftSection={<IconTrash size={16} />}
							loading={deleteMutation.isPending}
							onClick={() => deleting && deleteMutation.mutate(deleting.id)}
						>
							Delete permanently
						</Button>
					</Group>
				</Stack>
			</Modal>
		</div>
	);
}
