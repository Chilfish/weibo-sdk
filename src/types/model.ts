import { z } from 'zod'

// --- Basic Value Objects ---

export const UniversalIDSchema = z.object({
  platform: z.string(),
  originalId: z.string(),
  // uid = hash(platform + originalId) usually handled by logic, but stored here
  uid: z.string(),
})

export const MediaTypeSchema = z.enum(['image', 'video', 'audio', 'link_card'])

export const MediaResourceSchema = z.object({
  type: MediaTypeSchema,
  url: z.url(),
  thumbnailUrl: z.url().optional(),
  aspectRatio: z.number().optional(), // width / height
  duration: z.number().optional(), // seconds
  variants: z.array(z.object({
    url: z.string(),
    quality: z.string(),
  })).optional(),
})

export const VerificationSchema = z.object({
  isVerified: z.boolean(),
  type: z.enum(['personal', 'organization', 'none']),
  description: z.string().optional(),
})

// --- Entities ---

export const ActorSchema = z.object({
  id: UniversalIDSchema,
  username: z.string(), // unique handle or id
  displayName: z.string(),
  avatar: MediaResourceSchema.optional(),
  profileUrl: z.url().optional(),
  verification: VerificationSchema,
  metadata: z.record(z.string(), z.any()).default({}),
})

export const ContentSchema = z.object({
  text: z.string(),
  html: z.string().optional(),
  entities: z.array(z.object({
    type: z.enum(['mention', 'hashtag', 'url', 'stock']),
    text: z.string(),
    value: z.string(), // e.g., the URL or the User ID
    indices: z.tuple([z.number(), z.number()]),
  })).default([]),
})

export const PostMetricsSchema = z.object({
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  shares: z.number().int().nonnegative().default(0),
  views: z.number().int().nonnegative().optional(),
  collects: z.number().int().nonnegative().optional(),
})

// --- Root Aggregate ---

export const UnifiedPostSchema = z.object({
  id: UniversalIDSchema,
  actor: ActorSchema,

  content: ContentSchema,
  attachments: z.array(MediaResourceSchema).default([]),

  metrics: PostMetricsSchema,

  createdAt: z.number().int(), // Unix Timestamp (ms)
  publishedAt: z.iso.datetime(), // ISO 8601

  // Contextual information
  context: z.object({
    isReply: z.boolean().default(false),
    replyToId: UniversalIDSchema.optional(),
    isRepost: z.boolean().default(false),
    get repostOf() {
      return UnifiedPostSchema.optional()
    },
  }),

  // Extension slot for platform-specific raw data
  extra: z.record(z.string(), z.any()).default({}),
})

// TypeScript Types Inference
export type UniversalID = z.infer<typeof UniversalIDSchema>
export type MediaResource = z.infer<typeof MediaResourceSchema>
export type Actor = z.infer<typeof ActorSchema>
export type UnifiedPost = z.infer<typeof UnifiedPostSchema>
export type Verification = z.infer<typeof VerificationSchema>
