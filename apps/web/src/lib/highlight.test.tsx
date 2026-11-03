import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightText } from "./highlight";

describe("highlightText", () => {
	it("returns plain text without a query", () => {
		expect(highlightText("hello world", undefined)).toBe("hello world");
	});

	it("marks query tokens case-insensitively", () => {
		const markup = renderToStaticMarkup(highlightText("The unexamined life", "UNEXAMINED life"));
		expect(markup).toContain("<mark>unexamined</mark>");
		expect(markup).toContain("<mark>life</mark>");
	});

	it("does not mark single-character tokens", () => {
		const markup = renderToStaticMarkup(highlightText("a life", "a"));
		expect(markup).not.toContain("<mark>");
	});
});
