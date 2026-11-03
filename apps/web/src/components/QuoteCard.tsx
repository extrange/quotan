import { ActionIcon, Badge, Card, Group, Stack, Text, Tooltip } from "@mantine/core";
import type { Quote } from "@quotan/shared";
import { IconInbox, IconLock, IconSend, IconStar, IconStarFilled } from "@tabler/icons-react";
import { formatDate, relativeTime } from "@/lib/format";
import { highlightText } from "@/lib/highlight";

interface QuoteCardProps {
	quote: Quote;
	query?: string;
	onOpen: (quote: Quote) => void;
	onToggleStar: (quote: Quote) => void;
	starPending?: boolean;
}

function StatusBadge({ status }: { status: Quote["status"] }) {
	if (status === "starred") {
		return (
			<Badge size="xs" color="yellow" variant="light" leftSection={<IconStarFilled size={9} />}>
				Starred
			</Badge>
		);
	}
	if (status === "private") {
		return (
			<Badge size="xs" color="grape" variant="light" leftSection={<IconLock size={9} />}>
				Private
			</Badge>
		);
	}
	return (
		<Badge size="xs" color="gray" variant="light" leftSection={<IconInbox size={9} />}>
			Inbox
		</Badge>
	);
}

export function QuoteCard({ quote, query, onOpen, onToggleStar, starPending }: QuoteCardProps) {
	const starred = quote.status === "starred";
	return (
		<Card
			className="quote-card"
			padding="md"
			onClick={() => onOpen(quote)}
			role="button"
			tabIndex={0}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen(quote);
				}
			}}
		>
			<Group align="flex-start" wrap="nowrap" gap="sm">
				<Text className="quote-text" lineClamp={5} style={{ flex: 1 }}>
					{highlightText(quote.text, query)}
				</Text>
				<Tooltip label={starred ? "Move to Inbox" : "Star quote"}>
					<ActionIcon
						variant={starred ? "light" : "subtle"}
						color="yellow"
						size="lg"
						loading={starPending}
						onClick={(event) => {
							event.stopPropagation();
							onToggleStar(quote);
						}}
						aria-label={starred ? "Unstar quote" : "Star quote"}
					>
						{starred ? <IconStarFilled size={19} /> : <IconStar size={19} />}
					</ActionIcon>
				</Tooltip>
			</Group>

			<Stack gap={6} mt="sm">
				<Group justify="space-between" align="center" gap="xs">
					<Text size="sm" fw={650} lineClamp={1}>
						{highlightText(quote.author, query)}
					</Text>
					<Group gap={6} wrap="nowrap">
						<StatusBadge status={quote.status} />
						{quote.sentCount > 0 && (
							<Badge size="xs" color="gray" variant="light" leftSection={<IconSend size={10} />}>
								{quote.sentCount}
							</Badge>
						)}
					</Group>
				</Group>
				<Text size="xs" c="dimmed">
					Added {formatDate(quote.createdAt)} · Last sent {relativeTime(quote.lastSentAt)}
				</Text>
			</Stack>
		</Card>
	);
}
