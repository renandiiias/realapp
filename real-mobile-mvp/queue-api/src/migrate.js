const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }

  const sqlPath = path.resolve(__dirname, "../sql/init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query("begin");
    await pool.query(sql);
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
