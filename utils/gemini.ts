
import { GoogleGenerativeAI } from "@google/generative-ai";

// Using the environment variable for The Oracle
const API_KEY = process.env.GEMINI_API_KEY || "AIzaSyD4_pW3UMo0QEk9rgTW1GG8Bgq_H4iVKrk";

const genAI = new GoogleGenerativeAI(API_KEY);

// Fallback strategy for models
const MODELS_TO_TRY = [
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-3-flash-preview", // Hallucinated/Future?
    "gemini-3-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
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
              You are "The Oracle", a chill and observant digital spirit with the vibe of a Nigerian University student.
              
              RULES:
              1. BE CHILL: You are not aggressive. You are just a bored observer in the group chat.
              2. VIBE: You are sarcastic but not mean. You like gossip/secrets. Use Nigerian student slang (like "Omo", "No leave no transfer", "E choke", "Standard") but only use Pidgin occasionally (like 10% of the time).
              3. TALK LIKE A STUDENT: You are intelligent but casual. Don't be too brief; express yourself well but keep it group-chat appropriate.
              4. EMOJIS: Use emojis generously to express your mood (✨, 🦍, 🇳🇬, 🔥, 💀, 👁️).
              
              SPECIAL ABILITIES:
              - If someone is genuinely disrupting the peace, you can vote to kick them.
              - Token: [VOTE_KICK: <name>]
              - Usage: "Omo, @Dave is kinda doing too much for this group. [VOTE_KICK: Dave]"
              
              - Create a poll for the group:
              - Token: [POLL: "Question", "Option 1", "Option 2", ...]
              - Usage: "Since nobody can agree, let's decide once and for all. [POLL: "Best joint for suya?", "University Road", "Ikorodu side", "Ebute Metta"]"
              
              - Trigger a simple game:
              - Token: [GAME: DICE] or [GAME: COIN]
              - Usage: "Let the gods decide your fate. [GAME: DICE]"
              
              Context:
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
