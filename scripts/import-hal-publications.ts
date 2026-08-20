import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, type Entry } from "@retorquere/bibtex-parser";

const HAL_URL =
  "https://haltools.inria.fr/Public/exportPubli.php" +
  "?annee_publideb=2025" +
  "&annee_publifin=2025" +
  "&labos_exp=diverse" +
  "&format_export=bibtex" +
  "&langue=Anglais" +
  "&CB_accent_latex=oui" +
  "&CB_aff_abstract=oui";

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

async function downloadBibtex(): Promise<string> {
  console.log("Downloading publications from HAL...");
  console.log(HAL_URL);

  const response = await fetch(HAL_URL, {
    headers: {
      Accept: "application/x-bibtex, text/plain, */*",
      "User-Agent": "Khora-publications-import/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `HAL request failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const lowerBody = body.toLowerCase();

  /*
   * Anubis can return an HTML challenge page with HTTP 200.
   * Never try to parse that page as BibTeX.
   */
  const isAnubis =
    lowerBody.includes("anubis") ||
    lowerBody.includes("making sure you're not a bot") ||
    lowerBody.includes("javascript challenge") ||
    lowerBody.includes("verification");

  const isHtml =
    contentType.includes("text/html") ||
    /^\s*<!doctype\s+html/i.test(body) ||
    /^\s*<html/i.test(body);

  if (isAnubis || isHtml) {
    throw new Error(
      [
        "HAL returned an HTML/anti-bot page instead of BibTeX.",
        "The request may have been blocked by Anubis.",
        `Content-Type: ${contentType || "unknown"}`,
      ].join("\n"),
    );
  }

  if (!/@[a-z]+\s*\{/i.test(body)) {
    throw new Error(
      "The HAL response does not appear to contain BibTeX.",
    );
  }

  return body;
}

/**
 * Convert a BibTeX field value to a string suitable for Markdown.
 *
 * bibtex-parser already performs LaTeX/Unicode conversion.
 * Some fields, such as creators, are represented as arrays/objects.
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
    const object = value as Record<string, unknown>;

    if (typeof object.name === "string") {
      return object.name.trim();
    }

    if (
      typeof object.firstName === "string" ||
      typeof object.lastName === "string"
    ) {
      return [
        object.firstName,
        object.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
    }
  }

  return "";
}

/**
 * Convert the BibTeX creator representation into author names.
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
    .map((creator) => fieldToString(creator))
    .filter(Boolean);
}

/**
 * Read a field from an Entry.
 */
function getField(
  entry: Entry,
  name: string,
): string {
  return fieldToString(entry.fields[name]);
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
 * HAL ID is preferred because it remains stable if the BibTeX citation
 * key changes.
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
 * Generate an Astro Content Collection Markdown file.
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
 * Delete previously generated Markdown files.
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

async function main(): Promise<void> {
    console.log(
        "Starting HAL publications import...\n",
    );

    const bibtex = await downloadBibtex();

    /*
     * Save the original HAL export.
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

    console.log(
        `BibTeX written to ${BIB_FILE}`,
    );

    /*
     * Parse using @retorquere/bibtex-parser.
     */
    console.log("Parsing BibTeX...");

    const bibliography = parse(bibtex);

    if (bibliography.errors.length > 0) {
        console.warn(
            `bibtex-parser reported ${bibliography.errors.length} error(s).`,
        );

        for (const error of bibliography.errors) {
            console.warn(error);
        }
    }

    const publications = bibliography.entries;

    if (publications.length === 0) {
        throw new Error(
            "No publications found in the HAL BibTeX export.",
        );
    }

    console.log(
        `Found ${publications.length} publications.`,
    );

    /*
     * Rebuild generated Markdown files.
     */
    await cleanOutputDirectory();

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
