import { Alert } from "@mantine/core";
import { IconCloudOff } from "@tabler/icons-react";
import { useOnline } from "@/hooks/useOnline";

export function OfflineBanner() {
	const online = useOnline();
	if (online) return null;
	return (
		<Alert
			color="yellow"
			variant="light"
			icon={<IconCloudOff size={18} />}
			style={{ borderRadius: 0 }}
		>
			You are offline. Cached pages are read-only until the connection returns.
		</Alert>
	);
}
