import { useMemo, useState } from "react";
import JSZip from "jszip";
import "./simple-page.css";

const numberFormatter = new Intl.NumberFormat("id-ID");
const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

function toUsername(value) {
  return String(value ?? "").trim().replace(/^@/, "");
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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

function parseFollowers(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const data = entry?.string_list_data?.[0] ?? {};
      const username = toUsername(data.value);

      return username
        ? {
            username,
            profileUrl: data.href || `https://www.instagram.com/${username}/`,
            timestamp: normalizeTimestamp(data.timestamp),
          }
        : null;
    })
    .filter(Boolean);
}

function parseFollowing(raw) {
  const entries = raw?.relationships_following;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const data = entry?.string_list_data?.[0] ?? {};
      const username = toUsername(entry?.title || data.value);

      return username
        ? {
            username,
            profileUrl: data.href || `https://www.instagram.com/${username}/`,
            timestamp: normalizeTimestamp(data.timestamp),
          }
        : null;
    })
    .filter(Boolean);
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return dateFormatter.format(new Date(timestamp * 1000));
}

async function parseInstagramZip(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const followersFiles = entries.filter((entry) =>
    /(^|\/)followers(?:_\d+)?\.json$/i.test(entry.name)
  );
  const followingFile = entries.find((entry) => /(^|\/)following\.json$/i.test(entry.name));

  if (!followersFiles.length || !followingFile) {
    throw new Error("File followers dan following JSON tidak ditemukan di dalam ZIP.");
  }

  const followersRaw = await Promise.all(
    followersFiles.map(async (entry) => JSON.parse(await entry.async("string")))
  );
  const followingRaw = JSON.parse(await followingFile.async("string"));

  return {
    followers: dedupeAccounts(followersRaw.flatMap(parseFollowers)),
    following: dedupeAccounts(parseFollowing(followingRaw)),
    sourceFiles: [...followersFiles.map((entry) => entry.name), followingFile.name],
  };
}

export default function SimplePage() {
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [sortDirection, setSortDirection] = useState("desc");
  const [status, setStatus] = useState("Upload ZIP data export untuk memulai.");
  const [isLoading, setIsLoading] = useState(false);

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
      const parsed = await parseInstagramZip(file);
      setFollowers(parsed.followers);
      setFollowing(parsed.following);
      setStatus(
        `${file.name} berhasil diproses. Ditemukan ${parsed.sourceFiles.length} file JSON yang relevan.`
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
          <h1>Personal Instagram Archive Viewer</h1>
          <p className="simple-description">
            Analisis file export pribadi tanpa login, password, OTP, atau token.
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
        <h2 id="zip-guide-title">Cara Mendapatkan File JSON dari Instagram</h2>
        <ol>
          <li>Buka Instagram, masuk ke Profile &gt; Settings & Activity.</li>
          <li>Pilih Accounts center &gt; Your information and permissions.</li>
          <li>Klik Export your information.</li>
          <li>Klik Create export.</li>
          <li>Pilih akun yang mau diekspor datanya.</li>
          <li>Klik Export to device.</li>
          <li>Pada Customise information, clear all checkbox. Hanya checklist Followers & following</li>
          <li>Pilih format JSON.</li>
          <li>Klik Start export.</li>
          <li>Tunggu email dari Instagram, download file ZIP, lalu upload di bawah ini.</li>
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
                      <span>Upload ZIP export untuk menampilkan hasil perbandingan.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
