import { AreaChart, BarChart, DonutChart } from "@mantine/charts";
import {
	Alert,
	Badge,
	Card,
	Center,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconArchive,
	IconChartBar,
	IconInbox,
	IconLock,
	IconQuote,
	IconSend,
	IconStar,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/api/client";
import { formatNumber } from "@/lib/format";

export default function StatsPage() {
	const statsQuery = useQuery({ queryKey: ["stats"], queryFn: api.stats });

	if (statsQuery.isLoading) {
		return (
			<Center h="60dvh">
				<Loader />
			</Center>
		);
	}
	if (statsQuery.isError || !statsQuery.data) {
		return (
			<div className="page-container">
				<Alert color="red">
					{statsQuery.error instanceof ApiError
						? statsQuery.error.message
						: "Could not load statistics"}
				</Alert>
			</div>
		);
	}

	const stats = statsQuery.data;
	const coverage =
		stats.totals.quotes === 0
			? 0
			: Math.round((stats.totals.sentDistinct / stats.totals.quotes) * 100);

	return (
		<div className="page-container">
			<Title order={2}>Statistics</Title>
			<Text size="sm" c="dimmed" mb="lg">
				A quick read on the collection and the daily rotation.
			</Text>

			<SimpleGrid cols={{ base: 2, md: 3 }} spacing="md" mb="lg">
				<StatCard
					label="Active quotes"
					value={formatNumber(stats.totals.quotes)}
					icon={<IconQuote size={18} />}
					hint={`${formatNumber(stats.totals.authors)} authors · Dropped excluded`}
				/>
				<StatCard
					label="Starred"
					value={formatNumber(stats.totals.starred)}
					icon={<IconStar size={18} />}
					hint={`${formatNumber(stats.totals.inbox)} in Inbox`}
				/>
				<StatCard
					label="Private"
					value={formatNumber(stats.totals.private)}
					icon={<IconLock size={18} />}
					hint="Never sent daily"
				/>
				<StatCard
					label="Dropped"
					value={formatNumber(stats.totals.dropped)}
					icon={<IconArchive size={18} />}
					hint="Archived · blocks exact re-import"
				/>
				<StatCard
					label="Never sent"
					value={formatNumber(stats.totals.neverSent)}
					icon={<IconInbox size={18} />}
					hint={`${coverage}% of active quotes covered`}
				/>
				<StatCard
					label="Sent"
					value={formatNumber(stats.deliveries.total)}
					icon={<IconSend size={18} />}
					hint={`${formatNumber(stats.deliveries.last30)} in the last 30 days`}
				/>
			</SimpleGrid>

			<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Text fw={650}>Additions</Text>
						<Badge variant="light" color="teal">
							last 12 months
						</Badge>
					</Group>
					<AreaChart
						h={220}
						data={stats.additionsByMonth}
						dataKey="month"
						series={[{ name: "count", color: "teal.6", label: "Quotes" }]}
						curveType="monotone"
						withGradient
						withDots={false}
						tickLine="none"
						gridAxis="y"
					/>
				</Paper>

				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Text fw={650}>Deliveries</Text>
						<Badge variant="light" color="blue">
							last 12 months
						</Badge>
					</Group>
					<BarChart
						h={220}
						data={stats.deliveriesByMonth}
						dataKey="month"
						series={[{ name: "count", color: "blue.6", label: "Sends" }]}
						tickLine="none"
						gridAxis="y"
					/>
				</Paper>

				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Text fw={650}>Status split</Text>
					</Group>
					<Group justify="center" py="md">
						<DonutChart
							data={[
								{ name: "Starred", value: stats.totals.starred, color: "yellow.6" },
								{ name: "Inbox", value: stats.totals.inbox, color: "gray.5" },
								{ name: "Private", value: stats.totals.private, color: "grape.6" },
								{ name: "Dropped", value: stats.totals.dropped, color: "orange.6" },
							]}
							chartLabel={`${coverage}% sent`}
							withLabelsLine
							withLabels
							size={180}
							thickness={26}
						/>
					</Group>
				</Paper>

				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Text fw={650}>Most quoted authors</Text>
					</Group>
					{stats.topAuthors.length === 0 ? (
						<Text size="sm" c="dimmed">
							No authors yet.
						</Text>
					) : (
						<BarChart
							h={220}
							data={stats.topAuthors.slice(0, 7)}
							dataKey="author"
							series={[{ name: "count", color: "grape.6", label: "Quotes" }]}
							tickLine="none"
							gridAxis="y"
						/>
					)}
				</Paper>
			</SimpleGrid>

			<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="md">
				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Text fw={650}>Last 30 days</Text>
						<Badge variant="light" color="teal">
							{stats.deliveries.streakDays} day streak
						</Badge>
					</Group>
					<AreaChart
						h={170}
						data={stats.deliveries.last30Days}
						dataKey="date"
						series={[{ name: "count", color: "teal.6", label: "Sends" }]}
						curveType="monotone"
						withGradient
						withDots={false}
						tickLine="none"
						gridAxis="y"
					/>
				</Paper>

				<Paper withBorder p="md">
					<Group justify="space-between" mb="sm">
						<Group gap="xs">
							<IconChartBar size={17} />
							<Text fw={650}>Embedding index</Text>
						</Group>
						<Badge
							variant="light"
							color={
								stats.index.state === "ready"
									? "teal"
									: stats.index.state === "indexing"
										? "blue"
										: stats.index.state === "disabled"
											? "gray"
											: "yellow"
							}
						>
							{stats.index.state}
						</Badge>
					</Group>
					<Stack gap={4}>
						<Text size="sm">
							{stats.index.provider} · {stats.index.model}
						</Text>
						<Text size="xs" c="dimmed">
							{formatNumber(stats.index.indexed)} of {formatNumber(stats.index.total)} quotes
							indexed · {stats.index.dimensions} dimensions
						</Text>
						{stats.index.error && (
							<Text size="xs" c="red">
								{stats.index.error}
							</Text>
						)}
						<Text size="xs" c="dimmed">
							Coverage: {coverage}% ·{" "}
							{stats.deliveries.byChannel
								.map((channel) => `${channel.channel} ${channel.count}`)
								.join(" · ") || "no deliveries"}
						</Text>
					</Stack>
				</Paper>
			</SimpleGrid>
		</div>
	);
}

function StatCard({
	label,
	value,
	icon,
	hint,
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
	hint: string;
}) {
	return (
		<Card withBorder padding="md">
			<Group justify="space-between" mb={6}>
				<Text size="xs" c="dimmed" tt="uppercase" fw={600}>
					{label}
				</Text>
				<Text c="teal">{icon}</Text>
			</Group>
			<Text fw={700} size="xl">
				{value}
			</Text>
			<Text size="xs" c="dimmed">
				{hint}
			</Text>
		</Card>
	);
}
