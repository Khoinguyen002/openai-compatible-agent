const { google } = require("googleapis");
const fs = require("fs");
const mcpConfig = JSON.parse(fs.readFileSync("/Users/admin/.gemini/config/mcp_config.json", "utf8"));
const env = mcpConfig.mcpServers["doc-mcp"].env;
const clientEmail = env.DOC_MCP_GOOGLE_CLIENT_EMAIL;
let privateKey = env.DOC_MCP_GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

async function read() {
  try {
    const res = await drive.files.export({
      fileId: "1Lb7OKmlaGvJtBwjiatsTuJS5Ck4OntNalbxNnvQDE78",
      mimeType: "text/plain",
    });
    console.log(res.data);
  } catch (err) {
    console.error(err);
  }
}
read();
