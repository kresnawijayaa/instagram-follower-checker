import pg from "pg";

const { Pool } = pg;

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL belum diset.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function ensureUsageTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_usage (
      id text PRIMARY KEY,
      success_count bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    INSERT INTO app_usage (id, success_count)
    VALUES ('archive_upload_success', 0)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function getUsageCount(client) {
  const result = await client.query(
    "SELECT success_count FROM app_usage WHERE id = 'archive_upload_success'"
  );

  return Number(result.rows[0]?.success_count ?? 0);
}

async function incrementUsageCount(client) {
  const result = await client.query(`
    INSERT INTO app_usage (id, success_count, updated_at)
    VALUES ('archive_upload_success', 1, now())
    ON CONFLICT (id)
    DO UPDATE SET
      success_count = app_usage.success_count + 1,
      updated_at = now()
    RETURNING success_count
  `);

  return Number(result.rows[0]?.success_count ?? 0);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const client = getPool();
    await ensureUsageTable(client);

    const count =
      request.method === "POST" ? await incrementUsageCount(client) : await getUsageCount(client);

    return response.status(200).json({ count });
  } catch (error) {
    return response.status(500).json({
      error: "Usage counter gagal diproses.",
      detail: error.message,
    });
  }
}
