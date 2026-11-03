import { useMediaQuery } from "@mantine/hooks";

export function useIsMobile(): boolean {
	return useMediaQuery("(max-width: 61.99em)") ?? false;
}

export function useIsDesktop(): boolean {
	return useMediaQuery("(min-width: 62em)") ?? false;
}
