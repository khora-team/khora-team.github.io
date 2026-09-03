
export interface PersonData {
    lastname: string;
    firstname: string;
    organization: string;
    position: string;
    category: string;
    other?: string;
    social?: {
        home?: string;
        twitter?: string;
        linkedin?: string;
        github?: string;
        orcid?: string;
        scholar?: string;
    };
    dateOfStay?: {
        start: number;
        end?: number;
    }
}