import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "prompt",
			includeAssets: ["icon.svg", "apple-touch-icon.png", "pwa-192.png", "pwa-512.png"],
			manifest: {
				name: "Quotan",
				short_name: "Quotes",
				description: "A private quote library with hybrid search and a daily quote rotation.",
				theme_color: "#0f766e",
				background_color: "#f8f5ef",
				display: "standalone",
				orientation: "any",
				start_url: "/",
				scope: "/",
				icons: [
					{ src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
					{
						src: "/pwa-maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
				navigateFallback: "/index.html",
				runtimeCaching: [
					{
						urlPattern: ({ url, request }) =>
							request.method === "GET" &&
							(url.pathname === "/api/quotes" ||
								url.pathname.startsWith("/api/quotes?") ||
								url.pathname === "/api/stats"),
						handler: "NetworkFirst",
						options: {
							cacheName: "quotan-api",
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
						},
					},
				],
			},
			devOptions: { enabled: false },
		}),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:3000",
				changeOrigin: false,
			},
		},
	},
	build: {
		outDir: "dist",
		sourcemap: false,
	},
});
