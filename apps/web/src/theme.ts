import { createTheme, rem } from "@mantine/core";

export const theme = createTheme({
	primaryColor: "teal",
	primaryShade: { light: 7, dark: 5 },
	fontFamily: "Inter Variable, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	headings: {
		fontFamily: "Inter Variable, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
		fontWeight: "650",
	},
	defaultRadius: "md",
	components: {
		Button: {
			defaultProps: { radius: "md" },
		},
		Card: {
			defaultProps: { radius: "lg" },
		},
		Paper: {
			defaultProps: { radius: "lg" },
		},
		Modal: {
			defaultProps: { radius: "lg", centered: true },
		},
		Drawer: {
			defaultProps: { radius: "lg" },
		},
	},
});

export const QUOTE_FONT = "'Lora Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";

export const SPACING = {
	header: rem(60),
	bottomNav: rem(68),
};
