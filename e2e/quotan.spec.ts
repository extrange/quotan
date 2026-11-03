import { expect, test } from "@playwright/test";

test("core quote workflow", async ({ page, request }) => {
	for (let index = 0; index < 12; index += 1) {
		const created = await request.post("/api/quotes", {
			headers: { "x-api-key": "e2e-api-key-0123456789" },
			data: {
				text: `Window scroll quote ${index}`,
				author: `Window Author ${index}`,
				starred: true,
			},
		});
		expect(created.ok()).toBe(true);
	}

	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Quotan" })).toBeVisible();
	await page.locator("input[type=password]").fill("quotan");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();

	await page.getByRole("button", { name: "Add quote" }).first().click();
	await expect(page).toHaveURL(/\/add$/);
	await expect(page.getByRole("heading", { name: "Add a quote" })).toBeVisible();
	const quoteInput = page.getByRole("textbox", { name: "Quote" });
	await quoteInput.fill(
		"It is not death that a man should fear, but he should fear never beginning to live.",
	);
	await expect(quoteInput).toHaveValue(/death that a man/);
	await page.getByLabel("Author").fill("Marcus Aurelius");
	await expect(page.getByText("Possible duplicates")).toBeVisible();
	await page.getByRole("button", { name: "Add quote", exact: true }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.getByLabel("Search quotes").fill("death");
	await expect(page.getByText("It is not death that a man should fear")).toBeVisible();

	await page.getByText("It is not death that a man should fear").click();
	await expect(page.getByText("Find similar")).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("link", { name: "Today" }).click();
	await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
	const record = page.getByRole("button", { name: "Record as sent" });
	await expect(record).toBeVisible({ timeout: 15_000 });
	await record.click();
	await expect(page.getByText("Dropped automatically")).toBeVisible();
	await expect(page.getByText(/^Sent /)).toBeVisible();
	await page.getByRole("button", { name: "Keep as Starred" }).click();
	await expect(page.getByText("Kept as Starred").first()).toBeVisible();

	await page.getByRole("link", { name: "Sent" }).click();
	await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
	await expect(page.getByText("Marcus Aurelius")).toBeVisible();

	await page.getByRole("link", { name: "Stats" }).click();
	await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
	await expect(page.getByText("Embedding index")).toBeVisible();

	await page.getByRole("link", { name: "Quotes" }).click();
	await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();
	await expect(page.getByText("Window scroll quote 11")).toBeVisible();
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await expect(page.getByText("Window scroll quote 0")).toBeVisible();
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	const nestedScroll = await page.evaluate(() => {
		let element = document.querySelector(".quote-card");
		while (element) {
			const overflowY = getComputedStyle(element).overflowY;
			if (
				(overflowY === "auto" || overflowY === "scroll") &&
				element.scrollHeight > element.clientHeight
			) {
				return true;
			}
			element = element.parentElement;
		}
		return false;
	});
	expect(nestedScroll).toBe(false);
});

test("jumps to the last quote while keeping the list virtualized", async ({ page, request }) => {
	const author = "Jump To End Author";
	const quoteCount = 120;
	for (let index = 0; index < quoteCount; index += 1) {
		const created = await request.post("/api/quotes", {
			headers: { "x-api-key": "e2e-api-key-0123456789" },
			data: { text: `Jump to end quote ${index}`, author },
		});
		expect(created.ok()).toBe(true);
	}

	await page.goto("/login");
	if (page.url().includes("/login")) {
		await page.locator("input[type=password]").fill("quotan");
		await page.getByRole("button", { name: "Sign in" }).click();
	}
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();

	await page.getByPlaceholder("Filter author").fill(author);
	await expect(page.getByText(`${quoteCount} quotes`)).toBeVisible();
	await expect(
		page.getByText(`Jump to end quote ${quoteCount - 1}`, { exact: true }),
	).toBeVisible();
	await expect(page.getByText("Jump to end quote 0", { exact: true })).toHaveCount(0);

	await page.evaluate(() => window.scrollTo(0, 1200));
	await expect(page.getByLabel("Search quotes")).toBeInViewport();

	await page.getByRole("button", { name: "Jump to end", exact: true }).click();
	await expect(page.getByText("Jump to end quote 0", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	expect(await page.locator(".quote-card").count()).toBeLessThan(20);
});

test("paste import inserts rows directly", async ({ page }) => {
	await page.goto("/login");
	if (page.url().includes("/login")) {
		await page.locator("input[type=password]").fill("quotan");
		await page.getByRole("button", { name: "Sign in" }).click();
	}
	await page.goto("/import-export");
	await expect(page.getByRole("heading", { name: "Format guide" })).toBeVisible();
	await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
	await page
		.getByLabel("Paste text")
		.fill(
			"The only way out is through. — Robert Frost\nIt is not death that a man should fear, but he should fear never beginning to live. — Marcus Aurelius",
		);
	await page.getByRole("button", { name: "Use pasted text" }).click();
	await page.getByRole("button", { name: "Import 2 rows" }).click();
	await expect(page.getByText("Import complete")).toBeVisible();
	await page.getByRole("button", { name: "Review duplicates" }).click();
	await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();
	await page.goto("/");
	await page.getByLabel("Search quotes").fill("Robert Frost");
	await expect(page.getByText("The only way out is through.")).toBeVisible();
});

test("dropped archive blocks exact re-import and restores", async ({ page, request }) => {
	const headers = { "x-api-key": "e2e-api-key-0123456789" };
	const text = "An archived quote about second chances and patient work.";
	const created = await request.post("/api/quotes", {
		headers,
		data: { text, author: "Archive Author" },
	});
	expect(created.ok()).toBe(true);
	const id = ((await created.json()) as { id: number }).id;
	expect((await request.delete(`/api/quotes/${id}`, { headers })).ok()).toBe(true);

	const skipped = await request.post("/api/import", {
		headers,
		data: { batchId: `e2e-dropped-${id}`, rows: [{ text, author: "Archive Author" }] },
	});
	expect(skipped.ok()).toBe(true);
	const report = (await skipped.json()) as { imported: number; skippedDropped: number };
	expect(report.imported).toBe(0);
	expect(report.skippedDropped).toBe(1);

	await page.goto("/login");
	if (page.url().includes("/login")) {
		await page.locator("input[type=password]").fill("quotan");
		await page.getByRole("button", { name: "Sign in" }).click();
	}
	await page.goto("/dropped");
	await expect(page.getByRole("heading", { name: "Dropped" })).toBeVisible();
	await expect(page.getByText(text)).toBeVisible();
	await page.getByRole("button", { name: `Restore ${id}` }).click();
	await page.getByRole("menuitem", { name: "Starred" }).click();
	await expect(page.getByText("Restored as Starred")).toBeVisible();
	await expect(page.getByText(text)).toHaveCount(0);

	await page.goto("/");
	await page.getByLabel("Search quotes").fill("second chances");
	await expect(page.getByText(text)).toBeVisible();
});

test("PWA manifest and API health", async ({ page, request }) => {
	const manifest = await request.get("/manifest.webmanifest");
	expect(manifest.ok()).toBe(true);
	const body = (await manifest.json()) as { name: string; icons: unknown[] };
	expect(body.name).toBe("Quotan");
	expect(body.icons.length).toBeGreaterThanOrEqual(3);

	const health = await request.get("/api/healthz");
	expect(health.ok()).toBe(true);
	await page.goto("/login");
	await expect(page.getByText("Quotan")).toBeVisible();
});

test("duplicate detection tab", async ({ page, request }) => {
	const headers = { "x-api-key": "e2e-api-key-0123456789" };
	for (let i = 0; i < 2; i += 1) {
		const created = await request.post("/api/quotes", {
			headers,
			data: {
				text: "A house divided against itself cannot stand.",
				author: "Abraham Lincoln",
			},
		});
		expect(created.ok()).toBe(true);
	}

	await page.goto("/login");
	if (page.url().includes("/login")) {
		await page.locator("input[type=password]").fill("quotan");
		await page.getByRole("button", { name: "Sign in" }).click();
	}
	await page.getByRole("link", { name: "Duplicates" }).click();
	await expect(page).toHaveURL(/\/duplicates$/);
	await expect(page.getByRole("heading", { name: "Duplicates" })).toBeVisible();
	await expect(page.getByText("Exact", { exact: true }).first()).toBeVisible();
	await expect(
		page.getByText("A house divided against itself cannot stand.").first(),
	).toBeVisible();
});

test("marks duplicate quotes for deletion and deletes them", async ({ page, request }) => {
	const headers = { "x-api-key": "e2e-api-key-0123456789" };
	const text =
		"A ship in harbor is safe, but that is not what ships are built for. Ships are safest in the harbor, but that is not what ships are built for; they are built to sail, to weather storms, to cross unknown waters, and to return with stories worth telling. The measure of a ship is not how long it remains at anchor, but how faithfully it carries its crew through the open sea.";
	const author = "John A. Shedd";
	const ids: number[] = [];
	for (let i = 0; i < 3; i += 1) {
		const created = await request.post("/api/quotes", {
			headers,
			data: { text, author },
		});
		expect(created.ok()).toBe(true);
		ids.push(((await created.json()) as { id: number }).id);
	}
	for (let group = 0; group < 10; group += 1) {
		for (let copy = 0; copy < 2; copy += 1) {
			const created = await request.post("/api/quotes", {
				headers,
				data: {
					text: `Sticky header duplicate ${group}`,
					author: `Sticky Author ${group}`,
				},
			});
			expect(created.ok()).toBe(true);
		}
	}

	await page.goto("/login");
	if (page.url().includes("/login")) {
		await page.locator("input[type=password]").fill("quotan");
		await page.getByRole("button", { name: "Sign in" }).click();
	}
	await page.getByRole("link", { name: "Duplicates" }).click();
	await expect(page).toHaveURL(/\/duplicates$/);

	const group = page
		.getByRole("region", { name: "Exact duplicate group" })
		.filter({ hasText: text });
	await expect(group).toBeVisible();
	const oldest = group.getByRole("button", {
		name: `Mark quote ${ids[0]} by ${author} for archiving`,
	});
	const newer = group.getByRole("button", {
		name: `Mark quote ${ids[1]} by ${author} for archiving`,
	});
	const third = group.getByRole("button", {
		name: `Mark quote ${ids[2]} by ${author} for archiving`,
	});
	const oldestCard = group.locator(`[data-quote-id="${ids[0]}"]`);
	const deleteButton = page.getByRole("button", { name: /Archive selected/ });
	const clearButton = group.getByRole("button", { name: "Clear" });
	await expect(oldest).toHaveAttribute("aria-pressed", "false");
	await expect(newer).toHaveAttribute("aria-pressed", "false");
	await expect(clearButton).toBeDisabled();
	await expect(deleteButton).toBeDisabled();

	await expect(group.getByText(text, { exact: true }).first()).toHaveAttribute("title", text);

	await oldest.click();
	await expect(oldest).toHaveAttribute("aria-pressed", "true");
	await expect(oldestCard).toHaveAttribute("data-selected", "true");
	await expect(deleteButton).toBeEnabled();
	await expect(deleteButton).toHaveText(/\(1\)/);

	await newer.click();
	await expect(newer).toHaveAttribute("aria-pressed", "true");
	await expect(oldest).toHaveAttribute("aria-pressed", "true");
	await expect(deleteButton).toHaveText(/\(2\)/);

	const editButton = group.getByRole("button", { name: `Edit quote ${ids[1]}` });
	await expect(editButton).toBeVisible();
	const quoteBox = await newer.boundingBox();
	const editBox = await editButton.boundingBox();
	expect(quoteBox).not.toBeNull();
	expect(editBox).not.toBeNull();
	expect(editBox?.x ?? 0).toBeGreaterThan((quoteBox?.x ?? 0) + (quoteBox?.width ?? 0) - 10);

	await clearButton.click();
	await expect(oldest).toHaveAttribute("aria-pressed", "false");
	await expect(newer).toHaveAttribute("aria-pressed", "false");
	await expect(deleteButton).toBeDisabled();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	await group.getByRole("button", { name: "Ignore" }).click();
	await expect(page.getByText("Duplicate group ignored")).toBeVisible();
	await expect(group).toHaveCount(0);
	await page.getByText(/^Ignored \d+$/).click();
	await expect(group).toBeVisible();
	await group.getByRole("button", { name: "Unignore" }).click();
	await expect(page.getByText("Duplicate group unignored")).toBeVisible();
	await expect(group).toHaveCount(0);
	await page.getByText(/^All \d+$/).click();
	await expect(group).toBeVisible();

	await newer.click();
	await third.click();
	await expect(deleteButton).toHaveText(/\(2\)/);

	const header = page.getByTestId("duplicates-header");
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await expect.poll(async () => (await header.boundingBox())?.y ?? -1).toBe(60);
	await expect(deleteButton).toBeInViewport();
	await deleteButton.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: /Archive .* quotes?/ }).click();
	await expect(page.getByText(/moved to Dropped/)).toBeVisible();
	await expect(group).toHaveCount(0);

	const remaining = await request.get(
		`/api/quotes?author=${encodeURIComponent(author)}&limit=100`,
		{ headers },
	);
	expect(remaining.ok()).toBe(true);
	const remainingBody = (await remaining.json()) as {
		items: Array<{ id: number }>;
		total: number;
	};
	expect(remainingBody.total).toBe(1);
	expect(remainingBody.items[0]?.id).toBe(ids[0]);
});
