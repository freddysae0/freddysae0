// Rewrites the open source contributions table in README.md from the
// merged pull requests the user has opened in public repos they don't own.
import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER ?? "freddysae0";
const TOKEN = process.env.GITHUB_TOKEN;
const README = new URL("../README.md", import.meta.url);
// Orgs whose PRs are day-job work rather than open source contributions.
const EXCLUDED_ORGS = ["mediquo"];
const START = "<!-- CONTRIBUTIONS:START -->";
const END = "<!-- CONTRIBUTIONS:END -->";

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function mergedPullRequests() {
  const excluded = EXCLUDED_ORGS.map((org) => `-org:${org}`).join(" ");
  const q = encodeURIComponent(`author:${USER} is:pr is:merged is:public -user:${USER} ${excluded}`);
  const prs = [];
  for (let page = 1; page <= 10; page++) {
    const { items } = await gh(`/search/issues?q=${q}&per_page=100&page=${page}`);
    prs.push(...items);
    if (items.length < 100) break;
  }
  return prs;
}

const prs = await mergedPullRequests();
const byRepo = Map.groupBy(prs, (pr) => pr.repository_url.replace("https://api.github.com/repos/", ""));

const rows = await Promise.all(
  [...byRepo].map(async ([name, list]) => {
    const repo = await gh(`/repos/${name}`);
    const last = list.map((pr) => pr.pull_request.merged_at).sort().at(-1);
    return { name, repo, count: list.length, last };
  }),
);
rows.sort((a, b) => b.repo.stargazers_count - a.repo.stargazers_count || b.count - a.count);

const prsUrl = (name) =>
  `https://github.com/${name}/pulls?q=${encodeURIComponent(`is:pr is:merged author:${USER}`)}`;
const escape = (text) => (text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

const table = [
  "| Project | | Merged PRs | Last merged |",
  "| :-- | :-- | --: | :-- |",
  ...rows.map(({ name, repo, count, last }) =>
    `| [**${name}**](${repo.html_url})<br><sub>${escape(repo.description)}</sub> ` +
      `| ⭐ ${repo.stargazers_count.toLocaleString("en-US")}${repo.language ? ` · ${repo.language}` : ""} ` +
      `| [${count}](${prsUrl(name)}) | ${last.slice(0, 7)} |`,
  ),
].join("\n");

const readme = await readFile(README, "utf8");
const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!pattern.test(readme)) throw new Error("Contribution markers not found in README.md");
await writeFile(README, readme.replace(pattern, `${START}\n${table}\n${END}`));
console.log(`Updated ${rows.length} projects from ${prs.length} merged PRs`);
