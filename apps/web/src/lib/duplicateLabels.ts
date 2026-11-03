import type { DuplicateCategory } from "@quotan/shared";

/** User-facing labels. The API keeps `same_text` for compatibility. */
export const DUPLICATE_CATEGORY_LABELS: Record<DuplicateCategory, string> = {
	exact: "Exact",
	same_text: "Different author",
	likely: "Likely",
	similar: "Similar",
};

export const DUPLICATE_CATEGORY_COLORS: Record<
	DuplicateCategory,
	"red" | "orange" | "yellow" | "grape"
> = {
	exact: "red",
	same_text: "orange",
	likely: "yellow",
	similar: "grape",
};
