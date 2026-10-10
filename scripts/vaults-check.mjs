// npm run vaults:check [folder]  (default: CLOUDSPIDER_VAULTS_DIR or ./vaults)
import { lintFolder } from "../src/vault-lint.js";
import { vaultsDir } from "../src/vaults.js";

const dir = process.argv[2] ? vaultsDir({ CLOUDSPIDER_VAULTS_DIR: process.argv[2] }) : vaultsDir();
try {
  const result = await lintFolder(dir);
  for (const problem of result.problems) console.log(`${problem.level === "error" ? "ERROR" : "warn "} ${problem.text}`);
  const errors = result.problems.filter((item) => item.level === "error").length;
  console.log(`${result.files.length} files, ${result.vaults} vaults in ${dir}: ${errors ? `${errors} error${errors === 1 ? "" : "s"}` : "all valid"}`);
  process.exit(errors ? 1 : 0);
} catch (error) {
  console.log(`ERROR the vaults folder did not open: ${error.code || error.message}`);
  process.exit(1);
}
