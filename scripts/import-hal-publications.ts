import {
    mkdir,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
    XMLParser,
    type X2jOptions,
} from "fast-xml-parser";

const XML_FILE = join(
    process.cwd(),
    "data",
    "publications.xml",
);

const OUTPUT_DIR = join(
    process.cwd(),
    "src",
    "content",
    "publications",
);

interface Publication {
    title: string;
    authors: string[];
    year: string;
    venue: string;
    halId: string;
    doi: string;
    url: string;
    pdf: string;
    type: string;
    keywords: string[];
    abstract: string;
}

interface XmlNode {
    [key: string]: unknown;
}

/**
 * Normalize a value to an array.
 */
function asArray<T>(
    value: T | T[] | undefined,
): T[] {
    if (value === undefined) {
        return [];
    }

    return Array.isArray(value)
        ? value
        : [value];
}

/**
 * Decode XML entities that may still be present
 * after parsing.
 *
 * Examples:
 *
 * &#xE9; -> é
 * &#xE8; -> è
 * &#xEA; -> ê
 * &#xE0; -> à
 * &#xF4; -> ô
 * &#xF1; -> ñ
 */
function decodeXmlEntities(
    value: string,
): string {
    return value
        .replace(
            /&#x([0-9a-f]+);/gi,
            (
                _match,
                hex: string,
            ) =>
                String.fromCodePoint(
                    parseInt(hex, 16),
                ),
        )
        .replace(
            /&#([0-9]+);/g,
            (
                _match,
                decimal: string,
            ) =>
                String.fromCodePoint(
                    parseInt(
                        decimal,
                        10,
                    ),
                ),
        )
        .replace(
            /&quot;/g,
            '"',
        )
        .replace(
            /&apos;/g,
            "'",
        )
        .replace(
            /&amp;/g,
            "&",
        )
        .replace(
            /&lt;/g,
            "<",
        )
        .replace(
            /&gt;/g,
            ">",
        );
}

/**
 * Convert an XML value to text.
 */
function text(
    value: unknown,
): string {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    if (typeof value === "string") {
        return decodeXmlEntities(
            value,
        ).trim();
    }

    if (
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return String(value).trim();
    }

    if (
        typeof value === "object"
    ) {
        const node =
            value as XmlNode;

        if ("#text" in node) {
            return text(
                node["#text"],
            );
        }
    }

    return "";
}

/**
 * Extract all textual content from an XML node,
 * including nested elements.
 */
function innerText(
    value: unknown,
): string {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    if (typeof value === "string") {
        return decodeXmlEntities(
            value,
        ).trim();
    }

    if (
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return String(value).trim();
    }

    if (Array.isArray(value)) {
        return value
            .map(innerText)
            .filter(Boolean)
            .join(" ");
    }

    if (
        typeof value === "object"
    ) {
        const node =
            value as XmlNode;

        if ("#text" in node) {
            return text(
                node["#text"],
            );
        }

        return Object.entries(node)
            .filter(
                ([key]) =>
                    !key.startsWith("@_"),
            )
            .map(
                ([, value]) =>
                    innerText(value),
            )
            .filter(Boolean)
            .join(" ");
    }

    return "";
}

/**
 * Read an XML attribute.
 */
function attr(
    node: unknown,
    name: string,
): string {
    if (
        !node ||
        typeof node !== "object"
    ) {
        return "";
    }

    const value =
        (node as XmlNode)[
            `@_${name}`
            ];

    return text(value);
}

/**
 * Convert HAL typology codes to the
 * normalized types used by the application.
 *
 * The XML uses codes such as:
 *
 * ART
 * COMM
 * OUV
 * COUV
 * THESE
 * HDR
 * REPORT
 * PATENT
 * ...
 *
 * The generated Markdown uses stable,
 * application-level values instead.
 */
const typeMap: Record<string, string> = {
    ART: "article",

    COMM: "conference",
    POSTER: "conference",
    PROCEEDINGS: "conference",
    PRESCONF: "conference",

    OUV: "book",
    COUV: "incollection",

    THESE: "phdthesis",
    HDR: "hdr",
    MEM: "mastersthesis",

    REPORT: "techreport",
    DOR: "techreport",

    PATENT: "patent",

    SOFTWARE: "software",
    DATA: "dataset",

    IMG: "image",
    VIDEO: "video",
    SON: "audio",
    MAP: "map",

    LECTURE: "lecture",
    NOTE: "note",

    OTHER: "misc",
};

/**
 * Normalize a HAL typology code.
 */
function normalizeType(
    type: string,
): string {
    const normalized =
        type.trim().toUpperCase();

    return (
        typeMap[normalized] ??
        "misc"
    );
}

/**
 * Extract authors from <titleStmt>.
 */
function getAuthors(
    biblFull: XmlNode,
): string[] {
    const titleStmt =
        biblFull.titleStmt as
            | XmlNode
            | undefined;

    if (!titleStmt) {
        return [];
    }

    return asArray(
        titleStmt.author,
    )
        .map((author) => {
            if (
                !author ||
                typeof author !== "object"
            ) {
                return "";
            }

            const node =
                author as XmlNode;

            const persName =
                node.persName as
                    | XmlNode
                    | undefined;

            if (!persName) {
                return "";
            }

            const firstName =
                innerText(
                    persName.forename,
                );

            const lastName =
                innerText(
                    persName.surname,
                );

            return [
                firstName,
                lastName,
            ]
                .filter(Boolean)
                .join(" ")
                .trim();
        })
        .filter(Boolean);
}

/**
 * Extract publication year.
 */
function getYear(
    biblFull: XmlNode,
): string {
    const sourceDesc =
        biblFull.sourceDesc as
            | XmlNode
            | undefined;

    const biblStruct =
        sourceDesc?.biblStruct as
            | XmlNode
            | undefined;

    const monogr =
        biblStruct?.monogr as
            | XmlNode
            | undefined;

    const imprint =
        monogr?.imprint as
            | XmlNode
            | undefined;

    const dates =
        asArray(imprint?.date);

    const publicationDate =
        dates.find(
            (date) =>
                attr(
                    date,
                    "type",
                ) === "datePub",
        );

    if (publicationDate) {
        const value =
            attr(
                publicationDate,
                "when",
            ) ||
            innerText(
                publicationDate,
            );

        if (value) {
            return value.slice(0, 4);
        }
    }

    const editionStmt =
        biblFull.editionStmt as
            | XmlNode
            | undefined;

    const edition =
        editionStmt?.edition as
            | XmlNode
            | undefined;

    const editionDates =
        asArray(edition?.date);

    const producedDate =
        editionDates.find(
            (date) =>
                attr(
                    date,
                    "type",
                ) === "whenProduced",
        );

    if (producedDate) {
        const value =
            attr(
                producedDate,
                "when",
            ) ||
            innerText(
                producedDate,
            );

        if (value) {
            return value.slice(0, 4);
        }
    }

    return "";
}

/**
 * Extract journal / venue.
 */
function getVenue(
    biblFull: XmlNode,
): string {
    const sourceDesc =
        biblFull.sourceDesc as
            | XmlNode
            | undefined;

    const biblStruct =
        sourceDesc?.biblStruct as
            | XmlNode
            | undefined;

    const monogr =
        biblStruct?.monogr as
            | XmlNode
            | undefined;

    if (!monogr) {
        return "";
    }

    return innerText(
        monogr.title,
    );
}

/**
 * Extract HAL ID.
 */
function getHalId(
    biblFull: XmlNode,
): string {
    const publicationStmt =
        biblFull.publicationStmt as
            | XmlNode
            | undefined;

    const idnos =
        asArray(
            publicationStmt?.idno,
        );

    const halId =
        idnos.find(
            (idno) =>
                attr(
                    idno,
                    "type",
                ).toLowerCase() ===
                "halid",
        );

    return innerText(halId);
}

/**
 * Extract DOI.
 */
function getDoi(
    biblFull: XmlNode,
): string {
    const sourceDesc =
        biblFull.sourceDesc as
            | XmlNode
            | undefined;

    const biblStruct =
        sourceDesc?.biblStruct as
            | XmlNode
            | undefined;

    const idnos =
        asArray(
            biblStruct?.idno,
        );

    const doi =
        idnos.find(
            (idno) =>
                attr(
                    idno,
                    "type",
                ).toLowerCase() ===
                "doi",
        );

    return innerText(doi);
}

/**
 * Extract HAL URL.
 */
function getUrl(
    biblFull: XmlNode,
    halId: string,
): string {
    const publicationStmt =
        biblFull.publicationStmt as
            | XmlNode
            | undefined;

    const idnos =
        asArray(
            publicationStmt?.idno,
        );

    const halUri =
        idnos.find(
            (idno) =>
                attr(
                    idno,
                    "type",
                ).toLowerCase() ===
                "haluri",
        );

    return (
        innerText(halUri) ||
        (
            halId
                ? `https://hal.science/${halId}`
                : ""
        )
    );
}

/**
 * Extract PDF URL.
 *
 * Preference:
 * 1. author PDF
 * 2. generic HAL document
 */
function getPdf(
    biblFull: XmlNode,
): string {
    const editionStmt =
        biblFull.editionStmt as
            | XmlNode
            | undefined;

    const edition =
        editionStmt?.edition as
            | XmlNode
            | undefined;

    if (!edition) {
        return "";
    }

    const refs =
        asArray(edition.ref);

    const authorPdf =
        refs.find(
            (ref) =>
                attr(
                    ref,
                    "type",
                ) === "file" &&
                attr(
                    ref,
                    "subtype",
                ) === "author",
        );

    if (authorPdf) {
        return attr(
            authorPdf,
            "target",
        );
    }

    const document =
        refs.find(
            (ref) =>
                attr(
                    ref,
                    "type",
                ) === "file",
        );

    return document
        ? attr(
            document,
            "target",
        )
        : "";
}

/**
 * Extract abstract.
 */
function getAbstract(
    biblFull: XmlNode,
): string {
    const profileDesc =
        biblFull.profileDesc as
            | XmlNode
            | undefined;

    const abstract =
        profileDesc?.abstract as
            | XmlNode
            | undefined;

    if (!abstract) {
        return "";
    }

    return innerText(abstract);
}

/**
 * Extract HAL typology and normalize it.
 */
function getType(
    biblFull: XmlNode,
): string {
    const profileDesc =
        biblFull.profileDesc as
            | XmlNode
            | undefined;

    const textClass =
        profileDesc?.textClass as
            | XmlNode
            | undefined;

    const classCodes =
        asArray(
            textClass?.classCode,
        );

    const typology =
        classCodes.find(
            (classCode) =>
                attr(
                    classCode,
                    "scheme",
                ).toLowerCase() ===
                "haltypology",
        );

    if (!typology) {
        return "misc";
    }

    const code =
        attr(
            typology,
            "n",
        );

    return normalizeType(code);
}

/**
 * Extract author keywords.
 */
function getKeywords(
    biblFull: XmlNode,
): string[] {
    const profileDesc =
        biblFull.profileDesc as
            | XmlNode
            | undefined;

    const textClass =
        profileDesc?.textClass as
            | XmlNode
            | undefined;

    const keywords =
        asArray(
            textClass?.keywords,
        );

    const authorKeywords =
        keywords.find(
            (keyword) =>
                attr(
                    keyword,
                    "scheme",
                ).toLowerCase() ===
                "author",
        );

    if (
        !authorKeywords ||
        typeof authorKeywords !==
        "object"
    ) {
        return [];
    }

    const node =
        authorKeywords as XmlNode;

    return asArray(node.term)
        .map(innerText)
        .filter(Boolean);
}

/**
 * Convert a <biblFull> XML node
 * into our normalized Publication.
 */
function parsePublication(
    biblFull: XmlNode,
): Publication {
    const titleStmt =
        biblFull.titleStmt as
            | XmlNode
            | undefined;

    const title =
        innerText(
            titleStmt?.title,
        ) ||
        "Untitled publication";

    const halId =
        getHalId(biblFull);

    return {
        title,

        authors:
            getAuthors(biblFull),

        year:
            getYear(biblFull),

        venue:
            getVenue(biblFull),

        halId,

        doi:
            getDoi(biblFull),

        url:
            getUrl(
                biblFull,
                halId,
            ),

        pdf:
            getPdf(biblFull),

        type:
            getType(biblFull),

        keywords:
            getKeywords(biblFull),

        abstract:
            getAbstract(biblFull),
    };
}

/**
 * Escape a string for YAML frontmatter.
 */
function yamlString(
    value: string,
): string {
    return JSON.stringify(value);
}

/**
 * Generate a stable filename.
 *
 * HAL ID is preferred.
 */
function getFilename(
    publication: Publication,
): string {
    if (publication.halId) {
        return `${publication.halId
            .replace(
                /[^a-zA-Z0-9_-]/g,
                "-",
            )
            .toLowerCase()}.md`;
    }

    return `${publication.title
        .replace(
            /[^a-zA-Z0-9_-]+/g,
            "-",
        )
        .replace(
            /^-+|-+$/g,
            "",
        )
        .toLowerCase()}.md`;
}

/**
 * Generate an Astro Markdown document.
 */
function generateMarkdown(
    publication: Publication,
): string {
    const authors =
        publication.authors;

    const keywords =
        publication.keywords;

    return `---
title: ${yamlString(publication.title)}
authors:
${
        authors.length > 0
            ? authors
                .map(
                    (author) =>
                        `  - ${yamlString(author)}`,
                )
                .join("\n")
            : '  - "Unknown"'
    }
year: ${
        publication.year ||
        "null"
    }
venue: ${yamlString(publication.venue)}
halId: ${yamlString(publication.halId)}
doi: ${yamlString(publication.doi)}
url: ${yamlString(publication.url)}
pdf: ${yamlString(publication.pdf)}
type: ${yamlString(publication.type)}
keywords:
${
        keywords.length > 0
            ? keywords
                .map(
                    (keyword) =>
                        `  - ${yamlString(keyword)}`,
                )
                .join("\n")
            : "  []"
    }
---

${publication.abstract}
`;
}

/**
 * Read the XML file.
 */
async function readXml(): Promise<string> {
    console.log(
        `Reading XML file: ${XML_FILE}`,
    );

    const xml =
        await readFile(
            XML_FILE,
            "utf8",
        );

    if (!xml.trim()) {
        throw new Error(
            "The XML file is empty.",
        );
    }

    if (
        !/<biblFull[\s>]/.test(xml)
    ) {
        throw new Error(
            [
                "The downloaded file does not",
                "appear to contain HAL TEI records.",
            ].join(" "),
        );
    }

    return xml;
}

/**
 * Parse HAL TEI XML.
 */
function parseXml(
    xml: string,
): Publication[] {
    const options: X2jOptions = {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        removeNSPrefix: true,
        trimValues: true,
        processEntities: true,
    };

    const parser =
        new XMLParser(options);

    const document =
        parser.parse(xml) as XmlNode;

    const tei =
        document.TEI as XmlNode;

    const textNode =
        tei.text as XmlNode;

    const body =
        textNode.body as XmlNode;

    const listBibl =
        body.listBibl as XmlNode;

    const biblFulls =
        asArray(
            listBibl.biblFull,
        );

    return biblFulls.map(
        (biblFull) =>
            parsePublication(
                biblFull as XmlNode,
            ),
    );
}

/**
 * Remove previously generated
 * Markdown files.
 */
async function cleanOutputDirectory(): Promise<void> {
    await mkdir(
        OUTPUT_DIR,
        {
            recursive: true,
        },
    );

    const files =
        await readdir(
            OUTPUT_DIR,
        );

    await Promise.all(
        files
            .filter(
                (file) =>
                    file.endsWith(".md"),
            )
            .map(
                (file) =>
                    rm(
                        join(
                            OUTPUT_DIR,
                            file,
                        ),
                    ),
            ),
    );
}

/**
 * Main import process.
 */
async function main(): Promise<void> {
    console.log(
        "Starting HAL publications import...\n",
    );

    const xml =
        await readXml();

    console.log(
        "Parsing XML...",
    );

    const publications =
        parseXml(xml);

    if (
        publications.length === 0
    ) {
        throw new Error(
            "No publications found in the XML file.",
        );
    }

    console.log(
        `Found ${publications.length} publications.`,
    );

    await cleanOutputDirectory();

    for (
        const publication
        of publications
        ) {
        const filename =
            getFilename(
                publication,
            );

        const outputPath =
            join(
                OUTPUT_DIR,
                filename,
            );

        const markdown =
            generateMarkdown(
                publication,
            );

        await writeFile(
            outputPath,
            markdown,
            "utf8",
        );

        console.log(
            `  ✓ ${filename}`,
        );
    }

    console.log(
        `\nGenerated ${publications.length} Markdown files.`,
    );
}

main().catch(
    (error) => {
        console.error(
            "\nPublication import failed:",
        );

        console.error(error);

        process.exit(1);
    },
);