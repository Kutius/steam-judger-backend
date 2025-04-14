import type { Bindings } from '../types/env'
import type { FormattedGameInfo } from '../types/steam'
import { eq } from 'drizzle-orm'
// src/analyzer.ts
import { Hono } from 'hono'

import { HTTPException } from 'hono/http-exception'
import { streamText } from 'hono/streaming'
import OpenAI from 'openai'
import { promptV3 } from '../../prompt/v3'
import { initDbConnect } from '../db'
import { steamGamesCache } from '../db/schema'
import { isValidSteamId64 } from '../util'

const analyzerApp = new Hono<{ Bindings: Bindings }>()

// const MODEL = 'deepseek-r1-250120';
export const MODEL = 'deepseek-chat'
const BASE_URL = 'https://api.gpt.ge/v1'

// Helper to format game data for the prompt
function formatGamesForPrompt(games: FormattedGameInfo[]): string {
  if (!games || games.length === 0) {
    return 'The user has no games or the data is unavailable.'
  }
  // Limit the number of games sent to avoid overly long prompts
  const MAX_GAMES_IN_PROMPT = 100 // Adjust as needed
  const relevantGames = games
    .filter(game => Number.parseFloat(game.playtimeHours) > 0.1) // Filter out games with negligible playtime
    .sort((a, b) => Number.parseFloat(b.playtimeHours) - Number.parseFloat(a.playtimeHours)) // Sort by playtime desc
    .slice(0, MAX_GAMES_IN_PROMPT) // Take top N games

  if (relevantGames.length === 0) {
    return 'The user owns games, but none have significant playtime recorded.'
  }

  return relevantGames
    .map(game => `- ${game.name}: ${game.playtimeHours}`)
    .join('\n')
}

// Construct the prompt for OpenAI
function constructAnalysisPrompt(gameDataString: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const systemPrompt = promptV3()

  const userPrompt = `
这是我的游戏数据：    
${gameDataString}

请开始你的锐评：
`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

// --- API Endpoint: Analyze Game Data ---
analyzerApp.get('/:steamid', async (c) => {
  const steamId = c.req.param('steamid')
  const d1 = c.env.DB
  const openaiApiKey = c.env.OPENAI_API_KEY

  // --- Input Validation ---
  if (!steamId) {
    throw new HTTPException(400, { message: 'Missing dataId parameter.' })
  }
  // Validate SteamID format
  if (!isValidSteamId64(steamId)) {
    throw new HTTPException(400, { message: 'Invalid SteamID format. Please provide a 64-bit SteamID.' })
  }

  if (!openaiApiKey) {
    console.error('OPENAI_API_KEY environment variable not set.')
    throw new HTTPException(500, { message: 'Server configuration error: OpenAI API key missing.' })
  }

  const db = initDbConnect(d1)

  try {
    // --- 1. Retrieve Data from D1 ---
    console.log(`Attempting to retrieve data from D1 with key: ${steamId}`)
    const results = await db
      .select()
      .from(steamGamesCache)
      .where(eq(steamGamesCache.steamId, steamId)) // Find matching steamId
      .limit(1)

    if (results.length === 0) {
      console.log(`Data not found in D1 for steamId: ${steamId}`)
      // Suggest fetching data first
      throw new HTTPException(404, { message: `Game data not found for SteamID: ${steamId}. Please fetch data first via /api/games/${steamId}` })
    }

    const rawGameData = results[0].gameData

    // --- 2. Parse Game Data ---
    let gameData: FormattedGameInfo[]
    try {
      // Drizzle might parse JSON automatically based on schema ({ mode: 'json' })
      // but it's safer to handle both string and object cases.
      if (typeof rawGameData === 'string') {
        gameData = JSON.parse(rawGameData)
      }
      else if (typeof rawGameData === 'object' && rawGameData !== null) {
        gameData = rawGameData as FormattedGameInfo[] // Assume it's already parsed
      }
      else {
        throw new Error('Stored game data is not in a recognizable format (string or object).')
      }

      // Add a basic check to ensure it's an array after potential parsing
      if (!Array.isArray(gameData)) {
        throw new TypeError('Parsed data is not an array.')
      }
      console.log(`Successfully parsed ${gameData.length} game entries from D1 for steamId: ${steamId}.`)
    }
    catch (parseError: any) {
      console.error(`Failed to parse JSON data from D1 for steamId ${steamId}:`, parseError)
      throw new HTTPException(500, { message: 'Failed to process stored game data. Data might be corrupted.' })
    }

    // --- 3. Prepare Data and Prompt for OpenAI ---
    const gameDataString = formatGamesForPrompt(gameData)
    const messages = constructAnalysisPrompt(gameDataString)

    // --- 4. Initialize OpenAI Client ---
    const openai = new OpenAI({
      apiKey: openaiApiKey,
      // You might need baseURL if using a proxy or specific Cloudflare AI Gateway
      // baseURL: "YOUR_CLOUDFLARE_AI_GATEWAY_URL",
      baseURL: BASE_URL,
    })

    // --- 5. Call OpenAI and Stream Response ---
    console.log(`Sending request to model ${MODEL} for ${steamId}`)
    const stream = await openai.chat.completions.create({
      model: MODEL, // Use the specific o1 model identifier
      messages,
      stream: true,
      temperature: 1, // Adjust temperature for creativity vs consistency
      // max_tokens: 1000, // Optional: Limit response length
    }, { timeout: 2 * 60 * 1000 })

    console.log(`Streaming response from OpenAI for ${steamId}...`)
    // Use Hono's streamText helper for easy SSE streaming
    return streamText(c, async (streamHelper) => {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        console.log(`Received chunk for ${steamId}:`, content)
        if (content) {
          await streamHelper.write(content)
          // Optional: Add a small delay if needed, e.g., await streamHelper.sleep(10);
        }
      }
      console.log(`Finished streaming response for ${steamId}`)
    })
  }
  catch (error: any) {
    if (error instanceof HTTPException) {
      throw error // Re-throw Hono's exceptions
    }

    // Handle potential OpenAI API errors
    if (error.response) { // Check if it looks like an OpenAI API error
      console.error(`OpenAI API Error for ${steamId}: Status ${error.response.status}`, error.response.data)
      throw new HTTPException(502, { message: `Failed to get analysis from AI service: ${error.response.data?.error?.message || 'API error'}` })
    }
    else if (error.request) { // Network error talking to OpenAI
      console.error(`Network error calling OpenAI for ${steamId}:`, error.message)
      throw new HTTPException(504, { message: 'Network error connecting to AI service.' })
    }
    else {
      console.error(`Unexpected error processing analysis request for ${steamId}:`, error)
      throw new HTTPException(500, { message: 'An internal server error occurred during analysis.' })
    }
  }
})

export default analyzerApp // Export the Hono app instance for this route
