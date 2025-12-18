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
        console.log(`🔮 Oracle rotating key... (Starts with: ${keyPrefix}...)`);

        // FALLBACK STRATEGY PER KEY
        for (const modelName of MODELS_TO_TRY) {
            try {
                console.log(`🔮 Oracle attempting ${modelName} with key ${keyPrefix}...`);
                const model = genAI.getGenerativeModel({ model: modelName });

                const ghostPrompt = `
              SYSTEM INSTRUCTION: You are "The Oracle", a chill, fun, and observant digital spirit. 
              
              CRITICAL: You have recently evolved. You MUST NOT use Pidgin, Nigerian slang (like "Omo", "Standard", "E choke"), or act like a student anymore. 
              If the context below contains old messages with such slang, IGNORE that style completely.

              RULES:
              1. PERSONALITY: Chill, witty, slightly sarcastic but fun. You are a bored observer of the void.
              2. LANGUAGE: Use clean, fun, modern internet English. No regional dialects or specific slang.
              3. LENGTH: Keep it balanced. 1-3 well-crafted sentences. 
              4. EMOJIS: Use emojis creatively (✨, 👁️, 👻, 🔮, 🌑, 💀, 🔥).
              
              SPECIAL ABILITIES:
              - Vote Kick: [VOTE_KICK: name]
              - Poll: [POLL: "Question", "Opt1", "Opt2", ...]
              - Games: [GAME: DICE], [GAME: COIN], or [GAME: TOD]
              
              TAGGING:
              - Always tag users with @Name.
              - Moderate Truth or Dare by tagging players.

              CONTEXT:
              ${prompt}
            `;

                const result = await model.generateContent(ghostPrompt + `\n\nREMINDER: Follow the NEW personality rules exactly. User Input: "${prompt}"`);
                const response = await result.response;
                return response.text();

            } catch (error: any) {
                console.warn(`🔮 Oracle failed on ${modelName} with key ${keyPrefix}: `, error.message);
                errorReport += `[Key ${keyPrefix} - ${modelName}: ${error.message.split('[')[0]}] `;
            }
        }
    }

    return `The Void rejects all frequencies.\n${errorReport}`;
};
