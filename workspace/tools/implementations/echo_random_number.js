// echo_random_number.js
// This script receives a base64‑encoded JSON payload via process.argv[2]
// and returns a random integer between the provided min and max (inclusive).

const base64Args = process.argv[2];
if (!base64Args) {
  console.log(JSON.stringify({ error: "Missing arguments payload." }));
  process.exit(1);
}

let args;
try {
  args = JSON.parse(Buffer.from(base64Args, "base64").toString("utf-8"));
} catch (e) {
  console.log(JSON.stringify({ error: "Invalid base64 JSON payload." }));
  process.exit(1);
}

async function main() {
  const min = Number.isInteger(args.min) ? args.min : 1;
  const max = Number.isInteger(args.max) ? args.max : 100;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const randomInt = Math.floor(Math.random() * (high - low + 1)) + low;

  console.log(JSON.stringify({ success: true, random: randomInt }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
