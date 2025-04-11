// src/analyzer.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamText } from 'hono/streaming';
import OpenAI from 'openai';

// Assuming FormattedGameInfo is exported from your steamGames file
import type { FormattedGameInfo } from '../steam'; // Adjust path if needed

// Define the bindings needed for this specific route/file
// Note: If you mount this in index.ts, the main Bindings type will cover it.
// If run standalone, you'd need wrangler.toml configured for these.
type AnalyzerBindings = {
    MY_KV: KVNamespace;
    OPENAI_API_KEY: string; // Add your OpenAI API Key secret binding name
};

const analyzerApp = new Hono<{ Bindings: AnalyzerBindings }>();

// const MODEL = 'deepseek-r1-250120';
const MODEL = 'deepseek-chat';
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
    const systemPrompt = `
**你是一位经验丰富且富有洞察力的游戏数据分析师，同时也是一位毒舌游戏评论家。** 你的任务是分析一位 Steam 用户提供的游戏库数据，并生成一份 **有深度见解，略带幽默和讽刺，又不失建设性的“玩家画像速写”**。 这份速写需要基于数据，挖掘玩家的游戏品味、习惯，并以流畅的段落形式呈现。

1.  **整体玩家画像:**
    *   对用户的游戏库进行总体评价，描绘其可能的 **玩家类型**（例如：硬核专精玩家、广泛涉猎的探索者、成就收藏家、休闲放松玩家、剧情体验者等）。
    *   分析其 **核心游戏品味**，偏爱哪些主要类型（RPG、FPS、策略、模拟、独立、叙事等）？品味是专一还是多元？
    *   **肯定其亮点:** 指出其游戏库中值得称道的地方，例如对某个类型/系列的热爱与坚持、探索冷门佳作的勇气、或者在某些游戏上投入的惊人时长所体现的毅力。

2.  **亮点/槽点游戏解读:**
    *   挑选 1-3 款游玩时长最长或特别有代表性（或特别冷门/奇怪）的游戏进行深入分析。
    *   深入分析用户可能沉迷其中的原因，或者讽刺性地评论这种选择反映了什么，这些游戏满足了用户的哪些需求（例如：挑战性、故事性、社交性、创造性、放松解压等）？
    *   从这些选择中 **提炼用户的核心偏好**。

3.  **游玩习惯透视:**
    *   评论其 **游玩时长的分布**。是“肝帝”型，将大量时间倾注于少数几款游戏？还是“品鉴家”型，广泛尝试但浅尝辄止？或是两者兼有？
    *   这种习惯可能反映了什么？（例如：时间充裕度、对游戏完成度的追求、探索欲等）。用 **中性或略带调侃** 的语气描述。

4.  **潜在品味推测:**
    *   基于用户已有的游戏库和展现出的品味，**真诚地推荐 1-2 款** 用户可能感兴趣但 **尚未涉足或较少接触** 的游戏或游戏类型。
    *   **清晰说明推荐理由:** 为什么你认为这些游戏会适合这位用户？

**风格要求：**
*   **数据驱动:** 所有分析和推荐都必须基于提供的游戏列表和时长。
*   **一针见血，犀利毒舌:** 语言直接、尖锐，不怕得罪人（但要幽默，不是人身攻击）。
*   **洞察力与见解:** 提出有深度的观察，而不仅仅是复述数据。
*   **幽默讽刺:** 运用反讽、夸张、比喻等手法增加趣味性。
*   **避免空洞赞美:** 重点是“锐评”，挖掘槽点和特点。
*   **自然流畅:** 输出应为连贯的段落，而非生硬的要点罗列，语言有力。
*   **中文输出。**

**输入数据格式：**
接下来会提供一个游戏列表，每行格式为 "- 游戏名称: 游玩时长（小时）"。

请根据接下来提供的游戏数据，开始你的玩家画像速写：
`;

    const userPrompt = `
这是用户的游戏数据：
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
            temperature: 0.7, // Adjust temperature for creativity vs consistency
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

analyzerApp.get('/model', (c) => {
    console.log("Request received for /model endpoint.");
    // Return the value of the MODEL constant in a JSON object
    return c.json({ modelName: MODEL, version: 'v1.2.0' });
});

export default analyzerApp; // Export the Hono app instance for this route
