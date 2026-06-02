// Extension to count tokens (≈ 1 token per 4 characters)
// Payload is passed as a base64‑encoded JSON string via process.argv[2]
const base64 = process.argv[2];
if (!base64) {
  console.log(JSON.stringify({ error: "Missing input payload" }));
  process.exit(1);
}
let args;
try {
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  args = JSON.parse(decoded);
} catch (e) {
  console.log(JSON.stringify({ error: "Invalid payload format" }));
  process.exit(1);
}
const text = typeof args.text === "string" ? args.text : "";
function countTokens(str) {
  return Math.ceil(str.length / 4);
}
const result = { tokens: countTokens(text) };
console.log(JSON.stringify(result));