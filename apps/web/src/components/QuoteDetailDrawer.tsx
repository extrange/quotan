import {
	ActionIcon,
	Badge,
	Button,
	Divider,
	Drawer,
	Group,
	Loader,
	Modal,
	Paper,
	ScrollArea,
	SegmentedControl,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ActiveQuoteStatus } from "@quotan/shared";
import {
	IconArchive,
	IconCalendar,
	IconEdit,
	IconSend,
	IconSparkles,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { useIsMobile } from "@/hooks/useMedia";
import { DUPLICATE_CATEGORY_COLORS, DUPLICATE_CATEGORY_LABELS } from "@/lib/duplicateLabels";
import { formatDateTime, relativeTime } from "@/lib/format";

interface QuoteDetailDrawerProps {
	quoteId: number | null;
	opened: boolean;
	onClose: () => void;
	onEdit: (id: number) => void;
	onOpenQuote: (id: number) => void;
}

export function QuoteDetailDrawer({
	quoteId,
	opened,
	onClose,
	onEdit,
	onOpenQuote,
}: QuoteDetailDrawerProps) {
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const [confirmDelete, setConfirmDelete] = useState(false);

	const quoteQuery = useQuery({
		queryKey: ["quote", quoteId],
		queryFn: () => api.getQuote(quoteId as number),
		enabled: opened && quoteId !== null,
	});
	const similarQuery = useQuery({
		queryKey: ["quote", quoteId, "similar"],
		queryFn: () => api.similarQuotes(quoteId as number, 6),
		enabled: opened && quoteId !== null,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["quotes"] });
		void queryClient.invalidateQueries({ queryKey: ["search"] });
		void queryClient.invalidateQueries({ queryKey: ["quote"] });
		void queryClient.invalidateQueries({ queryKey: ["daily"] });
		void queryClient.invalidateQueries({ queryKey: ["stats"] });
		void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
	};

	const statusMutation = useMutation({
		mutationFn: (status: ActiveQuoteStatus) => api.updateQuote(quoteId as number, { status }),
		onSuccess: invalidate,
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not update quote",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const dropMutation = useMutation({
		mutationFn: () => api.deleteQuote(quoteId as number),
		onSuccess: () => {
			notifications.show({ color: "teal", message: "Quote moved to Dropped" });
			setConfirmDelete(false);
			invalidate();
			void queryClient.invalidateQueries({ queryKey: ["dropped"] });
			onClose();
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not drop quote",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const quote = quoteQuery.data;

	return (
		<>
			<Drawer
				opened={opened}
				onClose={onClose}
				position="right"
				size={isMobile ? "100%" : "md"}
				padding="lg"
				title="Quote"
			>
				{quoteQuery.isLoading && (
					<Group justify="center" py="xl">
						<Loader />
					</Group>
				)}
				{quoteQuery.isError && (
					<Text c="red">
						{quoteQuery.error instanceof ApiError
							? quoteQuery.error.message
							: "Could not load quote"}
					</Text>
				)}
				{quote && (
					<Stack gap="md">
						<Group justify="space-between" align="flex-start">
							<Group gap="xs">
								<Badge
									color={
										quote.status === "starred"
											? "yellow"
											: quote.status === "private"
												? "grape"
												: "gray"
									}
									variant="light"
								>
									{quote.status === "starred"
										? "Starred"
										: quote.status === "private"
											? "Private"
											: "Inbox"}
								</Badge>
								<Badge color="gray" variant="light">
									{quote.sentCount} sends
								</Badge>
							</Group>
							<Group gap={4}>
								<Tooltip label="Edit">
									<ActionIcon variant="light" onClick={() => onEdit(quote.id)} aria-label="Edit">
										<IconEdit size={18} />
									</ActionIcon>
								</Tooltip>
								<Tooltip label="Drop">
									<ActionIcon
										variant="light"
										color="red"
										onClick={() => setConfirmDelete(true)}
										aria-label="Drop"
									>
										<IconArchive size={18} />
									</ActionIcon>
								</Tooltip>
							</Group>
						</Group>

						<Text className="quote-text">{quote.text}</Text>
						<Text fw={650} size="lg">
							— {quote.author}
						</Text>

						<SegmentedControl
							fullWidth
							value={quote.status}
							disabled={statusMutation.isPending}
							onChange={(value) => statusMutation.mutate(value as ActiveQuoteStatus)}
							data={[
								{ label: "Starred", value: "starred" },
								{ label: "Inbox", value: "inbox" },
								{ label: "Private", value: "private" },
							]}
						/>

						<Divider />

						<Stack gap={6}>
							<Group gap="xs">
								<IconCalendar size={15} className="muted" />
								<Text size="xs" c="dimmed">
									Added {formatDateTime(quote.createdAt)}
								</Text>
							</Group>
							<Group gap="xs">
								<IconEdit size={15} className="muted" />
								<Text size="xs" c="dimmed">
									Edited {formatDateTime(quote.updatedAt)}
								</Text>
							</Group>
							<Group gap="xs">
								<IconSend size={15} className="muted" />
								<Text size="xs" c="dimmed">
									Last sent {relativeTime(quote.lastSentAt)}
								</Text>
							</Group>
						</Stack>

						<Group gap="xs">
							<IconSparkles size={15} />
							<Text fw={650} size="sm">
								Find similar
							</Text>
						</Group>
						{similarQuery.isLoading && <Loader size="sm" />}
						{similarQuery.data?.length === 0 && (
							<Text size="sm" c="dimmed">
								No close semantic matches yet. This needs the embedding index to be ready.
							</Text>
						)}
						<ScrollArea.Autosize mah={320}>
							<Stack gap="xs">
								{similarQuery.data?.map((match) => (
									<Paper
										key={match.quote.id}
										withBorder
										p="sm"
										style={{ cursor: "pointer" }}
										onClick={() => onOpenQuote(match.quote.id)}
									>
										<Text size="sm" lineClamp={3} className="quote-text">
											{match.quote.text}
										</Text>
										<Group justify="space-between" mt={6}>
											<Text size="xs" fw={600}>
												{match.quote.author}
											</Text>
											<Badge
												size="xs"
												variant="light"
												color={DUPLICATE_CATEGORY_COLORS[match.category]}
											>
												{DUPLICATE_CATEGORY_LABELS[match.category]} ·{" "}
												{match.similarity === null ? "—" : `${Math.round(match.similarity * 100)}%`}
											</Badge>
										</Group>
									</Paper>
								))}
							</Stack>
						</ScrollArea.Autosize>

						<Button variant="light" onClick={() => onEdit(quote.id)}>
							Edit quote
						</Button>
					</Stack>
				)}
			</Drawer>

			<Modal
				opened={confirmDelete}
				onClose={() => setConfirmDelete(false)}
				title="Move this quote to Dropped?"
			>
				<Stack>
					<Text size="sm">
						It will stop being sent daily and exact re-imports will be skipped. You can restore it
						later from the Dropped archive.
					</Text>
					<Group justify="flex-end">
						<Button variant="default" onClick={() => setConfirmDelete(false)}>
							Cancel
						</Button>
						<Button
							color="red"
							loading={dropMutation.isPending}
							onClick={() => dropMutation.mutate()}
							leftSection={<IconTrash size={16} />}
						>
							Drop
						</Button>
					</Group>
				</Stack>
			</Modal>
		</>
	);
}
