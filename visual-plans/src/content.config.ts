import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const status = z.enum(['proposed', 'approved', 'done']).default('proposed');

const plans = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/plans' }),
  schema: z.object({
    title: z.string(),
    objective: z.string().optional(),
    status,
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});

const recaps = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/recaps' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().optional(),
    status,
    date: z.coerce.date(),
    pr: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { plans, recaps };
