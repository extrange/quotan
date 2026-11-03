import {
	Accordion,
	Alert,
	Button,
	Card,
	Code,
	Group,
	SegmentedControl,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Textarea,
	Title,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import type { ActiveQuoteStatus, ImportReport, ImportRowInput } from "@quotan/shared";
import {
	IconAlertTriangle,
	IconCheck,
	IconCloudUpload,
	IconDatabaseExport,
	IconDownload,
	IconFileImport,
	IconFileSpreadsheet,
	IconInfoCircle,
	IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { formatNumber, pluralize } from "@/lib/format";

type Field = "text" | "author" | "status" | "createdAt";

const FIELD_LABELS: Record<Field, string> = {
	text: "Quote text",
	author: "Author",
	status: "Status",
	createdAt: "Created date",
};

const AUTO_MATCH: Record<Field, RegExp> = {
	text: /quote|text|content|body/i,
	author: /author|by|attribution/i,
	status: /status|state|starred|star|favorite|fav|private/i,
	createdAt: /date|created|added/i,
};

const CSV_EXAMPLE = `quote,author,status,created_at
"The unexamined life is not worth living.",Socrates,starred,2026-01-01
"Simplicity is the ultimate sophistication.",Leonardo da Vinci,inbox,`;

const JSON_EXAMPLE = `[
  {
    "text": "The unexamined life is not worth living.",
    "author": "Socrates",
    "status": "starred",
    "createdAt": "2026-01-01"
  }
]`;

const PASTE_EXAMPLE = `The unexamined life is not worth living. — Socrates
We are what we repeatedly do. | Aristotle`;

const CODE_BLOCK_STYLE = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

function parseStatus(value: unknown): ActiveQuoteStatus | undefined {
	if (typeof value === "boolean") return value ? "starred" : "inbox";
	if (typeof value === "number") return value !== 0 ? "starred" : "inbox";
	if (typeof value !== "string" || !value.trim()) return undefined;
	const normalized = value.trim().toLowerCase();
	if (["true", "1", "yes", "y", "starred"].includes(normalized)) return "starred";
	if (["false", "0", "no", "n", "unstarred", "inbox"].includes(normalized)) return "inbox";
	if (normalized === "private") return "private";
	return undefined;
}

function rowsFromRaw(
	rawRows: Array<Record<string, unknown>>,
	mapping: Partial<Record<Field, string>>,
): ImportRowInput[] {
	return rawRows.map((raw) => {
		const text = String(raw[mapping.text ?? ""] ?? "").trim();
		const author = String(raw[mapping.author ?? ""] ?? "").trim();
		const status = parseStatus(raw[mapping.status ?? ""]);
		const createdAt = mapping.createdAt
			? String(raw[mapping.createdAt] ?? "").trim() || undefined
			: undefined;
		return { text, author, status, createdAt };
	});
}

function rowsFromJson(value: unknown): ImportRowInput[] {
	const list = Array.isArray(value)
		? value
		: Array.isArray((value as { quotes?: unknown })?.quotes)
			? ((value as { quotes: unknown[] }).quotes ?? [])
			: null;
	if (!list) throw new Error("JSON must be an array of quotes or an export with a quotes array");
	return list.map((item) => {
		const record = item as Record<string, unknown>;
		return {
			text: String(record.text ?? record.quote ?? record.content ?? "").trim(),
			author: String(record.author ?? record.by ?? "").trim(),
			status: parseStatus(record.status) ?? parseStatus(record.starred),
			createdAt:
				typeof record.createdAt === "string"
					? record.createdAt
					: typeof record.created_at === "string"
						? record.created_at
						: undefined,
		};
	});
}

function rowsFromPaste(text: string): ImportRowInput[] {
	return text
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			let parts = line.split("\t");
			if (parts.length < 2) parts = line.split(/\s+[—–-]\s+/u);
			if (parts.length < 2) parts = line.split(/\s*\|\s*/u);
			return {
				text: (parts[0] ?? "").trim(),
				author: (parts.slice(1).join(" ") ?? "").trim() || "Unknown",
			};
		});
}

export function ImportExportPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
	const [headers, setHeaders] = useState<string[]>([]);
	const [rows, setRows] = useState<ImportRowInput[]>([]);
	const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
	const [sourceName, setSourceName] = useState<string | null>(null);
	const [pasteText, setPasteText] = useState("");
	const [batchId, setBatchId] = useState<string | null>(null);
	const [report, setReport] = useState<ImportReport | null>(null);
	const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
	const [exportStatus, setExportStatus] = useState<"all" | ActiveQuoteStatus>("all");

	const commitMutation = useMutation({
		mutationFn: () => {
			const id = batchId ?? crypto.randomUUID();
			setBatchId(id);
			return api.importCommit({ batchId: id, rows });
		},
		onSuccess: (data) => {
			setReport(data);
			void queryClient.invalidateQueries({ queryKey: ["quotes"] });
			void queryClient.invalidateQueries({ queryKey: ["search"] });
			void queryClient.invalidateQueries({ queryKey: ["stats"] });
			void queryClient.invalidateQueries({ queryKey: ["index"] });
			void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
			notifications.show({
				color: "teal",
				icon: <IconCheck size={16} />,
				message: `Imported ${data.imported} quotes`,
			});
		},
		onError: (error: unknown) =>
			notifications.show({
				color: "red",
				title: "Import failed",
				message: error instanceof ApiError ? error.message : "Unknown error",
			}),
	});

	const handleFiles = async (files: File[]) => {
		const file = files[0];
		if (!file) return;
		setSourceName(file.name);
		setReport(null);
		setBatchId(null);
		const extension = file.name.split(".").pop()?.toLowerCase();
		if (extension === "json") {
			try {
				const parsed = JSON.parse(await file.text());
				const nextRows = rowsFromJson(parsed);
				setRows(nextRows);
				setRawRows([]);
				setHeaders([]);
				setMapping({});
			} catch (error) {
				notifications.show({
					color: "red",
					title: "Invalid JSON",
					message: error instanceof Error ? error.message : "Could not parse file",
				});
			}
			return;
		}
		Papa.parse<Record<string, unknown>>(file, {
			header: true,
			skipEmptyLines: true,
			complete: (result) => {
				const nextHeaders = result.meta.fields ?? [];
				const nextMapping: Partial<Record<Field, string>> = {};
				for (const field of Object.keys(AUTO_MATCH) as Field[]) {
					const match = nextHeaders.find((header) => AUTO_MATCH[field].test(header));
					if (match) nextMapping[field] = match;
				}
				setRawRows(result.data);
				setHeaders(nextHeaders);
				setMapping(nextMapping);
				setRows(rowsFromRaw(result.data, nextMapping));
			},
			error: (error) => {
				notifications.show({
					color: "red",
					title: "Could not parse CSV",
					message: error.message,
				});
			},
		});
	};

	const updateMapping = (field: Field, header: string | null) => {
		const next = { ...mapping, [field]: header ?? undefined };
		setMapping(next);
		setRows(rowsFromRaw(rawRows, next));
		setReport(null);
		setBatchId(null);
	};

	const handlePaste = () => {
		const nextRows = rowsFromPaste(pasteText);
		setRows(nextRows);
		setRawRows([]);
		setHeaders([]);
		setMapping({});
		setSourceName("pasted text");
		setReport(null);
		setBatchId(null);
	};

	const filteredRows = useMemo(() => rows.filter((row) => row.text.trim()), [rows]);

	const resetImport = () => {
		setRawRows([]);
		setHeaders([]);
		setRows([]);
		setMapping({});
		setSourceName(null);
		setPasteText("");
		setReport(null);
		setBatchId(null);
	};

	return (
		<div className="page-container" style={{ maxWidth: 1000 }}>
			<Title order={2}>Import / Export</Title>
			<Text size="sm" c="dimmed" mb="lg">
				Bring an existing list in safely, or take a portable copy out.
			</Text>

			<Tabs defaultValue="import">
				<Tabs.List mb="md">
					<Tabs.Tab value="import" leftSection={<IconFileImport size={15} />}>
						Import
					</Tabs.Tab>
					<Tabs.Tab value="export" leftSection={<IconFileSpreadsheet size={15} />}>
						Export
					</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="import">
					<Stack gap="md">
						<Card withBorder padding="md">
							<Group gap="xs" mb={4}>
								<IconInfoCircle size={18} />
								<Title order={4}>Format guide</Title>
							</Group>
							<Text size="sm" c="dimmed" mb="sm">
								Files are parsed in your browser. The quote text is the only required field; author
								defaults to “Unknown” and status defaults to Inbox. Exact duplicates of active or
								Dropped quotes are skipped. Click a format for an example.
							</Text>
							<Accordion variant="contained" defaultValue="csv">
								<Accordion.Item value="csv">
									<Accordion.Control>CSV</Accordion.Control>
									<Accordion.Panel>
										<Stack gap="xs">
											<Text size="sm">
												Comma-separated with a header row and UTF-8 encoding. The quote-text column
												is required; author, status, and created date are optional. Column names are
												auto-detected and can be remapped in step 2.
											</Text>
											<Code block style={CODE_BLOCK_STYLE}>
												{CSV_EXAMPLE}
											</Code>
											<Text size="xs" c="dimmed">
												Wrap values containing commas, double quotes, or newlines in double quotes
												and double any internal quotes.
											</Text>
											<Text size="xs" c="dimmed">
												Common headers: quote/text/content/body, author/by/attribution,
												status/starred/private, date/created/added.
											</Text>
										</Stack>
									</Accordion.Panel>
								</Accordion.Item>
								<Accordion.Item value="json">
									<Accordion.Control>JSON</Accordion.Control>
									<Accordion.Panel>
										<Stack gap="xs">
											<Text size="sm">
												Use a bare array or an object with a <Code>quotes</Code> array. Each quote
												needs <Code>text</Code>; <Code>author</Code>, <Code>status</Code>, and{" "}
												<Code>createdAt</Code> (or <Code>created_at</Code>) are optional. The
												aliases <Code>quote</Code>/<Code>content</Code>, <Code>by</Code>, and the
												legacy <Code>starred</Code> boolean are also accepted.
											</Text>
											<Code block style={CODE_BLOCK_STYLE}>
												{JSON_EXAMPLE}
											</Code>
										</Stack>
									</Accordion.Panel>
								</Accordion.Item>
								<Accordion.Item value="paste">
									<Accordion.Control>Pasted text</Accordion.Control>
									<Accordion.Panel>
										<Stack gap="xs">
											<Text size="sm">
												One quote per line. Separate the author with a tab, em dash, en dash, a
												hyphen surrounded by spaces, or a pipe. Without a separator, the author is
												recorded as “Unknown”.
											</Text>
											<Code block style={CODE_BLOCK_STYLE}>
												{PASTE_EXAMPLE}
											</Code>
										</Stack>
									</Accordion.Panel>
								</Accordion.Item>
								<Accordion.Item value="fields">
									<Accordion.Control>Field values</Accordion.Control>
									<Accordion.Panel>
										<Stack gap={6}>
											<Text size="sm">
												<strong>Text</strong> — required.
											</Text>
											<Text size="sm">
												<strong>Author</strong> — optional; defaults to “Unknown”.
											</Text>
											<Text size="sm">
												<strong>Status</strong> — <Code>starred</Code>, <Code>inbox</Code>, or{" "}
												<Code>private</Code>. Legacy values <Code>true/1/yes/y/starred</Code> map to
												Starred and <Code>false/0/no/n/unstarred</Code> map to Inbox. Dropped rows
												are never imported.
											</Text>
											<Text size="sm">
												<strong>Created date</strong> — ISO 8601, such as <Code>2026-01-01</Code> or{" "}
												<Code>2026-01-01T00:00:00Z</Code>. Invalid dates use the import time and
												produce a warning.
											</Text>
											<Text size="sm">
												<strong>Ignored</strong> — <Code>id</Code>, <Code>updatedAt</Code>,{" "}
												<Code>lastSentAt</Code>, and <Code>sentCount</Code>. Import does not restore
												sent history; use a SQLite backup for that.
											</Text>
										</Stack>
									</Accordion.Panel>
								</Accordion.Item>
							</Accordion>
						</Card>

						<Card withBorder padding="md">
							<Title order={4} mb={4}>
								1. Choose a source
							</Title>
							<Text size="sm" c="dimmed" mb="md">
								Upload a CSV or JSON file, or paste one quote per line. Exact duplicates are
								skipped; near and semantic duplicates remain for review in the Duplicates tab.
							</Text>
							<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
								<Dropzone
									onDrop={(files) => void handleFiles(files)}
									accept={["text/csv", "application/json", ".csv", ".json"]}
									maxFiles={1}
									p="lg"
								>
									<Group justify="center" gap="sm" mih={90} style={{ pointerEvents: "none" }}>
										<IconCloudUpload size={34} className="muted" />
										<div>
											<Text fw={600}>Drop a CSV or JSON file</Text>
											<Text size="xs" c="dimmed">
												CSV needs a header row · or click to browse
											</Text>
										</div>
									</Group>
								</Dropzone>
								<Stack gap="xs">
									<Textarea
										label="Paste text"
										description="One quote per line. Author after a tab, em dash, en dash, spaced hyphen, or pipe."
										placeholder={
											"The unexamined life is not worth living. — Socrates\nWe are what we repeatedly do. — Aristotle"
										}
										minRows={4}
										value={pasteText}
										onChange={(event) => setPasteText(event.currentTarget.value)}
									/>
									<Button
										variant="light"
										onClick={handlePaste}
										disabled={!pasteText.trim()}
										leftSection={<IconRefresh size={15} />}
									>
										Use pasted text
									</Button>
								</Stack>
							</SimpleGrid>
							{sourceName && (
								<Text size="xs" c="dimmed" mt="sm">
									Loaded {sourceName} · {pluralize(rows.length, "row")} ·{" "}
									{formatNumber(filteredRows.length)} with text
								</Text>
							)}
						</Card>

						{headers.length > 0 && (
							<Card withBorder padding="md">
								<Title order={4} mb="xs">
									2. Map columns
								</Title>
								<SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
									{(Object.keys(FIELD_LABELS) as Field[]).map((field) => (
										<Select
											key={field}
											label={FIELD_LABELS[field]}
											placeholder={field === "text" ? "Required" : "Not imported"}
											data={headers.map((header) => ({ value: header, label: header }))}
											value={mapping[field] ?? null}
											onChange={(value) => updateMapping(field, value)}
											clearable
										/>
									))}
								</SimpleGrid>
								{!mapping.text && (
									<Alert color="orange" mt="sm" icon={<IconAlertTriangle size={16} />}>
										Choose the column containing the quote text.
									</Alert>
								)}
							</Card>
						)}

						<Card withBorder padding="md">
							<Group justify="space-between" align="flex-end" wrap="wrap">
								<div>
									<Title order={4}>3. Import</Title>
									<Text size="sm" c="dimmed">
										Exact duplicates of active or Dropped quotes are skipped. Near and semantic
										matches remain; review them in the Duplicates tab afterward.
									</Text>
								</div>
								<Button
									onClick={() => commitMutation.mutate()}
									loading={commitMutation.isPending}
									disabled={filteredRows.length === 0 || Boolean(report)}
									leftSection={<IconDatabaseExport size={16} />}
								>
									Import {pluralize(filteredRows.length, "row")}
								</Button>
							</Group>
							{report && (
								<Alert mt="md" color="teal" icon={<IconCheck size={18} />} title="Import complete">
									Imported {report.imported} {report.imported === 1 ? "quote" : "quotes"}.
									{report.invalid > 0 && ` ${report.invalid} invalid rows were skipped.`}
									{report.skippedDuplicates > 0 &&
										` ${report.skippedDuplicates} duplicates were skipped.`}
									{report.skippedDropped > 0 &&
										` ${report.skippedDropped} rows matched Dropped quotes and were skipped.`}{" "}
									Embeddings will fill in in the background.
									<Group mt="sm">
										<Button size="xs" variant="light" onClick={() => navigate("/duplicates")}>
											Review duplicates
										</Button>
									</Group>
								</Alert>
							)}
						</Card>

						{sourceName && (
							<Group justify="flex-end">
								<Button variant="subtle" color="gray" onClick={resetImport}>
									Reset import
								</Button>
							</Group>
						)}
					</Stack>
				</Tabs.Panel>

				<Tabs.Panel value="export">
					<Stack gap="md">
						<Card withBorder padding="md">
							<Title order={4} mb={4}>
								Quotes
							</Title>
							<Text size="sm" c="dimmed" mb="md">
								JSON keeps all metadata and is best for a round-trip. CSV is spreadsheet-friendly.
								Exports include active quotes only; Dropped stays in the archive and the backup.
							</Text>
							<Group align="flex-end" wrap="wrap">
								<Select
									label="Format"
									value={exportFormat}
									onChange={(value) => setExportFormat((value as "json" | "csv") ?? "json")}
									data={[
										{ value: "json", label: "JSON" },
										{ value: "csv", label: "CSV" },
									]}
									allowDeselect={false}
									w={150}
								/>
								<SegmentedControl
									value={exportStatus}
									onChange={(value) => setExportStatus(value as typeof exportStatus)}
									data={[
										{ label: "All", value: "all" },
										{ label: "Starred", value: "starred" },
										{ label: "Inbox", value: "inbox" },
										{ label: "Private", value: "private" },
									]}
								/>
								<Button
									leftSection={<IconDownload size={16} />}
									onClick={() =>
										void api.downloadQuotes(exportFormat, {
											status: exportStatus === "all" ? undefined : exportStatus,
										})
									}
								>
									Download quotes
								</Button>
							</Group>
						</Card>

						<Card withBorder padding="md">
							<Title order={4} mb={4}>
								Full database backup
							</Title>
							<Text size="sm" c="dimmed" mb="md">
								A consistent SQLite snapshot including Dropped quotes and delivery history. Stop the
								container before restoring it.
							</Text>
							<Button
								variant="light"
								leftSection={<IconDownload size={16} />}
								onClick={() => void api.downloadBackup()}
							>
								Download .sqlite backup
							</Button>
						</Card>

						<Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
							Export does not include API keys or environment secrets, and it excludes Dropped
							quotes. Import does not restore sent history; use the SQLite backup for that.
						</Alert>
					</Stack>
				</Tabs.Panel>
			</Tabs>
		</div>
	);
}
