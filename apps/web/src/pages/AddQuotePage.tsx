import {
	Alert,
	Badge,
	Button,
	Card,
	Center,
	Checkbox,
	Group,
	Loader,
	Paper,
	SegmentedControl,
	Stack,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { ActiveQuoteStatus, DuplicateMatch } from "@quotan/shared";
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { DUPLICATE_CATEGORY_COLORS, DUPLICATE_CATEGORY_LABELS } from "@/lib/duplicateLabels";

const DRAFT_KEY = "quotan:add-draft";

export function AddQuotePage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const queryClient = useQueryClient();
	const editId = Number(searchParams.get("edit") ?? 0) || null;
	const isEditing = editId !== null;

	const [text, setText] = useState("");
	const [author, setAuthor] = useState("");
	const [status, setStatus] = useState<ActiveQuoteStatus>("inbox");
	const [overrideExact, setOverrideExact] = useState(false);
	const [initialised, setInitialised] = useState(false);
	const [draftLoaded, setDraftLoaded] = useState(false);

	const quoteQuery = useQuery({
		queryKey: ["quote", editId],
		queryFn: () => api.getQuote(editId as number),
		enabled: isEditing,
	});

	useEffect(() => {
		if (!isEditing || initialised || !quoteQuery.data) return;
		setText(quoteQuery.data.text);
		setAuthor(quoteQuery.data.author);
		setStatus(quoteQuery.data.status === "dropped" ? "inbox" : quoteQuery.data.status);
		setInitialised(true);
	}, [initialised, isEditing, quoteQuery.data]);

	useEffect(() => {
		if (isEditing || draftLoaded) return;
		try {
			const raw = localStorage.getItem(DRAFT_KEY);
			if (raw) {
				const draft = JSON.parse(raw) as {
					text?: string;
					author?: string;
					status?: ActiveQuoteStatus;
				};
				if (draft.text) setText(draft.text);
				if (draft.author) setAuthor(draft.author);
				if (draft.status === "starred" || draft.status === "inbox" || draft.status === "private") {
					setStatus(draft.status);
				}
			}
		} catch {
			// Ignore a corrupt draft.
		}
		setDraftLoaded(true);
	}, [draftLoaded, isEditing]);

	useEffect(() => {
		if (isEditing || !draftLoaded) return;
		const handle = window.setTimeout(() => {
			try {
				if (text || author) {
					localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, author, status }));
				} else {
					localStorage.removeItem(DRAFT_KEY);
				}
			} catch {
				// Storage can be unavailable.
			}
		}, 250);
		return () => window.clearTimeout(handle);
	}, [author, draftLoaded, isEditing, status, text]);

	const [debouncedText] = useDebouncedValue(text, 400);
	const [debouncedAuthor] = useDebouncedValue(author, 400);
	const duplicateQuery = useQuery({
		queryKey: ["duplicates", debouncedText, debouncedAuthor, editId],
		queryFn: ({ signal }) =>
			api.checkDuplicates(
				{
					text: debouncedText,
					author: debouncedAuthor,
					excludeId: editId ?? undefined,
				},
				signal,
			),
		enabled: debouncedText.trim().length >= 3,
		staleTime: 10_000,
	});

	const exactMatch = duplicateQuery.data?.matches.some((match) => match.category === "exact");
	const saveMutation = useMutation({
		mutationFn: () =>
			isEditing
				? api.updateQuote(editId as number, { text, author, status })
				: api.createQuote({ text, author, status }),
		onSuccess: () => {
			if (!isEditing) localStorage.removeItem(DRAFT_KEY);
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message: isEditing ? "Quote updated" : "Quote added",
			});
			void queryClient.invalidateQueries({ queryKey: ["quotes"] });
			void queryClient.invalidateQueries({ queryKey: ["search"] });
			void queryClient.invalidateQueries({ queryKey: ["quote"] });
			void queryClient.invalidateQueries({ queryKey: ["daily"] });
			void queryClient.invalidateQueries({ queryKey: ["stats"] });
			void queryClient.invalidateQueries({ queryKey: ["index"] });
			void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
			navigate("/");
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not save quote",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const canSave = useMemo(
		() => text.trim().length > 0 && author.trim().length > 0 && (!exactMatch || overrideExact),
		[author, exactMatch, overrideExact, text],
	);

	if (isEditing && quoteQuery.isLoading) {
		return (
			<Center h="60dvh">
				<Loader />
			</Center>
		);
	}

	if (isEditing && quoteQuery.isError) {
		return (
			<div className="page-container">
				<Alert color="red">
					{quoteQuery.error instanceof ApiError
						? quoteQuery.error.message
						: "Could not load that quote"}
				</Alert>
			</div>
		);
	}

	return (
		<div className="page-container" style={{ maxWidth: 760 }}>
			<Button
				variant="subtle"
				color="gray"
				leftSection={<IconArrowLeft size={16} />}
				onClick={() => navigate(-1)}
				mb="sm"
			>
				Back
			</Button>
			<Title order={2} mb={4}>
				{isEditing ? "Edit quote" : "Add a quote"}
			</Title>
			<Text size="sm" c="dimmed" mb="lg">
				{isEditing
					? "Change the text, attribution, or status."
					: "We’ll check for existing matches as you type."}
			</Text>

			<Stack gap="md">
				<Textarea
					value={text}
					onChange={(event) => {
						setText(event.currentTarget.value);
						setOverrideExact(false);
					}}
					placeholder="“The unexamined life is not worth living.”"
					minRows={5}
					autosize
					size="md"
					label="Quote"
					required
				/>
				<TextInput
					value={author}
					onChange={(event) => {
						setAuthor(event.currentTarget.value);
						setOverrideExact(false);
					}}
					placeholder="Socrates"
					size="md"
					label="Author"
					required
				/>
				<Stack gap={6}>
					<Text size="sm" fw={500}>
						Status
					</Text>
					<SegmentedControl
						value={status}
						onChange={(value) => setStatus(value as ActiveQuoteStatus)}
						data={[
							{ label: "Starred", value: "starred" },
							{ label: "Inbox", value: "inbox" },
							{ label: "Private", value: "private" },
						]}
					/>
					<Text size="xs" c="dimmed">
						{status === "private"
							? "Private quotes are kept in your library but are never sent daily."
							: status === "starred"
								? "Starred quotes fill the daily starred slot."
								: "Inbox quotes fill the daily Inbox slot and are archived automatically after sending."}
					</Text>
				</Stack>

				{exactMatch && (
					<Alert color="red" icon={<IconAlertTriangle size={18} />} title="Exact duplicate">
						This quote and author already exist. You can still add it if the duplicates are
						intentional.
						<Checkbox
							mt="sm"
							label="Add anyway"
							checked={overrideExact}
							onChange={(event) => setOverrideExact(event.currentTarget.checked)}
						/>
					</Alert>
				)}

				<DuplicatePanel
					matches={duplicateQuery.data?.matches ?? []}
					loading={duplicateQuery.isFetching}
					enabled={debouncedText.trim().length >= 3}
					embeddingUsed={duplicateQuery.data?.embeddingUsed ?? false}
				/>

				<Group justify="flex-end">
					<Button variant="default" onClick={() => navigate(-1)}>
						Cancel
					</Button>
					<Button
						onClick={() => saveMutation.mutate()}
						loading={saveMutation.isPending}
						disabled={!canSave}
						leftSection={<IconCheck size={16} />}
					>
						{isEditing ? "Save changes" : "Add quote"}
					</Button>
				</Group>
			</Stack>
		</div>
	);
}

function DuplicatePanel({
	matches,
	loading,
	enabled,
	embeddingUsed,
}: {
	matches: DuplicateMatch[];
	loading: boolean;
	enabled: boolean;
	embeddingUsed: boolean;
}) {
	if (!enabled) {
		return (
			<Paper withBorder p="md" bg="var(--mantine-color-default-hover)">
				<Group gap="xs">
					<IconSparkles size={16} className="muted" />
					<Text size="sm" c="dimmed">
						Start typing to see possible duplicates.
					</Text>
				</Group>
			</Paper>
		);
	}

	return (
		<Paper withBorder p="md">
			<Group justify="space-between" mb="sm">
				<Group gap="xs">
					<IconSparkles size={17} />
					<Text fw={650} size="sm">
						Possible duplicates
					</Text>
				</Group>
				<Group gap={6}>
					{loading && <Loader size={12} />}
					<Badge size="xs" variant="light" color={embeddingUsed ? "grape" : "gray"}>
						{embeddingUsed ? "keyword + semantic" : "keyword only"}
					</Badge>
				</Group>
			</Group>
			{matches.length === 0 ? (
				<Text size="sm" c="dimmed">
					No close matches found.
				</Text>
			) : (
				<Stack gap="xs">
					{matches.map((match) => (
						<Card key={match.quote.id} withBorder padding="sm">
							<Text size="sm" className="quote-text" lineClamp={3}>
								{match.quote.text}
							</Text>
							<Group justify="space-between" mt={6}>
								<Text size="xs" fw={600}>
									{match.quote.author}
								</Text>
								<Group gap={6}>
									<Badge
										size="xs"
										color={DUPLICATE_CATEGORY_COLORS[match.category]}
										variant="light"
									>
										{DUPLICATE_CATEGORY_LABELS[match.category]}
									</Badge>
									{match.similarity !== null && (
										<Text size="xs" c="dimmed">
											{Math.round(match.similarity * 100)}% similar
										</Text>
									)}
								</Group>
							</Group>
						</Card>
					))}
				</Stack>
			)}
		</Paper>
	);
}
