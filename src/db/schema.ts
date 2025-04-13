import type { FormattedGameInfo } from '../types/steam'
// src/db/schema.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Define the table to store cached Steam game data
export const steamGamesCache = sqliteTable('steam_games_cache', {
  steamId: text('steam_id').primaryKey(), // SteamID is the unique identifier
  gameData: text('game_data', { mode: 'json' }).$type<FormattedGameInfo[]>().notNull(), // Store the FormattedGameInfo[] as JSON text
  cachedAt: integer('cached_at', { mode: 'timestamp_ms' }).notNull(), // Store timestamp as milliseconds since epoch
})

// Optional: Define types for better type safety (inferred from the schema)
export type SteamGamesCache = typeof steamGamesCache.$inferSelect
export type NewSteamGamesCache = typeof steamGamesCache.$inferInsert
