// src/analyzer.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamText } from 'hono/streaming';
import OpenAI from 'openai';

import { promptV3 } from '../../prompt/v3';
import type { FormattedGameInfo } from '../types/steam';

// Define the bindings needed for this specific route/file
// Note: If you mount this in index.ts, the main Bindings type will cover it.
// If run standalone, you'd need wrangler.toml configured for these.
type AnalyzerBindings = {
    MY_KV: KVNamespace;
    OPENAI_API_KEY: string; // Add your OpenAI API Key secret binding name
};

const analyzerApp = new Hono<{ Bindings: AnalyzerBindings }>();

// const MODEL = 'deepseek-r1-250120';
export const MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com'

// Helper to format game data for the prompt
function formatGamesForPrompt(games: FormattedGameInfo[]): string {
    if (!games || games.length === 0) {
        return "The user has no games or the data is unavailable.";
    }
    // Limit the number of games sent to avoid overly long prompts
    const MAX_GAMES_IN_PROMPT = 100; // Adjust as needed
    const relevantGames = games
        .filter(game => parseFloat(game.playtimeHours) > 0.1) // Filter out games with negligible playtime
        .sort((a, b) => parseFloat(b.playtimeHours) - parseFloat(a.playtimeHours)) // Sort by playtime desc
        .slice(0, MAX_GAMES_IN_PROMPT); // Take top N games

    if (relevantGames.length === 0) {
        return "The user owns games, but none have significant playtime recorded.";
    }

    return relevantGames
        .map(game => `- ${game.name}: ${game.playtimeHours}`)
        .join('\n');
}

// Construct the prompt for OpenAI
function constructAnalysisPrompt(gameDataString: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const systemPrompt = promptV3;

    const userPrompt = `
这是我的游戏数据：    
${gameDataString}

请开始你的锐评：
`;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
    ];
}


// --- API Endpoint: Analyze Game Data ---
analyzerApp.get('/:dataId', async (c) => {
    const dataId = c.req.param('dataId');
    const kv = c.env.MY_KV;
    const openaiApiKey = c.env.OPENAI_API_KEY;

    // --- Input Validation ---
    if (!dataId) {
        throw new HTTPException(400, { message: 'Missing dataId parameter.' });
    }
    // Basic check: KV keys often contain characters not typical in simple IDs
    // You might want a more specific check if your dataId format is known
    if (dataId.length < 10 || !dataId.includes(':')) { // Example check
        console.warn(`Received potentially invalid dataId format: ${dataId}`);
        // Allow it for now, but log it. KV will handle non-existent keys.
    }

    if (!openaiApiKey) {
        console.error('OPENAI_API_KEY environment variable not set.');
        throw new HTTPException(500, { message: 'Server configuration error: OpenAI API key missing.' });
    }

    try {
        // --- 1. Retrieve Data from KV ---
        console.log(`Attempting to retrieve data from KV with key: ${dataId}`);
        const jsonData = await kv.get(dataId);

        if (!jsonData) {
            console.log(`Data not found in KV for key: ${dataId}`);
            throw new HTTPException(404, { message: `Data not found for ID: ${dataId}. It might have expired or never existed.` });
        }

        // --- 2. Parse Game Data ---
        let gameData: FormattedGameInfo[];
        try {
            gameData = JSON.parse(jsonData);
            // Add a basic check to ensure it's an array
            if (!Array.isArray(gameData)) {
                throw new Error('Parsed data is not an array.');
            }
            console.log(`Successfully parsed ${gameData.length} game entries from KV.`);
        } catch (parseError: any) {
            console.error(`Failed to parse JSON data from KV for key ${dataId}:`, parseError);
            throw new HTTPException(500, { message: 'Failed to process stored game data. Data might be corrupted.' });
        }

        // --- 3. Prepare Data and Prompt for OpenAI ---
        const gameDataString = formatGamesForPrompt(gameData);
        const messages = constructAnalysisPrompt(gameDataString);

        // --- 4. Initialize OpenAI Client ---
        const openai = new OpenAI({
            apiKey: openaiApiKey,
            // You might need baseURL if using a proxy or specific Cloudflare AI Gateway
            // baseURL: "YOUR_CLOUDFLARE_AI_GATEWAY_URL",
            baseURL: BASE_URL,
        });

        // --- 5. Call OpenAI and Stream Response ---
        console.log(`Sending request to model ${MODEL} for ${dataId}`);
        const stream = await openai.chat.completions.create({
            model: MODEL, // Use the specific o1 model identifier   
            messages: messages,
            stream: true,
            temperature: 1.3, // Adjust temperature for creativity vs consistency
            // max_tokens: 1000, // Optional: Limit response length
        });

        console.log(`Streaming response from OpenAI for ${dataId}...`);
        // Use Hono's streamText helper for easy SSE streaming
        return streamText(c, async (streamHelper) => {
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                    await streamHelper.write(content);
                    // Optional: Add a small delay if needed, e.g., await streamHelper.sleep(10);
                }
            }
            console.log(`Finished streaming response for ${dataId}`);
        });

    } catch (error: any) {
        if (error instanceof HTTPException) {
            throw error; // Re-throw Hono's exceptions
        }

        // Handle potential OpenAI API errors
        if (error.response) { // Check if it looks like an OpenAI API error
            console.error(`OpenAI API Error for ${dataId}: Status ${error.response.status}`, error.response.data);
            throw new HTTPException(502, { message: `Failed to get analysis from AI service: ${error.response.data?.error?.message || 'API error'}` });
        } else if (error.request) { // Network error talking to OpenAI
            console.error(`Network error calling OpenAI for ${dataId}:`, error.message);
            throw new HTTPException(504, { message: 'Network error connecting to AI service.' });
        } else { // Other errors (KV, parsing handled above, unexpected)
            console.error(`Unexpected error processing analysis request for ${dataId}:`, error);
            throw new HTTPException(500, { message: 'An internal server error occurred during analysis.' });
        }
    }
});

export default analyzerApp; // Export the Hono app instance for this route
