import { Button, Card, Center, Stack, Text, Title } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
	const navigate = useNavigate();
	return (
		<Center h="60dvh">
			<Card withBorder padding="xl" maw={420}>
				<Stack align="center" gap="sm">
					<Title order={2}>Page not found</Title>
					<Text size="sm" c="dimmed" ta="center">
						That route does not exist in this library.
					</Text>
					<Button leftSection={<IconArrowLeft size={16} />} onClick={() => navigate("/")}>
						Back to quotes
					</Button>
				</Stack>
			</Card>
		</Center>
	);
}
