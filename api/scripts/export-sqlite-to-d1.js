const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'recon-erp.sqlite');
const outPath = path.join(__dirname, '..', 'd1-import.sql');

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const outStream = fs.createWriteStream(outPath, { encoding: 'utf8' });

function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

console.log('Generating D1-compatible SQL dump from:', dbPath);

outStream.write('-- RECON ERP D1 Import Dump\n');
outStream.write('PRAGMA foreign_keys = OFF;\n');
outStream.write('PRAGMA defer_foreign_keys = TRUE;\n\n');

// 1. Get all user tables in their creation order from sqlite_master
const tables = db.prepare(`
  SELECT name, sql 
  FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
  ORDER BY rowid ASC
`).all();

// 2. Drop existing tables in reverse order
outStream.write('-- Drop existing tables\n');
for (let i = tables.length - 1; i >= 0; i--) {
  outStream.write(`DROP TABLE IF EXISTS "${tables[i].name}";\n`);
}
outStream.write('\n');

// 3. Create tables in original creation order
outStream.write('-- Create tables\n');
for (const t of tables) {
  outStream.write(`${t.sql};\n`);
}
outStream.write('\n');

// 4. Insert data for each table
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
  if (rows.length > 0) {
    outStream.write(`-- Data for ${t.name} (${rows.length} rows)\n`);
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
    const colList = cols.map(c => `"${c}"`).join(', ');

    for (const row of rows) {
      let needsChunking = false;
      let chunkCol = null;
      let chunkVal = '';

      for (const col of cols) {
        const val = row[col];
        if (typeof val === 'string' && val.length > 60000) {
          needsChunking = true;
          chunkCol = col;
          chunkVal = val;
          break;
        }
      }

      if (!needsChunking) {
        const values = cols.map(c => escapeSqlValue(row[c])).join(', ');
        outStream.write(`INSERT INTO "${t.name}" (${colList}) VALUES (${values});\n`);
      } else {
        const CHUNK_SIZE = 40000;
        const initialChunk = chunkVal.slice(0, CHUNK_SIZE);
        const rowCopy = { ...row, [chunkCol]: initialChunk };
        const values = cols.map(c => escapeSqlValue(rowCopy[c])).join(', ');
        outStream.write(`INSERT INTO "${t.name}" (${colList}) VALUES (${values});\n`);

        const pkCols = db.prepare(`PRAGMA table_info("${t.name}")`).all().filter(c => c.pk > 0);
        let whereClause = '';
        if (pkCols.length > 0) {
          whereClause = pkCols.map(c => `"${c.name}" = ${escapeSqlValue(row[c.name])}`).join(' AND ');
        } else {
          whereClause = `rowid = (SELECT max(rowid) FROM "${t.name}")`;
        }

        for (let i = CHUNK_SIZE; i < chunkVal.length; i += CHUNK_SIZE) {
          const nextChunk = chunkVal.slice(i, i + CHUNK_SIZE);
          outStream.write(`UPDATE "${t.name}" SET "${chunkCol}" = "${chunkCol}" || ${escapeSqlValue(nextChunk)} WHERE ${whereClause};\n`);
        }
      }
    }
    outStream.write('\n');
  }
}

// 5. Create indexes
const indexes = db.prepare(`
  SELECT sql 
  FROM sqlite_master 
  WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY rowid ASC
`).all();

outStream.write('-- Indexes\n');
for (const idx of indexes) {
  outStream.write(`${idx.sql};\n`);
}

outStream.end(() => {
  console.log('D1-compatible dump created at:', outPath);
});
