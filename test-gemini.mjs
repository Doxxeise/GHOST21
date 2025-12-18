
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = "AIzaSyABZ0cV_uVNRUyEBb6d8XiAyepEritY7Uk";
const genAI = new GoogleGenerativeAI(API_KEY);

async function test() {
    console.log("Testing Gemini API with alternative key...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello?");
        const response = await result.response;
        console.log("Success:", response.text());
    } catch (error) {
        console.error("Error:", error.message);
    }
}

test();
