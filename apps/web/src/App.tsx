import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { lazy, Suspense, useEffect, useRef } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RequireAuth } from "@/auth/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { RouteError } from "@/components/RouteError";
import { AddQuotePage } from "@/pages/AddQuotePage";
import { DroppedPage } from "@/pages/DroppedPage";
import { DuplicatesPage } from "@/pages/DuplicatesPage";
import { ImportExportPage } from "@/pages/ImportExportPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { QuotesPage } from "@/pages/QuotesPage";
import { SentPage } from "@/pages/SentPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TodayPage } from "@/pages/TodayPage";

const StatsPage = lazy(() => import("@/pages/StatsPage"));

function StatsRoute() {
	return (
		<Suspense fallback={<Text p="md">Loading statistics…</Text>}>
			<StatsPage />
		</Suspense>
	);
}

const router = createBrowserRouter([
	{ path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
	{
		path: "/",
		element: <RequireAuth />,
		errorElement: <RouteError />,
		children: [
			{
				element: <AppLayout />,
				children: [
					{ index: true, element: <QuotesPage /> },
					{ path: "add", element: <AddQuotePage /> },
					{ path: "duplicates", element: <DuplicatesPage /> },
					{ path: "dropped", element: <DroppedPage /> },
					{ path: "today", element: <TodayPage /> },
					{ path: "sent", element: <SentPage /> },
					{ path: "stats", element: <StatsRoute /> },
					{ path: "import-export", element: <ImportExportPage /> },
					{ path: "settings", element: <SettingsPage /> },
					{ path: "*", element: <NotFoundPage /> },
				],
			},
		],
	},
]);

function PwaUpdater() {
	const shown = useRef(false);
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		onRegisteredSW(_swUrl, registration) {
			if (!registration) return;
			setInterval(() => void registration.update(), 60 * 60 * 1000);
		},
	});
	useEffect(() => {
		if (!needRefresh || shown.current) return;
		shown.current = true;
		notifications.show({
			id: "pwa-update",
			title: "Update available",
			autoClose: false,
			withCloseButton: true,
			color: "teal",
			onClose: () => setNeedRefresh(false),
			message: (
				<Stack gap="xs">
					<Text size="sm">A new version of Quotan is ready.</Text>
					<Group>
						<Button
							size="xs"
							onClick={() => {
								setNeedRefresh(false);
								void updateServiceWorker(true);
							}}
						>
							Reload
						</Button>
					</Group>
				</Stack>
			),
		});
	}, [needRefresh, setNeedRefresh, updateServiceWorker]);
	return null;
}

export function App() {
	return (
		<>
			<PwaUpdater />
			<RouterProvider router={router} />
		</>
	);
}
