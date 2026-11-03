import { MantineProvider } from "@mantine/core";
import type { Quote } from "@quotan/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuoteCard } from "./QuoteCard";

const quote: Quote = {
	id: 1,
	text: "The unexamined life is not worth living.",
	author: "Socrates",
	status: "inbox",
	droppedAt: null,
	droppedFrom: null,
	dropSource: null,
	createdAt: "2026-10-31T00:00:00.000Z",
	updatedAt: "2026-10-31T00:00:00.000Z",
	lastSentAt: null,
	sentCount: 0,
};

function renderCard(overrides: Partial<Quote> = {}, query?: string) {
	const onOpen = vi.fn();
	const onToggleStar = vi.fn();
	render(
		<MantineProvider>
			<QuoteCard
				quote={{ ...quote, ...overrides }}
				query={query}
				onOpen={onOpen}
				onToggleStar={onToggleStar}
			/>
		</MantineProvider>,
	);
	return { onOpen, onToggleStar };
}

describe("QuoteCard", () => {
	it("renders the quote and author and highlights search terms", () => {
		renderCard({}, "unexamined");
		expect(screen.getByText("Socrates")).toBeInTheDocument();
		expect(screen.getByText("unexamined", { selector: "mark" })).toBeInTheDocument();
	});

	it("opens the quote when clicked", async () => {
		const { onOpen } = renderCard();
		await userEvent.click(screen.getByText("Socrates"));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("toggles the star without opening the quote", async () => {
		const { onOpen, onToggleStar } = renderCard();
		await userEvent.click(screen.getByRole("button", { name: "Star quote" }));
		expect(onToggleStar).toHaveBeenCalledTimes(1);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("shows the status badge and a matching star action", () => {
		renderCard({ status: "starred" });
		expect(screen.getByText("Starred")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Unstar quote" })).toBeInTheDocument();
	});

	it("shows Private without offering a Private toggle", () => {
		renderCard({ status: "private" });
		expect(screen.getByText("Private")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Star quote" })).toBeInTheDocument();
	});
});
