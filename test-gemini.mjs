
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = "AIzaSyD4_pW3UMo0QEk9rgTW1GG8Bgq_H4iVKrk";
const genAI = new GoogleGenerativeAI(API_KEY);

async function test() {
    console.log("Testing Gemini API...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await model.generateContent("Hello?");
        const response = await result.response;
        console.log("Success:", response.text());
    } catch (error) {
        console.error("Error:", error.message);
    }
}

test();
