import {
	Alert,
	Avatar,
	Button,
	Card,
	Center,
	Container,
	PasswordInput,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { IconLock, IconQuote } from "@tabler/icons-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";

export function LoginPage() {
	const { auth, isLoading, login } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	if (!isLoading && auth?.authenticated) {
		return <Navigate to="/" replace />;
	}

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login(password);
			const from = (location.state as { from?: string } | null)?.from;
			navigate(from && from !== "/login" ? from : "/", { replace: true });
		} catch (loginError) {
			setError(loginError instanceof ApiError ? loginError.message : "Could not sign in right now");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Center
			mih="100dvh"
			style={{
				background:
					"radial-gradient(circle at 20% 20%, var(--mantine-color-teal-light), transparent 55%), var(--mantine-color-body)",
			}}
		>
			<Container size={420} w="100%" px="md">
				<Card withBorder padding="xl" shadow="sm">
					<Stack gap="lg">
						<Stack gap="xs" align="center">
							<Avatar color="teal" radius="lg" size="lg">
								<IconQuote size={26} />
							</Avatar>
							<Title order={2}>Quotan</Title>
							<Text size="sm" c="dimmed" ta="center">
								A private library for the lines worth keeping.
							</Text>
						</Stack>
						<form onSubmit={(event) => void submit(event)}>
							<Stack>
								<PasswordInput
									label="Password"
									placeholder="Your password"
									value={password}
									onChange={(event) => setPassword(event.currentTarget.value)}
									leftSection={<IconLock size={16} />}
									autoFocus
									required
								/>
								{error && (
									<Alert color="red" variant="light">
										{error}
									</Alert>
								)}
								<Button type="submit" loading={submitting} disabled={!password}>
									Sign in
								</Button>
							</Stack>
						</form>
						<Text size="xs" c="dimmed" ta="center">
							One password, one library. The API key is only for the bot and scripts.
						</Text>
					</Stack>
				</Card>
			</Container>
		</Center>
	);
}
