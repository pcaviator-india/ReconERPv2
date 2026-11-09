const { Database } = require('../src/db');
process.env.DB_PATH = require('path').join(__dirname, '..', 'recon-erp.sqlite');
const db = new Database({});
(async () => {
  const rows = await (await db.prepare(`
    SELECT p.geo, c.name as category_name, sc.name as sub_category_name, b.name as brand_name, s.name as supplier_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.is_active = 1 AND p.category_id IS NOT NULL
    LIMIT 10
  `)).all();
  console.log('Sample products with names:', rows.results);

  const orphans = await (await db.prepare(
    'SELECT count(*) as c FROM products WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories)'
  )).first();
  console.log('Orphan category_id products (expect 0):', orphans.c);

  // Check the distinct category names we would see in the filter dropdown
  const catNames = await (await db.prepare(`
    SELECT DISTINCT c.name FROM products p
    JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND c.name IS NOT NULL
    ORDER BY c.name
  `)).all();
  console.log('Distinct categories in filter dropdown:', catNames.results);
})();

