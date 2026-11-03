import {
	Badge,
	Button,
	Card,
	Code,
	Group,
	Progress,
	Stack,
	Text,
	Title,
	useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	IconArchive,
	IconCheck,
	IconDatabase,
	IconDeviceMobile,
	IconDownload,
	IconLogout,
	IconMoon,
	IconRefresh,
	IconSend,
	IconShieldLock,
	IconSun,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { formatNumber } from "@/lib/format";

export function SettingsPage() {
	const queryClient = useQueryClient();
	const { auth, logout } = useAuth();
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const { canInstall, install } = usePwaInstall();

	const indexQuery = useQuery({
		queryKey: ["index"],
		queryFn: api.indexStatus,
		refetchInterval: (query) =>
			query.state.data?.state === "indexing" || query.state.data?.state === "stale" ? 1500 : false,
	});

	const reindexMutation = useMutation({
		mutationFn: (force: boolean) => api.reindex(force),
		onSuccess: () => {
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message: "Reindex started",
			});
			void queryClient.invalidateQueries({ queryKey: ["index"] });
			void queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Could not start reindex",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
	const telegram = settingsQuery.data?.telegram;

	const index = indexQuery.data;
	const progress = index && index.total > 0 ? Math.round((index.indexed / index.total) * 100) : 0;
	const stateColor =
		index?.state === "ready"
			? "teal"
			: index?.state === "indexing"
				? "blue"
				: index?.state === "disabled"
					? "gray"
					: "yellow";

	return (
		<div className="page-container" style={{ maxWidth: 840 }}>
			<Title order={2}>Settings</Title>
			<Text size="sm" c="dimmed" mb="lg">
				Configuration lives in environment variables. This page shows status and maintenance
				actions.
			</Text>

			<Stack gap="md">
				<Card withBorder padding="md">
					<Group justify="space-between" mb="sm">
						<Group gap="xs">
							<IconDatabase size={18} />
							<Text fw={650}>Semantic index</Text>
						</Group>
						<Badge variant="light" color={stateColor}>
							{index?.state ?? "loading"}
						</Badge>
					</Group>
					{indexQuery.isError && (
						<Text c="red" size="sm">
							{indexQuery.error instanceof ApiError
								? indexQuery.error.message
								: "Could not load index status"}
						</Text>
					)}
					{index && (
						<Stack gap="xs">
							<Text size="sm">
								{index.provider} · {index.model} · {index.dimensions} dimensions
							</Text>
							<Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
								{index.modelKey}
							</Text>
							<Progress value={progress} color={stateColor} size="sm" />
							<Text size="xs" c="dimmed">
								{formatNumber(index.indexed)} of {formatNumber(index.total)} quotes indexed ·{" "}
								{formatNumber(index.pending)} pending
							</Text>
							{index.error && (
								<Text size="xs" c="red">
									{index.error}
								</Text>
							)}
							<Group mt="xs">
								<Button
									size="xs"
									variant="light"
									leftSection={<IconRefresh size={14} />}
									loading={reindexMutation.isPending}
									disabled={index.state === "indexing"}
									onClick={() => reindexMutation.mutate(false)}
								>
									Reindex missing
								</Button>
								<Button
									size="xs"
									variant="subtle"
									color="gray"
									disabled={index.state === "indexing"}
									onClick={() => reindexMutation.mutate(true)}
								>
									Rebuild everything
								</Button>
							</Group>
							<Text size="xs" c="dimmed">
								Changing the embedding model or its dtype/pooling triggers a rebuild on the next
								start. Until it finishes, search falls back to keywords.
							</Text>
						</Stack>
					)}
				</Card>

				<Card withBorder padding="md">
					<Group justify="space-between" mb="sm">
						<Group gap="xs">
							<IconSend size={18} />
							<Text fw={650}>Telegram delivery</Text>
						</Group>
						<Badge variant="light" color={telegram?.enabled ? "teal" : "gray"}>
							{telegram ? (telegram.enabled ? "on" : "off") : "loading"}
						</Badge>
					</Group>
					<Stack gap="xs">
						<Group justify="space-between">
							<Text size="sm">Bot credentials</Text>
							<Badge variant="light" color={telegram?.configured ? "teal" : "gray"}>
								{telegram?.configured ? "configured" : "not configured"}
							</Badge>
						</Group>
						<Group justify="space-between">
							<Text size="sm">Chat</Text>
							<Code>{telegram?.chatIdMasked ?? "—"}</Code>
						</Group>
						<Group justify="space-between">
							<Text size="sm">Daily send time</Text>
							<Text size="sm">
								{telegram ? `${telegram.sendTime} · ${telegram.timezone}` : "—"}
							</Text>
						</Group>
						<Text size="xs" c="dimmed">
							Quotan sends one Starred and one Inbox quote every day. Telegram is outbound only: no
							replies, commands, or buttons. The bot token never reaches the web app.
						</Text>
						<Text size="xs" c="dimmed">
							Configure TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and DAILY_SEND_TIME in the
							environment.
						</Text>
					</Stack>
				</Card>

				<Card withBorder padding="md">
					<Group gap="xs" mb="sm">
						<IconShieldLock size={18} />
						<Text fw={650}>Access</Text>
					</Group>
					<Stack gap="xs">
						<Group justify="space-between">
							<Text size="sm">Web session</Text>
							<Badge variant="light" color="teal">
								{auth?.authenticated ? "signed in" : "signed out"}
							</Badge>
						</Group>
						<Group justify="space-between">
							<Text size="sm">API key</Text>
							<Badge variant="light" color={auth?.apiKeyConfigured ? "teal" : "gray"}>
								{auth?.apiKeyConfigured ? "configured" : "not configured"}
							</Badge>
						</Group>
						<Code block>
							{`curl https://quotes.example.com/api/quotes \\
  -H "Authorization: Bearer $QUOTAN_API_KEY"`}
						</Code>
						<Text size="xs" c="dimmed">
							The API key is read from API_KEY. The web app never receives it.
						</Text>
					</Stack>
				</Card>

				<Card withBorder padding="md">
					<Group gap="xs" mb="sm">
						<IconDeviceMobile size={18} />
						<Text fw={650}>Appearance &amp; install</Text>
					</Group>
					<Stack gap="sm">
						<Group justify="space-between">
							<Text size="sm">Color scheme</Text>
							<Button
								size="xs"
								variant="light"
								leftSection={
									colorScheme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />
								}
								onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
							>
								{colorScheme === "dark" ? "Light" : "Dark"}
							</Button>
						</Group>
						<Group justify="space-between">
							<Text size="sm">Install as an app</Text>
							<Button
								size="xs"
								variant="light"
								disabled={!canInstall}
								onClick={() => void install()}
							>
								{canInstall ? "Install" : "Use your browser menu"}
							</Button>
						</Group>
						<Text size="xs" c="dimmed">
							On iOS, use Share → Add to Home Screen.
						</Text>
					</Stack>
				</Card>

				<Card withBorder padding="md">
					<Group gap="xs" mb="sm">
						<IconDownload size={18} />
						<Text fw={650}>Data</Text>
					</Group>
					<Group>
						<Button
							variant="light"
							leftSection={<IconDownload size={16} />}
							onClick={() => void api.downloadBackup()}
						>
							Download SQLite backup
						</Button>
						<Button
							component={Link}
							to="/dropped"
							variant="subtle"
							leftSection={<IconArchive size={16} />}
						>
							Open Dropped archive
						</Button>
					</Group>
					<Text size="xs" c="dimmed" mt="xs">
						Restore by stopping the container and replacing the database file in the /data volume.
					</Text>
				</Card>

				<Card withBorder padding="md">
					<Group justify="space-between">
						<Text size="sm" c="dimmed">
							Quotan {settingsQuery.data?.version ?? "0.1.0"}
						</Text>
						<Button
							color="red"
							variant="light"
							leftSection={<IconLogout size={16} />}
							onClick={() => void logout()}
						>
							Log out
						</Button>
					</Group>
				</Card>
			</Stack>
		</div>
	);
}
