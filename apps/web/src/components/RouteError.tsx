import { Alert, Button, Container, Stack, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";

export function RouteError() {
	const error = useRouteError();
	const navigate = useNavigate();
	const message = isRouteErrorResponse(error)
		? `${error.status} ${error.statusText}`
		: error instanceof Error
			? error.message
			: "Something went wrong";
	return (
		<Container size="sm" py="xl">
			<Stack>
				<Title order={2}>Quotan hit a problem</Title>
				<Alert color="red" icon={<IconAlertTriangle size={18} />}>
					{message}
				</Alert>
				<Button onClick={() => navigate("/", { replace: true })}>Back to quotes</Button>
			</Stack>
		</Container>
	);
}
