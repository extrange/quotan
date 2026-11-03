import { expect, test } from "@playwright/test";

test.describe("mobile navigation", () => {
	test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

	test("shows the duplicates tab without horizontal overflow", async ({ page, request }) => {
		for (let i = 0; i < 2; i += 1) {
			const created = await request.post("/api/quotes", {
				headers: { "x-api-key": "e2e-api-key-0123456789" },
				data: {
					text: "Two roads diverged in a wood, and I took the one less traveled by.",
					author: "Robert Frost",
					starred: true,
				},
			});
			expect(created.ok()).toBe(true);
		}
		await page.goto("/login");
		if (page.url().includes("/login")) {
			await page.locator("input[type=password]").fill("quotan");
			await page.getByRole("button", { name: "Sign in" }).click();
		}
		const duplicates = page.getByRole("link", { name: "Duplicates" });
		await expect(duplicates).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
		).toBe(true);
		await duplicates.click();
		await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();
		await expect(page.getByText("Exact", { exact: true }).first()).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
		).toBe(true);
	});
});
