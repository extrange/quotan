import {
	Alert,
	Badge,
	Button,
	Card,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ActiveQuoteStatus, Quote } from "@quotan/shared";
import {
	IconArchive,
	IconCheck,
	IconClock,
	IconInbox,
	IconInfoCircle,
	IconLock,
	IconRefresh,
	IconSend,
	IconStar,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { formatDateTime, relativeTime } from "@/lib/format";

export function TodayPage() {
	const queryClient = useQueryClient();
	const dailyQuery = useQuery({
		queryKey: ["daily"],
		queryFn: api.daily,
	});
	const previewQuery = useQuery({
		queryKey: ["daily", "preview"],
		queryFn: () => api.dailyPreview(),
		enabled: dailyQuery.isSuccess && dailyQuery.data.batch === null,
		staleTime: 0,
		gcTime: 0,
	});
	const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["daily"] });
		void queryClient.invalidateQueries({ queryKey: ["deliveries"] });
		void queryClient.invalidateQueries({ queryKey: ["stats"] });
		void queryClient.invalidateQueries({ queryKey: ["quotes"] });
		void queryClient.invalidateQueries({ queryKey: ["search"] });
		void queryClient.invalidateQueries({ queryKey: ["dropped"] });
		void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
		void queryClient.invalidateQueries({ queryKey: ["quote"] });
	};

	const sendMutation = useMutation({
		mutationFn: api.sendDaily,
		onSuccess: (result) => {
			invalidate();
			notifications.show({
				color: result.batch ? "teal" : "gray",
				icon: <IconCheck size={16} />,
				message: result.batch
					? result.alreadySent
						? "Today’s quotes were already sent"
						: "Today’s quotes sent to Telegram"
					: "There are no quotes available to send",
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not send to Telegram",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const commitMutation = useMutation({
		mutationFn: () => api.commitDaily("manual"),
		onSuccess: () => {
			invalidate();
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message: "Today’s pair recorded; the Inbox quote was archived",
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not record the pair",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const statusMutation = useMutation({
		mutationFn: ({
			id,
			status,
			dropped,
		}: {
			id: number;
			status: ActiveQuoteStatus;
			dropped: boolean;
		}) => (dropped ? api.restoreDropped(id, status) : api.updateQuote(id, { status })),
		onSuccess: (quote) => {
			invalidate();
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message:
					quote.status === "starred"
						? "Kept as Starred"
						: quote.status === "private"
							? "Moved to Private"
							: "Returned to Inbox",
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not change the quote’s status",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const batch = dailyQuery.data?.batch ?? previewQuery.data ?? null;
	const committed = Boolean(dailyQuery.data?.batch);
	const loading =
		dailyQuery.isLoading || (dailyQuery.data?.batch === null && previewQuery.isLoading);
	const error = dailyQuery.error ?? previewQuery.error;
	const telegram = settingsQuery.data?.telegram;
	const telegramEnabled = telegram?.enabled ?? false;
	const sent = committed && batch?.sendState === "sent";
	const failed = committed && batch?.sendState === "pending" && batch.attempts > 0;

	const statusBadge = sent ? (
		<Badge variant="light" color="teal" leftSection={<IconCheck size={11} />}>
			Sent
		</Badge>
	) : failed ? (
		<Badge variant="light" color="red" leftSection={<IconRefresh size={11} />}>
			Failed
		</Badge>
	) : committed ? (
		<Badge variant="light" color="yellow" leftSection={<IconClock size={11} />}>
			Pending
		</Badge>
	) : telegramEnabled ? (
		<Badge variant="light" color="blue" leftSection={<IconClock size={11} />}>
			Scheduled
		</Badge>
	) : (
		<Badge variant="light" color="gray">
			Preview
		</Badge>
	);

	return (
		<div className="page-container">
			<Group justify="space-between" align="flex-end" mb="lg">
				<div>
					<Title order={2}>Today</Title>
					<Text size="sm" c="dimmed">
						One Starred and one Inbox quote. The Inbox quote is archived after it is sent.
					</Text>
				</div>
				<Group gap="xs">
					{statusBadge}
					<Button
						component={Link}
						to="/dropped"
						variant="subtle"
						color="gray"
						leftSection={<IconArchive size={15} />}
					>
						Dropped
					</Button>
				</Group>
			</Group>

			{loading && (
				<Group justify="center" py="xl">
					<Loader />
				</Group>
			)}
			{error && (
				<Alert color="red">
					{error instanceof ApiError ? error.message : "Could not load today’s quotes"}
				</Alert>
			)}

			{batch && (
				<Stack gap="lg">
					<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
						<DailyCard
							label="Starred"
							icon={<IconStar size={12} />}
							color="yellow"
							quote={batch.starred}
							fallback="No Starred quote is available."
						/>
						<DailyCard
							label="Inbox"
							icon={<IconInbox size={12} />}
							color="gray"
							quote={batch.unstarred}
							fallback="No Inbox quote is available."
							badge={
								batch.unstarred?.status === "dropped" && batch.unstarred.dropSource === "daily" ? (
									<Badge
										size="xs"
										color="orange"
										variant="light"
										leftSection={<IconArchive size={10} />}
									>
										Dropped automatically
									</Badge>
								) : batch.unstarred?.status === "starred" ? (
									<Badge size="xs" color="yellow" variant="light">
										Kept as Starred
									</Badge>
								) : batch.unstarred?.status === "private" ? (
									<Badge size="xs" color="grape" variant="light">
										Kept as Private
									</Badge>
								) : undefined
							}
							footer={
								committed && batch.unstarred ? (
									<InboxStatusControls
										quote={batch.unstarred}
										pending={statusMutation.isPending}
										onChange={(status) =>
											statusMutation.mutate({
												id: batch.unstarred?.id as number,
												status,
												dropped: batch.unstarred?.status === "dropped",
											})
										}
									/>
								) : undefined
							}
						/>
					</SimpleGrid>

					{batch.warnings.length > 0 && (
						<Alert color="yellow" icon={<IconInfoCircle size={18} />}>
							{batch.warnings.join(" ")}
						</Alert>
					)}

					<Paper withBorder p="md">
						<Group justify="space-between" wrap="wrap" gap="md">
							<Stack gap={4}>
								<Group gap="xs">
									<IconSend size={17} />
									<Text fw={600}>Daily Telegram delivery</Text>
									{telegramEnabled ? (
										<Badge size="xs" variant="light" color="teal">
											On
										</Badge>
									) : (
										<Badge size="xs" variant="light" color="gray">
											Off
										</Badge>
									)}
								</Group>
								<Text size="sm" c="dimmed">
									{telegram
										? telegramEnabled
											? `Sends at ${telegram.sendTime} ${telegram.timezone} to ${telegram.chatIdMasked ?? "your chat"}.`
											: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to let Quotan send automatically."
										: "Loading delivery settings…"}
								</Text>
								<Text size="sm">
									{sent
										? `Sent ${formatDateTime(batch.sentAt)}${batch.telegramMessageId ? ` · message ${batch.telegramMessageId}` : ""}.`
										: failed
											? `Last attempt ${relativeTime(batch.lastAttemptAt)} failed.`
											: telegramEnabled
												? "Today’s pair has not been sent yet."
												: "Telegram is disabled, so record the pair manually after delivering it."}
								</Text>
								{batch.lastError && (
									<Text size="xs" c="red">
										{batch.lastError}
									</Text>
								)}
							</Stack>
							<Group gap="xs">
								{telegramEnabled && !sent && (
									<Button
										leftSection={<IconSend size={16} />}
										loading={sendMutation.isPending}
										disabled={!batch.starred && !batch.unstarred}
										onClick={() => sendMutation.mutate()}
									>
										{failed || committed ? "Retry send" : "Send now"}
									</Button>
								)}
								{!telegramEnabled && !sent && (
									<Button
										leftSection={<IconCheck size={16} />}
										loading={commitMutation.isPending}
										disabled={!batch.starred && !batch.unstarred}
										onClick={() => commitMutation.mutate()}
									>
										Record as sent
									</Button>
								)}
							</Group>
						</Group>
					</Paper>

					<Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
						The Inbox quote is moved to Dropped right after a successful send. If you liked it, use
						the buttons on its card to keep it as Starred, Private, or Inbox. Otherwise it stays
						safely archived and exact re-imports are skipped.
					</Alert>
				</Stack>
			)}
		</div>
	);
}

function InboxStatusControls({
	quote,
	pending,
	onChange,
}: {
	quote: Quote;
	pending: boolean;
	onChange: (status: ActiveQuoteStatus) => void;
}) {
	return (
		<Stack gap={6} mt="sm">
			<Text size="xs" c="dimmed">
				{quote.status === "dropped"
					? "Did you like it? Keep it before it settles into Dropped."
					: "This quote has already been kept. You can move it again."}
			</Text>
			<Group gap={6}>
				<Button
					size="compact-xs"
					variant="light"
					color="yellow"
					leftSection={<IconStar size={12} />}
					disabled={pending || quote.status === "starred"}
					onClick={() => onChange("starred")}
				>
					Keep as Starred
				</Button>
				<Button
					size="compact-xs"
					variant="light"
					color="grape"
					leftSection={<IconLock size={12} />}
					disabled={pending || quote.status === "private"}
					onClick={() => onChange("private")}
				>
					Make Private
				</Button>
				<Button
					size="compact-xs"
					variant="light"
					color="gray"
					leftSection={<IconInbox size={12} />}
					disabled={pending || quote.status === "inbox"}
					onClick={() => onChange("inbox")}
				>
					Return to Inbox
				</Button>
			</Group>
		</Stack>
	);
}

function DailyCard({
	label,
	icon,
	color,
	quote,
	fallback,
	badge,
	footer,
}: {
	label: string;
	icon: ReactNode;
	color: string;
	quote: Quote | null;
	fallback: string;
	badge?: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<Card withBorder padding="lg" h="100%">
			<Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
				<Group gap={6}>
					<Badge color={color} variant="light" leftSection={icon}>
						{label}
					</Badge>
					{badge}
				</Group>
				{quote && (
					<Text size="xs" c="dimmed">
						{quote.sentCount} sends
					</Text>
				)}
			</Group>
			{quote ? (
				<Stack gap="sm">
					<Text className="quote-text">{quote.text}</Text>
					<Text fw={650}>— {quote.author}</Text>
					<Text size="xs" c="dimmed">
						Last sent {relativeTime(quote.lastSentAt)}
					</Text>
					{footer}
				</Stack>
			) : (
				<Text c="dimmed" size="sm">
					{fallback}
				</Text>
			)}
		</Card>
	);
}
