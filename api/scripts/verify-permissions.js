const { Database } = require('../src/db');
const db = new Database({ DB: null });

setTimeout(async () => {
  const r = await (await db.prepare('SELECT id, name FROM roles')).all();
  console.log('Roles:', r.results.map(x => x.id).join(', '));

  const p = await (await db.prepare('SELECT COUNT(*) as c FROM role_permissions')).first();
  console.log('Permission rows:', p.c);

  const up = await (await db.prepare('SELECT module_key, can_view, can_edit, can_approve, site_scope FROM role_permissions WHERE role_id = ?')).bind('user').all();
  console.log('\n--- Site User (user role) permissions ---');
  up.results.forEach(x => console.log(`  ${x.module_key}: view=${x.can_view} edit=${x.can_edit} approve=${x.can_approve} scope=${x.site_scope}`));

  console.log('\nALL OK ✅');
  process.exit(0);
}, 300);
