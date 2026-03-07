require("dotenv").config();
console.log("KEY exists:", process.env.ANTHROPIC_API_KEY ? "yes" : "no");
console.log("KEY prefix:", (process.env.ANTHROPIC_API_KEY || "").substring(0, 15));
