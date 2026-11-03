import {
	ActionIcon,
	AppShell,
	Avatar,
	Badge,
	Box,
	Divider,
	Group,
	Menu,
	NavLink,
	Stack,
	Text,
	Tooltip,
	useMantineColorScheme,
} from "@mantine/core";
import {
	IconArchive,
	IconChartBar,
	IconCopy,
	IconDeviceMobile,
	IconDownload,
	IconLogout,
	IconMoon,
	IconPlus,
	IconQuote,
	IconSend,
	IconSettings,
	IconStar,
	IconSun,
	IconUpload,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useIsMobile } from "@/hooks/useMedia";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { OfflineBanner } from "./OfflineBanner";

const NAV_ITEMS = [
	{ label: "Quotes", path: "/", icon: IconQuote },
	{ label: "Duplicates", path: "/duplicates", icon: IconCopy },
	{ label: "Today", path: "/today", icon: IconStar },
	{ label: "Add", path: "/add", icon: IconPlus },
	{ label: "Sent", path: "/sent", icon: IconSend },
	{ label: "Stats", path: "/stats", icon: IconChartBar },
];

const DESKTOP_ITEMS = [
	...NAV_ITEMS,
	{ label: "Import / Export", path: "/import-export", icon: IconDownload },
	{ label: "Settings", path: "/settings", icon: IconSettings },
];

function isActive(pathname: string, path: string): boolean {
	if (path === "/") return pathname === "/";
	return pathname === path || pathname.startsWith(`${path}/`);
}

export function AppLayout() {
	const location = useLocation();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const { logout, auth } = useAuth();
	const { colorScheme, setColorScheme } = useMantineColorScheme();
	const { canInstall, install } = usePwaInstall();

	return (
		<AppShell
			header={{ height: 60 }}
			navbar={isMobile ? undefined : { width: 240, breakpoint: "md", collapsed: { mobile: true } }}
			padding={0}
			styles={{
				main: {
					paddingBottom: isMobile ? 76 : 0,
					minHeight: "100dvh",
				},
			}}
		>
			<AppShell.Header>
				<Group h="100%" px="md" justify="space-between" wrap="nowrap">
					<Group gap="xs">
						<Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
							<Group gap={8}>
								<Avatar color="teal" radius="md" size="md">
									<IconQuote size={20} />
								</Avatar>
								<Box>
									<Text fw={700} lh={1.1} size="md">
										Quotan
									</Text>
									<Text size="xs" c="dimmed" lh={1.2}>
										{auth?.label ?? "Private quote library"}
									</Text>
								</Box>
							</Group>
						</Link>
					</Group>
					<Group gap="xs" wrap="nowrap">
						{canInstall && !isMobile && <ButtonLowEmphasis onClick={() => void install()} />}
						<Tooltip label={colorScheme === "dark" ? "Light mode" : "Dark mode"}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size="lg"
								onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
								aria-label="Toggle color scheme"
							>
								{colorScheme === "dark" ? <IconSun size={19} /> : <IconMoon size={19} />}
							</ActionIcon>
						</Tooltip>
						<Menu position="bottom-end" shadow="md" width={220}>
							<Menu.Target>
								<ActionIcon variant="subtle" color="gray" size="lg" aria-label="Open menu">
									<IconSettings size={19} />
								</ActionIcon>
							</Menu.Target>
							<Menu.Dropdown>
								<Menu.Item
									leftSection={<IconArchive size={16} />}
									onClick={() => navigate("/dropped")}
								>
									Dropped
								</Menu.Item>
								<Menu.Item
									leftSection={<IconUpload size={16} />}
									onClick={() => navigate("/import-export")}
								>
									Import / Export
								</Menu.Item>
								<Menu.Item
									leftSection={<IconSettings size={16} />}
									onClick={() => navigate("/settings")}
								>
									Settings
								</Menu.Item>
								{canInstall && (
									<Menu.Item
										leftSection={<IconDeviceMobile size={16} />}
										onClick={() => void install()}
									>
										Install app
									</Menu.Item>
								)}
								<Menu.Divider />
								<Menu.Item
									color="red"
									leftSection={<IconLogout size={16} />}
									onClick={() => void logout()}
								>
									Log out
								</Menu.Item>
							</Menu.Dropdown>
						</Menu>
					</Group>
				</Group>
			</AppShell.Header>

			{!isMobile && (
				<AppShell.Navbar p="sm">
					<Stack gap={2}>
						{DESKTOP_ITEMS.map((item) => (
							<NavLink
								key={item.path}
								component={Link}
								to={item.path}
								label={item.label}
								leftSection={<item.icon size={18} />}
								active={isActive(location.pathname, item.path)}
								variant="filled"
								styles={{ root: { borderRadius: 10 } }}
							/>
						))}
					</Stack>
					<Box mt="auto" pt="md">
						<Divider mb="sm" />
						<Group gap="xs" px="xs">
							<IconSend size={16} className="muted" />
							<Text size="xs" c="dimmed">
								Quotan sends the daily pair to Telegram.
							</Text>
						</Group>
					</Box>
				</AppShell.Navbar>
			)}

			<AppShell.Main>
				<OfflineBanner />
				<Outlet />
			</AppShell.Main>

			{isMobile && (
				<Box
					component="nav"
					pos="fixed"
					bottom={0}
					left={0}
					right={0}
					className="safe-bottom"
					style={{
						zIndex: 100,
						background: "var(--mantine-color-body)",
						borderTop: "1px solid var(--mantine-color-default-border)",
					}}
				>
					<Group justify="space-around" align="center" h={64} px={4} gap={0}>
						{NAV_ITEMS.map((item) => {
							const active = isActive(location.pathname, item.path);
							const isAdd = item.path === "/add";
							return (
								<Link
									key={item.path}
									to={item.path}
									style={{ textDecoration: "none", flex: 1, minWidth: 0 }}
									aria-label={item.label}
								>
									<Stack gap={2} align="center" justify="center" w="100%">
										<Box
											style={{
												width: isAdd ? 40 : 34,
												height: isAdd ? 40 : 28,
												borderRadius: 12,
												display: "grid",
												placeItems: "center",
												background: isAdd
													? "var(--mantine-color-teal-7)"
													: active
														? "var(--mantine-color-teal-light)"
														: "transparent",
												color: isAdd
													? "white"
													: active
														? "var(--mantine-color-teal-light-color)"
														: "var(--mantine-color-dimmed)",
											}}
										>
											<item.icon size={isAdd ? 24 : 20} />
										</Box>
										<Text
											size="9px"
											c={active ? "teal" : "dimmed"}
											fw={active ? 600 : 400}
											lineClamp={1}
										>
											{item.label}
										</Text>
									</Stack>
								</Link>
							);
						})}
					</Group>
				</Box>
			)}
		</AppShell>
	);
}

function ButtonLowEmphasis({ onClick }: { onClick: () => void }) {
	return (
		<Badge
			variant="light"
			color="teal"
			leftSection={<IconDeviceMobile size={13} />}
			style={{ cursor: "pointer" }}
			onClick={onClick}
		>
			Install
		</Badge>
	);
}
