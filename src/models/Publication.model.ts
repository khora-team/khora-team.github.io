export interface Publication {
    title: string;
    authors: string[];
    abstract: string;
    year: number | null;
    venue: string;
    halId: string;
    doi: string;
    url: string;
    pdf: string;
    type: string;
    keywords: string[];
}