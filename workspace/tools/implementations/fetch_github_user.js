// 1. Lấy chuỗi mã hóa Base64 từ đối số dòng lệnh (CLI Argument)
const base64Args = process.argv[2];

if (!base64Args) {
  console.log(JSON.stringify({ error: "Missing arguments" }));
  process.exit(1);
}

// 2. Giải mã chuỗi Base64 sang JSON Object
const args = JSON.parse(Buffer.from(base64Args, "base64").toString("utf-8"));

async function main() {
  const username = args.username;

  // 3. Thực hiện logic lấy data từ GitHub API
  const response = await fetch(`https://api.github.com/users/${username}`, {
    headers: {
      "User-Agent": "OpenRouter-Agent-Sandbox",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API trả về lỗi: ${response.status}`);
  }

  const data = await response.json();

  // 4. Lọc lấy những thông tin cần thiết nhất để tối ưu token cho LLM
  const profile = {
    name: data.name,
    bio: data.bio,
    public_repos: data.public_repos,
    followers: data.followers,
    html_url: data.html_url,
  };

  // CHÍ MẠNG: Phải console.log duy nhất chuỗi JSON này để Server chính hứng stdout
  console.log(JSON.stringify(profile));
}

main().catch((err) => {
  // Nếu có lỗi, cũng phải log ra dạng JSON để cấu trúc không bị vỡ
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
