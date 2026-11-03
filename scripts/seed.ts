import { loadConfig } from "../apps/api/src/config.js";
import { openDatabase } from "../apps/api/src/db/index.js";
import { createQuote } from "../apps/api/src/db/quotes.js";

const samples = [
	["The unexamined life is not worth living.", "Socrates", true],
	[
		"We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
		"Aristotle",
		false,
	],
	[
		"It is not death that a man should fear, but he should fear never beginning to live.",
		"Marcus Aurelius",
		true,
	],
	["The only way out is through.", "Robert Frost", false],
	["What we think, we become.", "Buddha", false],
	["Simplicity is the ultimate sophistication.", "Leonardo da Vinci", false],
	["The journey of a thousand miles begins with one step.", "Lao Tzu", false],
	["Whether you think you can or you think you can't, you're right.", "Henry Ford", true],
	["In the middle of difficulty lies opportunity.", "Albert Einstein", false],
	[
		"To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.",
		"Ralph Waldo Emerson",
		false,
	],
];

const config = loadConfig();
const handle = openDatabase(config.databasePath);
try {
	const existing = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM quotes").get() as {
		count: number;
	};
	if (existing.count > 0) {
		console.log(`Database already has ${existing.count} quotes; not seeding.`);
		process.exit(0);
	}
	for (const [text, author, starred] of samples) {
		createQuote(handle, {
			text: text as string,
			author: author as string,
			status: starred ? "starred" : "inbox",
		});
	}
	console.log(`Seeded ${samples.length} quotes.`);
} finally {
	handle.close();
}
