import { testEnv } from "./test-env.js";

// Runs in each test file before the app's modules load, so config/env.ts sees these values
// (dotenv never overrides a variable that is already set).
Object.assign(process.env, testEnv);
