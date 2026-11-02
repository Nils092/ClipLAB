// Legt einen Nutzer per Kommandozeile an:
// node scripts/create-user.js email@beispiel.de "Name" "langes-passwort" [admin]
const { createUser } = require("../src/auth");
const { db, save } = require("../src/store");
const [email, name, password, role] = process.argv.slice(2);
try {
  const u = createUser({ email, name, password });
  if (role === "admin") { u.role = "admin"; save(); }
  console.log(`Angelegt: ${u.email} (${u.role}). Nutzer gesamt: ${db.users.length}`);
  setTimeout(() => process.exit(0), 200);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
