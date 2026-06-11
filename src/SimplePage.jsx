import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import "./simple-page.css";

const numberFormatter = new Intl.NumberFormat("id-ID");
const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});
const monthIndexByShortName = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function toUsername(value) {
  return String(value ?? "").trim().replace(/^@/, "");
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function usernameFromHref(href) {
  if (!href) {
    return "";
  }

  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (host === "instagram.com" && segments[0]?.toLowerCase() === "_u") {
      return toUsername(segments[1]);
    }

    if (
      (host === "instagram.com" || host === "threads.com" || host === "threads.net") &&
      segments.length === 1
    ) {
      return toUsername(segments[0]);
    }

    return "";
  } catch {
    return "";
  }
}

function isArchiveFile(entryName, type) {
  const normalized = entryName.toLowerCase().replace(/\\/g, "/");

  if (type === "followers") {
    return /(^|\/)(followers(?:_\d+)?|text_post_app_followers|text_post_app_text_post_app_followers)\.(json|html?)$/i.test(
      normalized
    );
  }

  return /(^|\/)(following|text_post_app_following|text_post_app_text_post_app_following)\.(json|html?)$/i.test(
    normalized
  );
}

function isHtmlFile(entryName) {
  return /\.html?$/i.test(entryName);
}

function isProfileHref(href) {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    const allowedHosts = new Set(["instagram.com", "threads.com", "threads.net"]);
    const blockedPaths = new Set([
      "about",
      "accounts",
      "developer",
      "direct",
      "explore",
      "help",
      "legal",
      "privacy",
      "reels",
      "stories",
      "terms",
    ]);

    if (!allowedHosts.has(host)) {
      return false;
    }

    const username = usernameFromHref(href);

    if (!username) {
      return false;
    }

    return Boolean(username) && !blockedPaths.has(username.toLowerCase());
  } catch {
    return false;
  }
}

function parseHtmlTimestamp(text) {
  const normalized = String(text ?? "")
    .replace(/&nbsp;|&#160;|&#8239;/gi, " ")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");
  const match = normalized.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(am|pm)\b/i
  );

  if (!match) {
    return 0;
  }

  const [, monthName, day, year, hour, minute, meridiem] = match;
  const month = monthIndexByShortName[monthName.toLowerCase()];
  let parsedHour = Number(hour);

  if (!Number.isInteger(month) || parsedHour < 1 || parsedHour > 12) {
    return 0;
  }

  if (meridiem.toLowerCase() === "pm" && parsedHour !== 12) {
    parsedHour += 12;
  }

  if (meridiem.toLowerCase() === "am" && parsedHour === 12) {
    parsedHour = 0;
  }

  return Math.round(
    new Date(Number(year), month, Number(day), parsedHour, Number(minute)).getTime() / 1000
  );
}

function getMetaHtmlCards(html) {
  return [...String(html).matchAll(/<div class="pam\b[\s\S]*?(?=<div class="pam\b|<\/main>)/gi)].map(
    (match) => match[0]
  );
}

function getHrefFromHtml(html) {
  const match = String(html).match(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/i);
  return match?.[1] ?? "";
}

function parseHtmlAccountCardSource(cardHtml, getFallbackProfileUrl) {
  const href = getHrefFromHtml(cardHtml);

  if (!isProfileHref(href)) {
    return null;
  }

  const username = usernameFromHref(href);

  return username
    ? {
        username,
        profileUrl: href || getFallbackProfileUrl(username),
        timestamp: parseHtmlTimestamp(cardHtml),
      }
    : null;
}

function parseHtmlAccountCard(card, getFallbackProfileUrl) {
  const link = Array.from(card.querySelectorAll("a[href]")).find((anchor) =>
    isProfileHref(anchor.href)
  );

  if (!link) {
    return null;
  }

  const username = usernameFromHref(link.href);

  return username
    ? {
        username,
        profileUrl: link.href || getFallbackProfileUrl(username),
        timestamp: parseHtmlTimestamp(card.textContent),
      }
    : null;
}

function parseRelationshipHtml(html, getFallbackProfileUrl) {
  const sourceCards = getMetaHtmlCards(html);

  if (sourceCards.length) {
    return sourceCards
      .map((cardHtml) => parseHtmlAccountCardSource(cardHtml, getFallbackProfileUrl))
      .filter(Boolean);
  }

  if (typeof DOMParser === "undefined") {
    return [];
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const cards = Array.from(document.querySelectorAll(".pam"));

  if (cards.length) {
    return cards.map((card) => parseHtmlAccountCard(card, getFallbackProfileUrl)).filter(Boolean);
  }

  return Array.from(document.querySelectorAll("a[href]"))
    .filter((link) => isProfileHref(link.href))
    .map((link) => {
      const username = usernameFromHref(link.href);
      const textScope =
        link.closest("li, div, section, article")?.textContent ||
        link.parentElement?.textContent ||
        "";

      return username
        ? {
            username,
            profileUrl: link.href || getFallbackProfileUrl(username),
            timestamp: parseHtmlTimestamp(textScope),
          }
        : null;
    })
    .filter(Boolean);
}

function getEntryData(entry) {
  if (entry?.string_list_data?.[0]) {
    return entry.string_list_data[0];
  }

  if (entry?.string_map_data && typeof entry.string_map_data === "object") {
    const values = Object.values(entry.string_map_data);
    return values.find((value) => value?.value || value?.href || value?.timestamp) ?? {};
  }

  return {};
}

function dedupeAccounts(accounts) {
  const map = new Map();

  for (const account of accounts) {
    const key = account.username.toLowerCase();
    const existing = map.get(key);

    if (!existing || account.timestamp >= existing.timestamp) {
      map.set(key, account);
    }
  }

  return [...map.values()];
}

function parseRelationshipEntries(entries, getFallbackProfileUrl) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const data = getEntryData(entry);
      const username = toUsername(
        data.value ||
          entry?.username ||
          entry?.value ||
          usernameFromHref(data.href || entry?.href) ||
          entry?.title ||
          data.value ||
          ""
      );

      return username
        ? {
            username,
            profileUrl: data.href || entry?.href || getFallbackProfileUrl(username),
            timestamp: normalizeTimestamp(data.timestamp || entry?.timestamp),
          }
        : null;
    })
    .filter(Boolean);
}

function getFollowersSource(raw) {
  return (
    raw?.relationships_followers ??
    raw?.text_post_app_text_post_app_followers ??
    raw?.text_post_app_followers ??
    raw?.followers ??
    raw?.followers_list ??
    raw
  );
}

function getFollowingSource(raw) {
  return (
    raw?.relationships_following ??
    raw?.text_post_app_text_post_app_following ??
    raw?.text_post_app_following ??
    raw?.following ??
    raw?.following_list ??
    raw
  );
}

function findRelationshipArrays(raw) {
  if (Array.isArray(raw)) {
    return [raw];
  }

  const arrays = [];
  const seen = new Set();

  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      if (
        value.some(
          (entry) =>
            entry?.string_list_data ||
            entry?.string_map_data ||
            entry?.title ||
            entry?.username ||
            entry?.value ||
            entry?.href
        )
      ) {
        arrays.push(value);
      }
      value.forEach(visit);
      return;
    }

    Object.values(value).forEach(visit);
  };

  visit(raw);
  return arrays;
}

function parseFollowers(raw, getFallbackProfileUrl) {
  return findRelationshipArrays(getFollowersSource(raw)).flatMap((entries) =>
    parseRelationshipEntries(entries, getFallbackProfileUrl)
  );
}

function parseFollowing(raw, getFallbackProfileUrl) {
  return findRelationshipArrays(getFollowingSource(raw)).flatMap((entries) =>
    parseRelationshipEntries(entries, getFallbackProfileUrl)
  );
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return dateFormatter.format(new Date(timestamp * 1000));
}

function countDatedAccounts(accounts) {
  return accounts.filter((account) => account.timestamp > 0).length;
}

async function requestUsageCount(method = "GET") {
  const response = await fetch("/api/usage", {
    method,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Counter penggunaan belum tersedia.");
  }

  const data = await response.json();
  return Number(data.count ?? 0);
}

async function parseArchiveEntry(entry, type, getFallbackProfileUrl) {
  const content = await entry.async("string");

  if (isHtmlFile(entry.name)) {
    return parseRelationshipHtml(content, getFallbackProfileUrl);
  }

  const raw = JSON.parse(content);
  return type === "followers"
    ? parseFollowers(raw, getFallbackProfileUrl)
    : parseFollowing(raw, getFallbackProfileUrl);
}

async function parseMetaArchiveZip(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const followersFiles = entries.filter((entry) => isArchiveFile(entry.name, "followers"));
  const followingFile = entries.find((entry) => isArchiveFile(entry.name, "following"));
  const isThreadsArchive =
    /threads/i.test(file.name) ||
    entries.some((entry) => /(^|\/)threads(\/|_)|text_post_app/i.test(entry.name));
  const getFallbackProfileUrl = (username) =>
    isThreadsArchive
      ? `https://www.threads.com/${username}`
      : `https://www.instagram.com/${username}/`;

  if (!followersFiles.length || !followingFile) {
    throw new Error("File followers dan following JSON/HTML tidak ditemukan di dalam ZIP export.");
  }

  const followersRaw = await Promise.all(
    followersFiles.map((entry) => parseArchiveEntry(entry, "followers", getFallbackProfileUrl))
  );
  const followingRaw = await parseArchiveEntry(followingFile, "following", getFallbackProfileUrl);
  const followers = dedupeAccounts(followersRaw.flat());
  const following = dedupeAccounts(followingRaw);

  if (!followers.length && !following.length) {
    throw new Error(
      "File JSON/HTML terdeteksi, tetapi isi followers/following tidak bisa dibaca. Pastikan ZIP berasal dari export Followers & following."
    );
  }

  return {
    followers,
    following,
    sourceFiles: [...followersFiles.map((entry) => entry.name), followingFile.name],
  };
}

export default function SimplePage() {
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [sortDirection, setSortDirection] = useState("desc");
  const [status, setStatus] = useState("Upload ZIP export Instagram atau Threads untuk memulai.");
  const [isLoading, setIsLoading] = useState(false);
  const [usageCount, setUsageCount] = useState(null);

  useEffect(() => {
    let isMounted = true;

    requestUsageCount()
      .then((count) => {
        if (isMounted) {
          setUsageCount(count);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUsageCount(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const followersSet = useMemo(
    () => new Set(followers.map((account) => account.username.toLowerCase())),
    [followers]
  );

  const notFollbackAccounts = useMemo(() => {
    return following
      .filter((account) => !followersSet.has(account.username.toLowerCase()))
      .sort((a, b) =>
        sortDirection === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
      );
  }, [following, followersSet, sortDirection]);

  const mutualCount = following.length - notFollbackAccounts.length;
  const follbackRate = following.length ? (mutualCount / following.length) * 100 : 0;

  const handleZipUpload = async (file) => {
    if (!file) {
      return;
    }

    setIsLoading(true);
    setStatus("Membaca dan mengekstrak file ZIP...");

    try {
      const parsed = await parseMetaArchiveZip(file);
      setFollowers(parsed.followers);
      setFollowing(parsed.following);

      let latestUsageCount = usageCount;

      try {
        latestUsageCount = await requestUsageCount("POST");
        setUsageCount(latestUsageCount);
      } catch {
        latestUsageCount = usageCount;
      }

      setStatus(
        `${file.name} berhasil diproses. Ditemukan ${parsed.sourceFiles.length} file JSON/HTML yang relevan. Tanggal terbaca: following ${countDatedAccounts(parsed.following)}/${parsed.following.length}, followers ${countDatedAccounts(parsed.followers)}/${parsed.followers.length}.${latestUsageCount === null ? "" : ` Total penggunaan berhasil: ${numberFormatter.format(latestUsageCount)}.`}`
      );
    } catch (error) {
      setFollowers([]);
      setFollowing([]);
      setStatus(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="simple-shell">
      <header className="simple-header">
        <div>
          <h1>FollowLens Archive Viewer</h1>
          <p className="simple-description">
            Cek relasi followers dan following dari file export Instagram atau Threads.
          </p>
        </div>
      </header>

      <section className="privacy-note" aria-label="Catatan privasi">
        <strong>Privasi data</strong>
        <p>
          File ZIP diproses langsung di browser Anda. Aplikasi ini tidak meminta login,
          password, OTP, token, atau akses akun. Data tidak dikirim ke server dan tidak
          disimpan di database.
        </p>
      </section>

      <section className="zip-guide" aria-labelledby="zip-guide-title">
        <h2 id="zip-guide-title">Cara Mendapatkan File Export dari Instagram atau Threads</h2>
        <ol>
          <li>Buka Instagram atau Threads, masuk ke Profile &gt; Settings & Activity.</li>
          <li>Pilih Accounts Center &gt; Your information and permissions.</li>
          <li>Klik Export your information.</li>
          <li>Klik Create export.</li>
          <li>Pilih akun yang mau diekspor datanya.</li>
          <li>Klik Export to device.</li>
          <li>Pada Customise information, clear all checkbox. Hanya checklist Followers & following</li>
          <li>Pilih format JSON atau HTML. JSON direkomendasikan karena struktur datanya lebih stabil.</li>
          <li>Klik Start export.</li>
          <li>Tunggu email dari Meta, download file ZIP, lalu upload di bawah ini.</li>
        </ol>

        <label className={`zip-upload ${isLoading ? "is-loading" : ""}`}>
          <span>{isLoading ? "Memproses ZIP..." : "Upload ZIP export"}</span>
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={isLoading}
            onChange={(event) => handleZipUpload(event.target.files?.[0])}
          />
        </label>
      </section>

      <p className="simple-status" role="status">
        {status}
      </p>

      {usageCount !== null ? (
        <div className="usage-counter" aria-label="Jumlah penggunaan berhasil">
          <span>Sudah dipakai</span>
          <strong>{numberFormatter.format(usageCount)} kali</strong>
        </div>
      ) : null}

      <section className="simple-stats" aria-label="Ringkasan akun">
        <article>
          <span>Total Following</span>
          <strong>{numberFormatter.format(following.length)}</strong>
        </article>
        <article>
          <span>Total Followers</span>
          <strong>{numberFormatter.format(followers.length)}</strong>
        </article>
        <article>
          <span>Tidak Follback</span>
          <strong>{numberFormatter.format(notFollbackAccounts.length)}</strong>
        </article>
        <article>
          <span>Follback Rate</span>
          <strong>{follbackRate.toFixed(1)}%</strong>
        </article>
      </section>

      <section className="simple-table-section">
        <div className="simple-section-head">
          <div>
            <p className="simple-kicker">Daftar Tidak Follback</p>
            <h2>{numberFormatter.format(notFollbackAccounts.length)} akun</h2>
          </div>
        </div>

        <div className="simple-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="simple-col-no">No</th>
                <th>Username</th>
                <th>
                  <button
                    className="simple-sort"
                    type="button"
                    onClick={() =>
                      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                    }
                  >
                    Tanggal {sortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th className="simple-col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {notFollbackAccounts.length ? (
                notFollbackAccounts.map((account, index) => (
                  <tr key={account.username}>
                    <td data-label="No">{index + 1}</td>
                    <td data-label="Username">
                      <strong className="simple-username">{account.username}</strong>
                    </td>
                    <td data-label="Tanggal">{formatTimestamp(account.timestamp)}</td>
                    <td data-label="Action">
                      <a
                        className="simple-profile-link"
                        href={account.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>Buka profile</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="simple-empty">
                      <strong>Belum ada data</strong>
                      <span>Upload ZIP export Instagram atau Threads untuk menampilkan hasil.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <a
        className="floating-credit"
        href="https://kresnawijaya.web.id"
        target="_blank"
        rel="noreferrer"
        aria-label="Dibuat oleh Kresna Wijaya"
      >
        By Kresna Wijaya
      </a>
    </main>
  );
}
