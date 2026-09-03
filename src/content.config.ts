import { defineCollection } from "astro:content";
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { publicationsLoader } from './utils/import-hal-publications';

const project = defineCollection({
  loader: glob({ base: './src/content/project', pattern: '**/*.md' }),
  schema: z.object({
    name: z.string().trim(),
    website: z.string().trim().optional(),
    start: z.number(),
    end: z.number(),
    keywords: z.string().trim().optional(),
    type: z.string().trim(),
  }),
});

const software = defineCollection({
  loader: glob({ base: './src/content/software', pattern: '**/*.md' }),
  schema: z.object({
    name: z.string().trim(),
    website: z.string().trim().optional(),
    repository: z.string().trim().optional(),
    logo: z.string().trim().optional(),
  }),
});

const team = defineCollection({
  loader: glob({ base: './src/content/team', pattern: '**/*.md' }),
  schema: z.object({
    firstname: z.string().trim(),
    lastname: z.string().trim(),
    organization: z.string().trim(),
    position: z.string().trim(),
    other: z.string().trim().optional(),
    category: z.enum(["permanent", "postdoc", "phd", "eng", "ext", "eng", "alumni"]),
    social: z.object({
      home: z.string().trim().optional(),
      twitter: z.string().trim().optional(),
      linkedin: z.string().trim().optional(),
      github: z.string().trim().optional(),
      orcid: z.string().trim().optional(),
      scholar: z.string().trim().optional(),
    }).optional(),
    dateOfStay: z.object({
      start: z.number(),
      end: z.number().optional(),
    }).optional(),
  }),
});

const publications = defineCollection({
  loader: publicationsLoader(),
  schema: z.object({
    title: z.string(),
    authors: z.array(
        z.string(),
    ),
    year: z.number().nullable(),
    abstract: z.string().default(""),
    venue: z.string().default(""),
    halId: z.string().default(""),
    doi: z.string().default(""),
    url: z.string().default(""),
    pdf: z.string().default(""),
    type: z.string().default("unknown"),
    keywords: z.array(z.string()).default([]),
  }),
});

const jobs = defineCollection({
  loader: glob({ base: './src/content/positions', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    starts: z.number(),
    duration: z.string(),
    position: z.string(),
    level: z.string(),
    contact: z.string(),
    email: z.string(),
    summary: z.string(),
  }),
});

export const collections = {
  team,
  software,
  project,
  publications,
  jobs,
};
