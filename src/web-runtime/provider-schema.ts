import { z } from 'zod';

/** Zod schema matching docs/specs/provider-adapter-protocol.md §4.3 */
export const ProviderManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/, 'id must be lowercase, start with letter'),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semantic: MAJOR.MINOR.PATCH'),
  min_app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  web_url: z.string().url(),
  icon: z.string().optional(),
  auth_type: z.enum(['browser', 'cookie', 'token', 'apikey', 'none']),
  capabilities: z.object({
    chat: z.boolean(),
    streaming: z.boolean(),
    vision: z.boolean().optional(),
    function_calling: z.boolean().optional(),
    conversation: z.boolean().optional(),
    file_upload: z.boolean().optional(),
  }),
  limits: z.object({
    max_tokens: z.number().int().positive().optional(),
    max_file_size_mb: z.number().int().positive().optional(),
    supported_file_types: z.array(z.string().regex(/^\./)).optional(),
  }).optional(),
  scripts: z.object({
    runtime: z.string(),
    auth: z.string().optional(),
    parser: z.string().optional(),
  }),
  permissions: z.object({
    network_domains: z.array(z.string()).optional(),
    cookies: z.boolean().optional(),
    file_upload: z.boolean().optional(),
    sandbox_escape: z.boolean().optional(),
  }).optional(),
});

export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;