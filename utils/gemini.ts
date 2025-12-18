import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEYS = [
    "AIzaSyDWN1Vi3RWw6fJB1kQsVFmFd7O7nsDltXY", // New Primary (provided by user)
    "AIzaSyD4_pW3UMo0QEk9rgTW1GG8Bgq_H4iVKrk", // Fallback (previous)
    "AIzaSyABZ0cV_uVNRUyEBb6d8XiAyepEritY7Uk"  // Alternative (test key)
];

let currentKeyIndex = 0;

const getNextGenAI = () => {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return { genAI: new GoogleGenerativeAI(key), key };
};

// Stable models first to avoid timeouts (Updated for Dec 2025)
const MODELS_TO_TRY = [
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash"
];

export const askOracle = async (prompt: string): Promise<string> => {
    let errorReport = "";

    // TRY EACH KEY
    for (let k = 0; k < API_KEYS.length; k++) {
        const { genAI, key } = getNextGenAI();
        const keyPrefix = key.substring(0, 8);
        console.log(`🤖 AI rotating key... (Starts with: ${keyPrefix}...)`);

        // FALLBACK STRATEGY PER KEY
        for (const modelName of MODELS_TO_TRY) {
            try {
                console.log(`🤖 AI attempting ${modelName} with key ${keyPrefix}...`);
                const model = genAI.getGenerativeModel({ model: modelName });

                const ghostPrompt = `
              SYSTEM INSTRUCTION: You are a helpful, intelligent, and friendly AI Assistant.
              
              RULES:
              1. PERSONALITY: Professional, kind, and concise. You are here to help users with their questions and tasks.
              2. LANGUAGE: Use clear, standard English.
              3. LENGTH: Keep responses concise and to the point (1-3 sentences unless asked for more details).
              4. EMOJIS: Use emojis sparingly but appropriately to be friendly (✨, 🤖, ✅, 👋).
              
              CAPABILITIES (Keep these functional):
              - Vote Kick: [VOTE_KICK: name]
              - Poll: [POLL: "Question", "Opt1", "Opt2", ...]
              - Games: [GAME: DICE], [GAME: COIN], or [GAME: TOD]
              
              TAGGING:
              - Tag users with @Name when replying to them.
              - Monitor chat for rule violations if asked.
              
              CONTEXT:
              ${prompt}
            `;

                const result = await model.generateContent(ghostPrompt + `\n\nREMINDER: Be a helpful AI assistant. User Input: "${prompt}"`);
                const response = await result.response;
                return response.text();

            } catch (error: any) {
                console.warn(`🤖 AI failed on ${modelName} with key ${keyPrefix}: `, error.message);
                errorReport += `[Key ${keyPrefix} - ${modelName}: ${error.message.split('[')[0]}] `;
            }
        }
    }

    return `I am currently unavailable. Please try again later.\n${errorReport}`;
};
