const path = require('path');
const auth = require(path.join(__dirname, '..', 'authModel'));

try {
  const admins = auth.getAllAdmins();
  console.log('Admins file dump:');
  console.log(JSON.stringify(admins, null, 2));
} catch (e) {
  console.error('Error dumping admins:', e.message);
}
