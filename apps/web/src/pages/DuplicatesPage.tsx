import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Card,
	Center,
	Group,
	Loader,
	Modal,
	Paper,
	SegmentedControl,
	Select,
	Stack,
	Text,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { DuplicateCategory, DuplicateGroup, DuplicateScanResponse } from "@quotan/shared";
import {
	IconAlertTriangle,
	IconCheck,
	IconEdit,
	IconEye,
	IconEyeOff,
	IconPlus,
	IconRefresh,
	IconSparkles,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useIsMobile } from "@/hooks/useMedia";
import { DUPLICATE_CATEGORY_COLORS, DUPLICATE_CATEGORY_LABELS } from "@/lib/duplicateLabels";
import { formatDate, formatNumber } from "@/lib/format";

type GroupFilter = "all" | DuplicateCategory | "ignored";

export function DuplicatesPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const [filter, setFilter] = useState<GroupFilter>("all");
	const [deleteOpened, deleteModal] = useDisclosure(false);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

	const scanQuery = useQuery({
		queryKey: ["duplicates", "scan"],
		queryFn: ({ signal }) => api.scanDuplicates({ limit: 100 }, signal),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});

	useEffect(() => {
		if (!scanQuery.data) return;
		const available = new Set(
			scanQuery.data.groups.flatMap((group) => group.quotes.map((quote) => quote.id)),
		);
		setSelectedIds((current) => {
			const next = new Set([...current].filter((id) => available.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [scanQuery.data]);

	const groups = scanQuery.data?.groups ?? [];
	const activeGroups = useMemo(() => groups.filter((group) => !group.ignored), [groups]);
	const ignoredGroups = useMemo(() => groups.filter((group) => group.ignored), [groups]);
	const counts = useMemo(() => {
		const next: Record<DuplicateCategory, number> = {
			exact: 0,
			same_text: 0,
			likely: 0,
			similar: 0,
		};
		for (const group of activeGroups) next[group.category] += 1;
		return next;
	}, [activeGroups]);

	const filtered =
		filter === "all"
			? activeGroups
			: filter === "ignored"
				? ignoredGroups
				: activeGroups.filter((group) => group.category === filter);
	const totalQuotes = scanQuery.data?.totalQuotes ?? 0;

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
		void queryClient.invalidateQueries({ queryKey: ["quotes"] });
		void queryClient.invalidateQueries({ queryKey: ["search"] });
		void queryClient.invalidateQueries({ queryKey: ["quote"] });
		void queryClient.invalidateQueries({ queryKey: ["daily"] });
		void queryClient.invalidateQueries({ queryKey: ["stats"] });
		void queryClient.invalidateQueries({ queryKey: ["dropped"] });
	};

	const deleteMutation = useMutation({
		mutationFn: (ids: number[]) => api.deleteQuotes(ids, "duplicates"),
		onSuccess: (result) => {
			notifications.show({
				color: "teal",
				message: `${formatNumber(result.archived)} ${result.archived === 1 ? "quote" : "quotes"} moved to Dropped`,
			});
			deleteModal.close();
			setSelectedIds(new Set());
			invalidate();
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not archive quotes",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const toggleQuote = (id: number) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const clearGroup = (group: DuplicateGroup) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const quote of group.quotes) next.delete(quote.id);
			return next;
		});
	};

	const ignoreMutation = useMutation({
		mutationFn: ({ key, ignored }: { key: string; ignored: boolean }) =>
			api.ignoreDuplicateGroup(key, ignored),
		onSuccess: (result) => {
			queryClient.setQueryData<DuplicateScanResponse>(["duplicates", "scan"], (current) =>
				current
					? {
							...current,
							groups: current.groups.map((group) =>
								group.key === result.key ? { ...group, ignored: result.ignored } : group,
							),
						}
					: current,
			);
			notifications.show({
				color: "gray",
				message: result.ignored ? "Duplicate group ignored" : "Duplicate group unignored",
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not update duplicate group",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const editQuote = (id: number) => {
		navigate(`/add?edit=${id}`);
	};

	return (
		<div className="page-container">
			<Box className="duplicates-header" mb="md" data-testid="duplicates-header">
				<Group justify="space-between" align="flex-end">
					<div>
						<Title order={2} lh={1.1}>
							Duplicates
						</Title>
						<Group gap={6} mt={4}>
							<Text size="sm" c="dimmed">
								{formatNumber(activeGroups.length)} active{" "}
								{activeGroups.length === 1 ? "group" : "groups"} ·{" "}
								{formatNumber(ignoredGroups.length)} ignored ·{" "}
								{formatNumber(scanQuery.data?.scanned ?? 0)} quotes scanned
							</Text>
							{scanQuery.isFetching && <Loader size={12} />}
							{scanQuery.data && (
								<Badge
									size="xs"
									variant="light"
									color={scanQuery.data.embeddingUsed ? "grape" : "gray"}
									leftSection={<IconSparkles size={10} />}
								>
									{scanQuery.data.embeddingUsed ? "semantic + text" : "text only"}
								</Badge>
							)}
						</Group>
					</div>
					<Group gap="xs">
						{groups.length > 0 && (
							<Button
								size="xs"
								color="red"
								variant="light"
								leftSection={<IconTrash size={15} />}
								disabled={selectedIds.size === 0 || scanQuery.isFetching}
								onClick={deleteModal.open}
							>
								Archive selected
								{selectedIds.size > 0 ? ` (${formatNumber(selectedIds.size)})` : ""}
							</Button>
						)}
						<Button
							size="xs"
							variant="light"
							leftSection={<IconRefresh size={15} />}
							loading={scanQuery.isFetching}
							onClick={() => void scanQuery.refetch()}
						>
							Rescan
						</Button>
					</Group>
				</Group>
			</Box>

			{scanQuery.isLoading && (
				<Center h={240}>
					<Loader />
				</Center>
			)}

			{scanQuery.isError && (
				<Alert color="red" variant="light" mb="sm">
					{scanQuery.error instanceof ApiError
						? scanQuery.error.message
						: "Could not scan for duplicates"}
				</Alert>
			)}

			{scanQuery.data?.warning && (
				<Alert color="yellow" variant="light" mb="sm" icon={<IconAlertTriangle size={16} />}>
					{scanQuery.data.warning}
				</Alert>
			)}

			{!scanQuery.isLoading && !scanQuery.isError && groups.length === 0 && (
				<Card withBorder padding="xl" mt="md">
					<Stack align="center" gap="sm">
						<IconCheck size={32} color="var(--mantine-color-teal-6)" />
						<Text fw={650}>No duplicates found</Text>
						<Text size="sm" c="dimmed" ta="center">
							{totalQuotes === 0
								? "Add some quotes first, then come back to scan the library."
								: "Every quote looks distinct right now. Rescan after adding or importing more."}
						</Text>
						{totalQuotes === 0 && (
							<Button leftSection={<IconPlus size={16} />} onClick={() => navigate("/add")}>
								Add a quote
							</Button>
						)}
					</Stack>
				</Card>
			)}

			{groups.length > 0 && (
				<>
					{isMobile ? (
						<Select
							value={filter}
							onChange={(value) => setFilter((value as GroupFilter) ?? "all")}
							data={filterData(counts, ignoredGroups.length)}
							allowDeselect={false}
							aria-label="Filter duplicate groups"
							mb="md"
							size="xs"
						/>
					) : (
						<SegmentedControl
							value={filter}
							onChange={(value) => setFilter(value as GroupFilter)}
							mb="md"
							size="xs"
							data={filterData(counts, ignoredGroups.length)}
						/>
					)}

					<Text size="xs" c="dimmed" mb="sm">
						No quotes are selected. Click quotes to mark them, then choose Archive selected.
					</Text>

					{filtered.length === 0 ? (
						<Card withBorder padding="lg">
							<Text size="sm" c="dimmed">
								No{" "}
								{filter === "ignored"
									? "ignored"
									: filter === "all"
										? "active"
										: DUPLICATE_CATEGORY_LABELS[filter].toLowerCase()}{" "}
								duplicate groups.
							</Text>
						</Card>
					) : (
						<Stack gap="sm">
							{filtered.map((group) => (
								<DuplicateGroupCard
									key={group.key}
									group={group}
									selectedIds={selectedIds}
									onToggle={toggleQuote}
									onClear={() => clearGroup(group)}
									onIgnore={(ignored) => {
										if (ignored) clearGroup(group);
										ignoreMutation.mutate({ key: group.key, ignored });
									}}
									ignoring={ignoreMutation.isPending && ignoreMutation.variables?.key === group.key}
									onEdit={editQuote}
								/>
							))}
						</Stack>
					)}
				</>
			)}

			<Modal
				opened={deleteOpened}
				onClose={deleteModal.close}
				title="Archive selected quotes?"
				centered
			>
				<Stack gap="md">
					<Text size="sm">
						This moves {formatNumber(selectedIds.size)}{" "}
						{selectedIds.size === 1 ? "quote" : "quotes"} to Dropped. They stop being sent daily and
						exact re-imports are skipped.
					</Text>
					<Text size="xs" c="dimmed">
						You can restore them later from the Dropped archive.
					</Text>
					<Group justify="flex-end">
						<Button variant="default" onClick={deleteModal.close}>
							Cancel
						</Button>
						<Button
							color="red"
							leftSection={<IconTrash size={16} />}
							loading={deleteMutation.isPending}
							onClick={() => deleteMutation.mutate([...selectedIds])}
						>
							Archive {formatNumber(selectedIds.size)} {selectedIds.size === 1 ? "quote" : "quotes"}
						</Button>
					</Group>
				</Stack>
			</Modal>
		</div>
	);
}

function filterData(counts: Record<DuplicateCategory, number>, ignoredCount: number) {
	return [
		{
			label: `All ${counts.exact + counts.same_text + counts.likely + counts.similar}`,
			value: "all",
		},
		{ label: `Exact ${counts.exact}`, value: "exact" },
		{ label: `Different author ${counts.same_text}`, value: "same_text" },
		{ label: `Likely ${counts.likely}`, value: "likely" },
		{ label: `Similar ${counts.similar}`, value: "similar" },
		{ label: `Ignored ${ignoredCount}`, value: "ignored" },
	];
}

function DuplicateGroupCard({
	group,
	selectedIds,
	onToggle,
	onClear,
	onIgnore,
	ignoring,
	onEdit,
}: {
	group: DuplicateGroup;
	selectedIds: Set<number>;
	onToggle: (id: number) => void;
	onClear: () => void;
	onIgnore: (ignored: boolean) => void;
	ignoring: boolean;
	onEdit: (id: number) => void;
}) {
	const selectedCount = group.quotes.filter((quote) => selectedIds.has(quote.id)).length;
	return (
		<Card
			withBorder
			padding="md"
			component="section"
			aria-label={`${DUPLICATE_CATEGORY_LABELS[group.category]} duplicate group`}
		>
			<Group justify="space-between" gap="xs" wrap="wrap">
				<Group gap={6}>
					<Badge size="sm" color={DUPLICATE_CATEGORY_COLORS[group.category]} variant="light">
						{DUPLICATE_CATEGORY_LABELS[group.category]}
					</Badge>
					<Text size="xs" c="dimmed">
						{group.quotes.length} {group.quotes.length === 1 ? "quote" : "quotes"}
					</Text>
					{group.ignored && (
						<Badge size="sm" color="gray" variant="light">
							Ignored
						</Badge>
					)}
				</Group>
				<Group gap={4}>
					<Button
						size="compact-xs"
						variant="subtle"
						color="gray"
						disabled={selectedCount === 0}
						onClick={onClear}
					>
						Clear
					</Button>
					<Button
						size="compact-xs"
						variant="subtle"
						color={group.ignored ? "teal" : "gray"}
						leftSection={group.ignored ? <IconEye size={13} /> : <IconEyeOff size={13} />}
						loading={ignoring}
						onClick={() => onIgnore(!group.ignored)}
					>
						{group.ignored ? "Unignore" : "Ignore"}
					</Button>
				</Group>
			</Group>

			<Group gap={8} mt={4}>
				{group.similarity !== null && (
					<Text size="xs" c="dimmed">
						{Math.round(group.similarity * 100)}% semantic
					</Text>
				)}
				{group.category !== "exact" && group.category !== "same_text" && (
					<Text size="xs" c="dimmed">
						{Math.round(group.trigram * 100)}% text
					</Text>
				)}
			</Group>

			<Stack gap="xs" mt="sm">
				{group.quotes.map((quote) => {
					const selected = selectedIds.has(quote.id);
					return (
						<Paper
							key={quote.id}
							withBorder
							p="sm"
							data-quote-id={quote.id}
							data-selected={selected}
							style={{
								borderColor: selected ? "var(--mantine-color-red-5)" : undefined,
								boxShadow: selected ? "0 0 0 1px var(--mantine-color-red-5)" : undefined,
							}}
						>
							<Group align="flex-start" gap="sm" wrap="nowrap">
								<UnstyledButton
									onClick={() => onToggle(quote.id)}
									aria-pressed={selected}
									aria-label={`Mark quote ${quote.id} by ${quote.author} for archiving`}
									style={{ flex: 1, minWidth: 0, textAlign: "left" }}
								>
									<DuplicateQuoteText key={quote.text} text={quote.text} />
									<Group justify="space-between" mt={6} gap="xs">
										<Text size="xs" fw={600} lineClamp={1}>
											{quote.author}
										</Text>
										<Text size="xs" c="dimmed">
											Added {formatDate(quote.createdAt)}
										</Text>
									</Group>
								</UnstyledButton>
								<Tooltip label="Edit quote">
									<ActionIcon
										variant="subtle"
										color="gray"
										size="lg"
										aria-label={`Edit quote ${quote.id}`}
										onClick={() => onEdit(quote.id)}
									>
										<IconEdit size={17} />
									</ActionIcon>
								</Tooltip>
							</Group>
						</Paper>
					);
				})}
			</Stack>
		</Card>
	);
}

function DuplicateQuoteText({ text }: { text: string }) {
	const ref = useRef<HTMLParagraphElement>(null);
	const [truncated, setTruncated] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setTruncated(element.scrollHeight > element.clientHeight + 1);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<Text
			ref={ref}
			size="sm"
			className="quote-text"
			lineClamp={3}
			title={truncated ? text : undefined}
		>
			{text}
		</Text>
	);
}
