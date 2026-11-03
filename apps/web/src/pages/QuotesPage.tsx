import {
	ActionIcon,
	Affix,
	Alert,
	Badge,
	Box,
	Button,
	Card,
	Group,
	Loader,
	SegmentedControl,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { Quote } from "@quotan/shared";
import {
	IconAlertTriangle,
	IconArchive,
	IconChevronsDown,
	IconPlus,
	IconSearch,
	IconSparkles,
	IconX,
} from "@tabler/icons-react";
import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { QuoteDetailDrawer } from "@/components/QuoteDetailDrawer";
import { VirtualizedQuoteList } from "@/components/VirtualizedQuoteList";
import { useIsMobile } from "@/hooks/useMedia";
import { formatNumber } from "@/lib/format";

type StatusFilter = "all" | "starred" | "inbox" | "private";
type SentFilter = "all" | "sent" | "never";
type Sort = "newest" | "oldest" | "author" | "last_sent";

export function QuotesPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, 300);
	const [author, setAuthor] = useState("");
	const [debouncedAuthor] = useDebouncedValue(author, 300);
	const [status, setStatus] = useState<StatusFilter>("all");
	const [sent, setSent] = useState<SentFilter>("all");
	const [sort, setSort] = useState<Sort>("newest");
	const [detail, setDetail] = useState<number | null>(null);
	const [detailOpened, detailHandlers] = useDisclosure(false);

	const filters = useMemo(
		() => ({
			status: status === "all" ? undefined : status,
			sent: sent === "all" ? undefined : sent === "sent",
			author: debouncedAuthor.trim() || undefined,
		}),
		[status, sent, debouncedAuthor],
	);
	const searchEnabled = debouncedQuery.trim().length >= 2;

	const searchQuery = useQuery({
		queryKey: ["search", debouncedQuery, filters],
		queryFn: ({ signal }) =>
			api.search(
				{
					q: debouncedQuery.trim(),
					...filters,
					limit: 100,
				},
				signal,
			),
		enabled: searchEnabled,
		placeholderData: keepPreviousData,
	});

	const browseQuery = useInfiniteQuery({
		queryKey: ["quotes", filters, sort],
		queryFn: ({ pageParam, signal }) =>
			api.listQuotes(
				{
					...filters,
					sort,
					cursor: pageParam,
					limit: 50,
				},
				signal,
			),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: !searchEnabled,
	});

	const [loadingToEnd, setLoadingToEnd] = useState(false);
	const [scrollToEndSignal, setScrollToEndSignal] = useState(0);
	const jumpInFlight = useRef(false);
	const listKey = JSON.stringify([filters, sort, searchEnabled]);
	const activeListKey = useRef(listKey);
	useEffect(() => {
		activeListKey.current = listKey;
	}, [listKey]);

	// Cursor pagination cannot seek, so a jump has to walk the remaining pages.
	// Do it back-to-back (instead of waiting for scroll events), then let the
	// virtualizer scroll to the end once every page is rendered.
	const jumpToEnd = async () => {
		if (jumpInFlight.current || searchEnabled) return;
		const requestedList = activeListKey.current;
		jumpInFlight.current = true;
		setLoadingToEnd(true);
		try {
			let hasMore = browseQuery.hasNextPage;
			while (hasMore) {
				const result = await browseQuery.fetchNextPage();
				if (activeListKey.current !== requestedList) return;
				if (result.isError) {
					throw result.error ?? new Error("Could not load the rest of the list");
				}
				hasMore = Boolean(result.hasNextPage);
			}
			setScrollToEndSignal((signal) => signal + 1);
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Could not load the rest of the list",
				message: error instanceof ApiError ? error.message : "Unknown error",
			});
		} finally {
			jumpInFlight.current = false;
			setLoadingToEnd(false);
		}
	};

	const starMutation = useMutation({
		mutationFn: ({ id, status: nextStatus }: { id: number; status: "starred" | "inbox" }) =>
			api.updateQuote(id, { status: nextStatus }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["quotes"] });
			void queryClient.invalidateQueries({ queryKey: ["search"] });
			void queryClient.invalidateQueries({ queryKey: ["quote"] });
			void queryClient.invalidateQueries({ queryKey: ["daily"] });
			void queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not update star",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const items: Quote[] = searchEnabled
		? (searchQuery.data?.items ?? [])
		: (browseQuery.data?.pages.flatMap((page) => page.items) ?? []);
	const total = searchEnabled
		? (searchQuery.data?.total ?? 0)
		: (browseQuery.data?.pages[0]?.total ?? 0);
	const loading = searchEnabled ? searchQuery.isLoading : browseQuery.isLoading;
	const fetching = searchEnabled ? searchQuery.isFetching : browseQuery.isFetching;
	const error = searchEnabled ? searchQuery.error : browseQuery.error;
	const warning = searchEnabled ? searchQuery.data?.warning : undefined;

	const clearFilters = () => {
		setStatus("all");
		setSent("all");
		setAuthor("");
		setQuery("");
	};

	const openQuote = (quote: Quote) => {
		setDetail(quote.id);
		detailHandlers.open();
	};

	const emptyState = (
		<Card withBorder padding="xl" mt="md">
			<Stack align="center" gap="sm">
				<IconSearch size={30} className="muted" />
				<Text fw={650}>
					{searchEnabled
						? "No quotes match that search"
						: query || status !== "all" || sent !== "all" || author
							? "No quotes match these filters"
							: "Your library is empty"}
				</Text>
				<Text size="sm" c="dimmed" ta="center">
					{searchEnabled
						? "Try fewer words or a different filter."
						: "Add your first quote, or import an existing list."}
				</Text>
				<Group>
					<Button leftSection={<IconPlus size={16} />} onClick={() => navigate("/add")}>
						Add quote
					</Button>
					<Button variant="light" onClick={() => navigate("/import-export")}>
						Import a list
					</Button>
				</Group>
			</Stack>
		</Card>
	);

	const titleBar = (
		<Group justify="space-between" align="flex-end" mb="md">
			<div>
				<Title order={2} lh={1.1}>
					Quotes
				</Title>
				<Group gap={6} mt={4}>
					<Text size="sm" c="dimmed">
						{formatNumber(total)} {total === 1 ? "quote" : "quotes"}
					</Text>
					{fetching && <Loader size={12} />}
					{searchEnabled && searchQuery.data?.mode === "hybrid" && (
						<Badge size="xs" variant="light" color="grape" leftSection={<IconSparkles size={10} />}>
							Hybrid
						</Badge>
					)}
				</Group>
			</div>
			{!isMobile && (
				<Group gap="xs">
					<Button
						variant="subtle"
						color="gray"
						leftSection={<IconArchive size={16} />}
						onClick={() => navigate("/dropped")}
					>
						Dropped
					</Button>
					<Button leftSection={<IconPlus size={16} />} onClick={() => navigate("/add")}>
						Add quote
					</Button>
				</Group>
			)}
		</Group>
	);

	return (
		<div className="page-container">
			{isMobile && titleBar}
			<Box className="quotes-toolbar">
				{!isMobile && titleBar}

				<Stack gap="sm">
					<TextInput
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Search by words, meaning, or author…"
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
						size="md"
						aria-label="Search quotes"
					/>
					<Group gap="xs" align="flex-end" wrap="wrap">
						<SegmentedControl
							size="xs"
							value={status}
							onChange={(value) => setStatus(value as StatusFilter)}
							data={[
								{ label: "All", value: "all" },
								{ label: "Starred", value: "starred" },
								{ label: "Inbox", value: "inbox" },
								{ label: "Private", value: "private" },
							]}
						/>
						<SegmentedControl
							size="xs"
							value={sent}
							onChange={(value) => setSent(value as SentFilter)}
							data={[
								{ label: "Any", value: "all" },
								{ label: "Sent", value: "sent" },
								{ label: "Never sent", value: "never" },
							]}
						/>
						<TextInput
							size="xs"
							value={author}
							onChange={(event) => setAuthor(event.currentTarget.value)}
							placeholder="Filter author"
							w={150}
						/>
						{!searchEnabled && (
							<Select
								size="xs"
								value={sort}
								onChange={(value) => setSort((value as Sort) ?? "newest")}
								data={[
									{ value: "newest", label: "Newest" },
									{ value: "oldest", label: "Oldest" },
									{ label: "Author", value: "author" },
									{ label: "Last sent", value: "last_sent" },
								]}
								allowDeselect={false}
								w={130}
							/>
						)}
						{(query || author || status !== "all" || sent !== "all") && (
							<Button size="xs" variant="subtle" color="gray" onClick={clearFilters}>
								Clear
							</Button>
						)}
					</Group>
				</Stack>
			</Box>

			{warning && (
				<Alert color="yellow" variant="light" mb="sm" icon={<IconAlertTriangle size={16} />}>
					{warning}
				</Alert>
			)}
			{error && (
				<Alert color="red" variant="light" mb="sm">
					{error instanceof ApiError ? error.message : "Could not load quotes"}
				</Alert>
			)}

			<VirtualizedQuoteList
				items={items}
				query={searchEnabled ? debouncedQuery : undefined}
				onOpen={openQuote}
				onToggleStar={(quote) =>
					starMutation.mutate({
						id: quote.id,
						status: quote.status === "starred" ? "inbox" : "starred",
					})
				}
				starPendingId={starMutation.isPending ? (starMutation.variables?.id ?? null) : null}
				hasMore={!searchEnabled && Boolean(browseQuery.hasNextPage)}
				isFetchingNextPage={browseQuery.isFetchingNextPage}
				onLoadMore={() => {
					if (!searchEnabled && !jumpInFlight.current) void browseQuery.fetchNextPage();
				}}
				scrollToEndSignal={scrollToEndSignal}
				emptyState={emptyState}
				loading={loading}
			/>

			{!searchEnabled && (browseQuery.hasNextPage || loadingToEnd) && (
				<Affix position={{ bottom: isMobile ? 84 : 24, right: isMobile ? 16 : 24 }} zIndex={110}>
					<Button
						size="sm"
						radius="xl"
						variant="light"
						style={{ boxShadow: "var(--mantine-shadow-md)" }}
						leftSection={<IconChevronsDown size={16} />}
						onClick={() => void jumpToEnd()}
						loading={loadingToEnd}
						disabled={browseQuery.isFetchingNextPage}
						title="Load the remaining quotes and jump to the last one"
					>
						{loadingToEnd
							? `Loading ${formatNumber(items.length)} / ${formatNumber(total)}`
							: "Jump to end"}
					</Button>
				</Affix>
			)}

			<QuoteDetailDrawer
				quoteId={detail}
				opened={detailOpened}
				onClose={() => {
					detailHandlers.close();
					setDetail(null);
				}}
				onEdit={(id) => {
					detailHandlers.close();
					navigate(`/add?edit=${id}`);
				}}
				onOpenQuote={(id) => setDetail(id)}
			/>
		</div>
	);
}
