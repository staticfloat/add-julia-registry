const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const tmp = require("tmp");
const toml = require("toml");

const core = require("@actions/core");
const exec = require("@actions/exec");
const io = require("@actions/io");

const HOME = os.homedir();
const DEPOT_PATH = (process.env.JULIA_DEPOT_PATH || path.join(HOME, ".julia")).split(path.delimiter);

async function startAgent() {
  const { stdout } = await exec.getExecOutput("ssh-agent");
  stdout.split("\n").forEach(line => {
    const match = /(.*)=(.*?);/.exec(line);
    if (match) {
      core.exportVariable(match[1], match[2]);
    }
  });
}

async function addKey(key) {
  const { name } = tmp.fileSync();
  fs.writeFileSync(name, key.trim() + "\n");
  await exec.exec(`ssh-add ${name}`);
  await io.rmRF(name);
}

async function updateKnownHosts() {
  // Ensure that `known_hosts` always exists
  const known_hosts_path = path.join(home, ".ssh", "known_hosts");
  fs.ensureFileSync(known_hosts_path);
  
  // If we don't already have a mapping for `github.com`, get it automatically
  if ((await exec.exec("ssh-keygen", ["-F", "github.com"], { ignoreReturnCode: true })) != 0) {
    const { stdout } = await exec.getExecOutput("ssh-keyscan github.com");
    fs.appendFileSync(known_hosts_path, stdout);
  }
}

async function cloneRegistry(registry) {
  const { name: tmpdir, removeCallback: tmpdirCleanup } = tmp.dirSync({ unsafeCleanup: true });
  await exec.exec(`git clone git@github.com:${registry}.git ${tmpdir}`);
  const meta = toml.parse(fs.readFileSync(path.join(tmpdir, "Registry.toml")));
  const name = meta.name || registry.split("/")[1];
  const user_depot = DEPOT_PATH[0];
  const dest = path.join(user_depot, "registries", name);
  if (fs.existsSync(dest)) {
    tmpdirCleanup();
  } else {
    fs.moveSync(tmpdir, dest);
  }
  const general = path.join(user_depot, "registries", "General");
  if (!fs.existsSync(general)) {
    await exec.exec(`git clone git@github.com:JuliaRegistries/General.git ${general}`);
  }
};

async function configureGit() {
  await exec.exec("git config --global url.git@github.com:.insteadOf https://github.com/");
}

async function main() {
  const key = core.getInput("key", { required: true });
  const registry = core.getInput("registry", { required: true });

  await startAgent();
  await addKey(key);
  await updateKnownHosts();
  await cloneRegistry(registry);
  await configureGit();
}

if (!module.parent) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
