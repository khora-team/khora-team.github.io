import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "bibtex-parser";

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

interface Publication {
  citationKey: string;
  entryType: string;
  fields: Record<string, string>;
}

/**
 * Download the BibTeX export from HAL.
 *
 * Anubis may return an HTML challenge page instead of BibTeX.
 * We explicitly detect that situation before parsing.
 */
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
 * Parse the BibTeX document using bibtex-parser.
 */
function parseBibtex(source: string): Publication[] {
  const parsed = parse(source);

  return Object.entries(parsed)
    .map(([citationKey, entry]) => {
      const value = entry as Record<string, unknown>;

      const entryType =
        typeof value.entryType === "string"
          ? value.entryType
          : typeof value.type === "string"
            ? value.type
            : "misc";

      const fields: Record<string, string> = {};

      for (const [key, fieldValue] of Object.entries(value)) {
        if (
          key === "entryType" ||
          key === "type"
        ) {
          continue;
        }

        if (typeof fieldValue === "string") {
          fields[key.toLowerCase()] = cleanValue(fieldValue);
        }
      }

      return {
        citationKey,
        entryType,
        fields,
      };
    });
}

/**
 * Remove simple BibTeX/LaTeX formatting from values.
 *
 * HAL may return accented characters as LaTeX depending on the
 * export configuration.
 */
function cleanValue(value: string): string {
  return value
    .replace(/\{([^{}]*)\}/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#")
    .replace(/\\textasciitilde/g, "~")
    .replace(/\\textbackslash/g, "\\")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * BibTeX authors are separated with "and".
 */
function parseAuthors(value: string): string[] {
  return value
    .split(/\s+and\s+/i)
    .map(cleanValue)
    .filter(Boolean);
}

/**
 * Escape a value for YAML frontmatter.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Use HAL identifier when available, otherwise fall back to the
 * BibTeX citation key.
 */
function getFilename(publication: Publication): string {
  const fields = publication.fields;

  const halId =
    fields.hal_id ??
    fields.halid;

  if (halId) {
    const normalized = halId
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .toLowerCase();

    return `${normalized}.md`;
  }

  const key = publication.citationKey
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();

  return `${key}.md`;
}

/**
 * Generate the Astro Markdown document.
 */
function generateMarkdown(
  publication: Publication,
): string {
  const fields = publication.fields;

  const title =
    fields.title ??
    "Untitled publication";

  const authors = parseAuthors(
    fields.author ?? "",
  );

  const year =
    fields.year ??
    "";

  const venue =
    fields.journal ??
    fields.booktitle ??
    fields.publisher ??
    "";

  const halId =
    fields.hal_id ??
    fields.halid ??
    "";

  const doi =
    fields.doi ??
    "";

  const url =
    fields.url ??
    (halId
      ? `https://hal.science/${halId}`
    : "");

const pdf =
    fields.pdf ??
    "";

const abstract =
    fields.abstract ??
    "";

const type =
    fields.typdoc ??
    publication.entryType;

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

/**
 * Main.
 */
async function main(): Promise<void> {
    console.log(
        "Starting HAL publications import...\n",
    );

    const bibtex = await downloadBibtex();

    console.log("Parsing BibTeX...");

    const publications = parseBibtex(bibtex);

    if (publications.length === 0) {
        throw new Error(
            "No publications found in the HAL BibTeX export.",
        );
    }

    console.log(
        `Found ${publications.length} publications.`,
    );

    /*
     * Save the original BibTeX export.
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
     * Regenerate Markdown files.
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