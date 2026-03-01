const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }

  const sqlDir = path.resolve(__dirname, "../sql");
  const sqlFiles = fs
    .readdirSync(sqlDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query("begin");
    for (const fileName of sqlFiles) {
      const sqlPath = path.join(sqlDir, fileName);
      const sql = fs.readFileSync(sqlPath, "utf8");
      await pool.query(sql);
      console.log(`Migration aplicada: ${fileName}`);
    }
    await pool.query("commit");
    console.log("Queue migration aplicada com sucesso.");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
