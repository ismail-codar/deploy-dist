#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULTS, deploy, DeployError } from "../lib/deploy.mjs";

const HELP = `deploy-dist — build çıktısını ayrı bir git branch worktree'sine deploy eder.

Kullanım:
  deploy-dist [seçenekler]

Akış:
  1. <dir> dizininin <branch> branch'inin worktree'si olduğunu doğrular.
  2. (varsa) ignore satırlarını <dir>/.gitignore'a yazar.
  3. Değişiklik yoksa çıkar.
  4. Son deploy'dan bu yana kaynak branch commit'lerini toplayıp
     deploy commit mesajına derler ("build: <branch>@<sha>" footer'ı ile).
  5. Commit'leyip <remote> <branch>'e push eder.

Seçenekler:
  --dir <path>          Worktree dizini (varsayılan: ${DEFAULTS.dir})
  --branch <name>       Hedef branch (varsayılan: ${DEFAULTS.branch})
  --remote <name>       Push remote'u (varsayılan: ${DEFAULTS.remote})
  --ignore <a,b,c>      .gitignore satırları (virgülle ayrık). Birden çok kez verilebilir.
  --cwd <path>          Kaynak repo kökü (varsayılan: cwd)
  --no-push             Commit at ama push etme
  --config <path>       Config JSON dosyası (varsayılan: <cwd>/.deploy-dist.json)
  -h, --help            Bu yardım

Config çözümleme (artan öncelik):
  defaults  <  package.json "deployDist" alanı  <  config dosyası  <  CLI flag'leri

Config dosyası örneği (.deploy-dist.json):
  {
    "dir": "dist",
    "branch": "dist",
    "remote": "origin",
    "ignore": ["models", "tiles", "textures"]
  }

İlk kurulum:
  git worktree add <dir> <branch>
`;

function parseArgs(argv) {
  const out = {};
  const ignore = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--dir":
        out.dir = next();
        break;
      case "--branch":
        out.branch = next();
        break;
      case "--remote":
        out.remote = next();
        break;
      case "--cwd":
        out.cwd = next();
        break;
      case "--config":
        out.config = next();
        break;
      case "--ignore":
        ignore.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
        break;
      case "--no-push":
        out.push = false;
        break;
      default:
        console.error(`Bilinmeyen seçenek: ${a}\n`);
        console.error(HELP);
        process.exit(2);
    }
  }
  if (ignore.length > 0) out.ignore = ignore;
  return out;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`Config okunamadı: ${path}\n${e.message}`);
    process.exit(2);
  }
}

const cli = parseArgs(process.argv.slice(2));
if (cli.help) {
  console.log(HELP);
  process.exit(0);
}

const cwd = resolve(cli.cwd ?? process.cwd());

// package.json "deployDist" alanı
let pkgConfig = {};
const pkgPath = resolve(cwd, "package.json");
if (existsSync(pkgPath)) {
  pkgConfig = readJson(pkgPath).deployDist ?? {};
}

// config dosyası
let fileConfig = {};
const configPath = cli.config ? resolve(cwd, cli.config) : resolve(cwd, ".deploy-dist.json");
if (cli.config && !existsSync(configPath)) {
  console.error(`Config dosyası bulunamadı: ${configPath}`);
  process.exit(2);
}
if (existsSync(configPath)) {
  fileConfig = readJson(configPath);
}

// CLI flag'leri (help/config dışındaki anlamlı alanlar)
const { help: _h, config: _c, ...cliConfig } = cli;

const config = { ...pkgConfig, ...fileConfig, ...cliConfig, cwd };

try {
  const result = deploy(config);
  process.exit(result.deployed ? 0 : 0);
} catch (e) {
  if (e instanceof DeployError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
