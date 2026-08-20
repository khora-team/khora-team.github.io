import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, type Entry } from "@retorquere/bibtex-parser";

const BIB_FILE = join(
    process.cwd(),
    "data",
    "publications.bib",
);

const OUTPUT_DIR = join(
    process.cwd(),
    "src",
    "content",
    "publications",
);

interface Creator {
    firstName?: string;
    lastName?: string;
    name?: string;
}

/**
 * Convert a BibTeX field value to a string.
 */
function fieldToString(value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }

    if (typeof value === "string" || typeof value === "number") {
        return String(value).trim();
    }

    if (Array.isArray(value)) {
        return value
            .map(fieldToString)
            .filter(Boolean)
            .join(", ");
    }

    if (typeof value === "object") {
        const creator = value as Creator;

        if (creator.name) {
            return creator.name.trim();
        }

        return [
            creator.firstName,
            creator.lastName,
        ]
            .filter(Boolean)
            .join(" ")
            .trim();
    }

    return "";
}

/**
 * Get a field from a BibTeX entry.
 */
function getField(
    entry: Entry,
    name: string,
): string {
    return fieldToString(entry.fields[name]);
}

/**
 * Extract authors from a BibTeX entry.
 */
function getAuthors(entry: Entry): string[] {
    const author = entry.fields.author;

    if (!author) {
        return [];
    }

    if (!Array.isArray(author)) {
        const value = fieldToString(author);

        return value ? [value] : [];
    }

    return author
        .map(fieldToString)
        .filter(Boolean);
}

/**
 * Escape a string for YAML frontmatter.
 */
function yamlString(value: string): string {
    return JSON.stringify(value);
}

/**
 * Generate a stable filename.
 *
 * HAL ID is preferred over the BibTeX citation key.
 */
function getFilename(entry: Entry): string {
    const halId =
        getField(entry, "hal_id") ||
        getField(entry, "halid");

    if (halId) {
        return `${halId
            .replace(/[^a-zA-Z0-9_-]/g, "-")
            .toLowerCase()}.md`;
    }

    return `${entry.key
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .toLowerCase()}.md`;
}

/**
 * Generate an Astro Markdown document from a BibTeX entry.
 */
function generateMarkdown(entry: Entry): string {
    const title =
        getField(entry, "title") ||
        "Untitled publication";

    const authors = getAuthors(entry);

    const year =
        getField(entry, "year");

    const venue =
        getField(entry, "journal") ||
        getField(entry, "booktitle") ||
        getField(entry, "publisher");

    const halId =
        getField(entry, "hal_id") ||
        getField(entry, "halid");

    const doi =
        getField(entry, "doi");

    const url =
        getField(entry, "url") ||
        (halId
            ? `https://hal.science/${halId}`
            : "");

    const pdf =
        getField(entry, "pdf");

    const abstract =
        getField(entry, "abstract");

    const type =
        getField(entry, "typdoc") ||
        entry.type;

    return `---
title: ${yamlString(title)}
authors:
${authors.length > 0
        ? authors
            .map((author) => `  - ${yamlString(author)}`)
            .join("\n")
        : '  - "Unknown"'}
year: ${year || "null"}
venue: ${yamlString(venue)}
halId: ${yamlString(halId)}
doi: ${yamlString(doi)}
url: ${yamlString(url)}
pdf: ${yamlString(pdf)}
type: ${yamlString(type)}
---

${abstract}
`;
}

/**
 * Remove previously generated Markdown files.
 */
async function cleanOutputDirectory(): Promise<void> {
    await mkdir(OUTPUT_DIR, {
        recursive: true,
    });

    const files = await readdir(OUTPUT_DIR);

    await Promise.all(
        files
            .filter((file) => file.endsWith(".md"))
            .map((file) =>
                rm(join(OUTPUT_DIR, file)),
            ),
    );
}

async function readBibtex(): Promise<string> {
    console.log(
        `Reading BibTeX file: ${BIB_FILE}`,
    );

    const { readFile } = await import("node:fs/promises");

    const bibtex = await readFile(
        BIB_FILE,
        "utf8",
    );

    if (!bibtex.trim()) {
        throw new Error(
            "The BibTeX file is empty.",
        );
    }

    if (!/@[a-z]+\s*\{/i.test(bibtex)) {
        throw new Error(
            [
                "The downloaded file does not appear to contain BibTeX.",
                "",
                "HAL may have returned an HTML/Anubis page.",
                "Check data/publications.bib.",
            ].join("\n"),
        );
    }

    return bibtex;
}

/**
 * Main import process.
 */
async function main(): Promise<void> {
    console.log(
        "Starting HAL publications import...\n",
    );

    /*
     * Read the BibTeX file downloaded by wget.
     */
    const bibtex = await readBibtex();

    /*
     * Save/normalize the source BibTeX.
     *
     * In normal operation this is already the source file,
     * so this does not modify its contents.
     */
    await mkdir(
        join(process.cwd(), "data"),
        { recursive: true },
    );

    await writeFile(
        BIB_FILE,
        bibtex,
        "utf8",
    );

    /*
     * Parse BibTeX.
     */
    console.log("Parsing BibTeX...");

    const bibliography = parse(bibtex);

    if (bibliography.errors.length > 0) {
        console.warn(
            `bibtex-parser reported ${bibliography.errors.length} error(s):`,
        );

        for (const error of bibliography.errors) {
            console.warn(error);
        }
    }

    const publications = bibliography.entries;

    if (publications.length === 0) {
        throw new Error(
            "No publications found in the BibTeX file.",
        );
    }

    console.log(
        `Found ${publications.length} publications.`,
    );

    /*
     * Remove old generated Markdown files.
     */
    await cleanOutputDirectory();

    /*
     * Generate one Markdown file per publication.
     */
    for (const publication of publications) {
        const filename =
            getFilename(publication);

        const outputPath =
            join(OUTPUT_DIR, filename);

        const markdown =
            generateMarkdown(publication);

        await writeFile(
            outputPath,
            markdown,
            "utf8",
        );

        console.log(`  ✓ ${filename}`);
    }

    console.log(
        `\nGenerated ${publications.length} Markdown files.`,
    );
}

main().catch((error) => {
    console.error(
        "\nPublication import failed:",
    );

    console.error(error);

    process.exit(1);
});
