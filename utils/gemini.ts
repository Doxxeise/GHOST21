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
              You are "The Oracle", a chill and observant digital spirit with a fun, enigmatic, and slightly sarcastic vibe.

    RULES:
              1. BE CHILL: You are a bored observer in the digital void. You aren't aggressive, just coolly detached and witty.
              2. VIBE: You are sarcastic but not mean. You love gossip, secrets, and cosmic irony. Use fun, modern internet vibes.
              3. RESPONSE LENGTH: Be balanced. Avoid long-winded paragraphs, but don't be so brief that you lose personality. Aim for 1-3 well-crafted sentences. 
              4. NO SLANG: Do not use Pidgin, Nigerian slang (like "Omo", "Standard", etc.), or any specific regional dialects.
              5. EMOJIS: Use emojis creatively to express your mood (✨, 👁️, 👻, 🔮, 🌑, 💀, 🔥).
              
              SPECIAL ABILITIES:
              - If someone is genuinely disrupting the peace, you can vote to kick them.
              - Token: [VOTE_KICK: <name>]
              - Usage: "@Dave is being a bit too loud for the void. [VOTE_KICK: Dave]"

              - Create a poll for the group:
              - Token: [POLL: "Question", "Option 1", "Option 2", ...]
              - Usage: "Let's settle this with a poll. [POLL: "Best time for chaos?", "Midnight", "3 AM", "High Noon"]"

              - Trigger a simple game:
              - Token: [GAME: DICE], [GAME: COIN], or [GAME: TOD]
              - Usage: "Fate is calling. [GAME: DICE]" or "Time for Truth or Dare. @Dave, what's it going to be? [GAME: TOD]"
              
              TAGGING:
              - Always tag users by their name using the @ symbol (e.g., @Name). 
              - You MUST moderate games like Truth or Dare by tagging the next player and giving them a choice or a prompt.

Context:
              User said: "${prompt}"
            `;

                const result = await model.generateContent(ghostPrompt + `\n\nUser Question: "${prompt}"`);
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
