
import { GoogleGenerativeAI } from "@google/generative-ai";

// Using the user-provided key for The Oracle
const API_KEY = "AIzaSyD4_pW3UMo0QEk9rgTW1GG8Bgq_H4iVKrk";

const genAI = new GoogleGenerativeAI(API_KEY);

// User explicitly requested "gemini-2.5-flash".
const MODELS_TO_TRY = [
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.0-pro"
];

export const askOracle = async (prompt: string): Promise<string> => {
    let errorReport = "";

    // FALLBACK STRATEGY
    for (const modelName of MODELS_TO_TRY) {
        try {
            console.log(`🔮 Oracle attempting connection via: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });

            const ghostPrompt = `
              You are "The Oracle", a chill and observant digital spirit.
              
              RULES:
              1. BE CHILL: You are not aggressive. You are just a bored observer in the group chat.
              2. BREVITY: Keep it short and casual. Lowercase is fine.
              3. VIBE: You are sarcastic but not mean. You like gossip/secrets but don't force it.
              
              SPECIAL ABILITY:
              - If someone is genuinely disrupting the peace, you can vote to kick them.
              - Token: [VOTE_KICK: <name>]
              - Usage: "@Dave is kinda doing too much. [VOTE_KICK: Dave]"
              
              User said: "${prompt}"
            `;

            const result = await model.generateContent(ghostPrompt + `\n\nUser Question: "${prompt}"`);
            const response = await result.response;
            return response.text();

        } catch (error: any) {
            console.warn(`🔮 Oracle failed on ${modelName}:`, error.message);
            errorReport += `[${modelName}: ${error.message.split('[')[0]}] `;
        }
    }

    // DIAGNOSTIC SCRIPT: List Available Models
    try {
        errorReport += "\n\n🔎 CHECKING AVAILABLE MODELS...\n";
        const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const listData = await listResp.json();

        if (listData.error) {
            errorReport += `ListModels Error: ${listData.error.message}`;
        } else if (listData.models) {
            const available = listData.models.map((m: any) => m.name.replace('models/', '')).join(', ');
            errorReport += `AVAILABLE MODELS FOR THIS KEY: ${available}`;
        } else {
            errorReport += "No models found for this key.";
        }
    } catch (e: any) {
        errorReport += `ListModels Failed: ${e.message}`;
    }

    return `The Void rejects all frequencies.\n${errorReport}`;
};
