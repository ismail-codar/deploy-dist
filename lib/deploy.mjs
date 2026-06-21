import { execSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @typedef {Object} DeployConfig
 * @property {string} cwd          Kaynak repo kökü (source branch'in checkout'u).
 * @property {string} dir          Deploy edilecek worktree dizini (cwd'ye göre veya mutlak). Örn: "dist".
 * @property {string} branch       Worktree'nin bulunması gereken branch. Örn: "dist".
 * @property {string} remote       Push edilecek remote. Örn: "origin".
 * @property {string[]} [ignore]   Worktree içine yazılacak .gitignore satırları. Boşsa .gitignore'a dokunulmaz.
 * @property {number} [maxLogLines]    Listelenecek azami commit sayısı.
 * @property {number} [maxSubjectChars] Satır başına azami karakter (üç nokta dahil).
 * @property {number} [maxBodyChars]   Commit body için toplam karakter tavanı.
 * @property {boolean} [push]      false ise commit atılır ama push edilmez.
 * @property {(msg: string) => void} [log]  Bilgi logu.
 * @property {(msg: string) => void} [warn] Uyarı logu.
 */

export const DEFAULTS = {
  dir: "dist",
  branch: "dist",
  remote: "origin",
  ignore: [],
  maxLogLines: 50,
  maxSubjectChars: 100,
  maxBodyChars: 8000,
  push: true,
};

class DeployError extends Error {}

const sh = {
  run: (cmd, opts) => execSync(cmd, { stdio: "inherit", ...opts }),
  capture: (cmd, opts) => execSync(cmd, { encoding: "utf8", ...opts }).trim(),
};

/** Local branch var mı? */
function branchExistsLocal(branch, cwd) {
  try {
    // sh.capture kullanmıyoruz: stdio:"ignore" ile execSync null döner ve
    // capture'ın .trim()'i TypeError fırlatır (her zaman false sonucu verirdi).
    // sh.run yalnızca exit koduna bakar: 0 → var, ≠0 → catch → yok.
    sh.run(`git show-ref --verify --quiet refs/heads/${branch}`, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Remote branch var mı? (ağ gerekir; ulaşılamazsa false) */
function branchExistsRemote(remote, branch, cwd) {
  try {
    return sh.capture(`git ls-remote --heads ${remote} ${branch}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).length > 0;
  } catch {
    return false;
  }
}

/**
 * '<dir>' dizini '<branch>' branch'inin worktree'i değilse otomatik oluşturur.
 * - Local ya da remote'ta branch varsa onu checkout eder.
 * - Hiç yoksa orphan (bağımsız geçmişli) branch açıp boş bir ilk commit atar
 *   (commit'siz orphan'da HEAD branch adına çözülmez).
 * - '<dir>' build çıktısıyla zaten doluysa (worktree değil) içeriği korunur:
 *   kenara alınır, worktree kurulur, dosyalar geri taşınır.
 */
function ensureWorktree(distDir, cfg, root, log) {
  if (existsSync(resolve(distDir, ".git"))) return;

  log(`'${cfg.dir}' worktree not found — creating...`);

  // Dizin doluysa (ör. önceden çalışmış build) içeriğini yedekle.
  const hasExisting = existsSync(distDir) && readdirSync(distDir).length > 0;
  const backup = hasExisting ? `${distDir}.predeploy.bak` : null;
  if (backup) {
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
    renameSync(distDir, backup);
  }

  // Build aracı (ör. tsdown) her çalışmada '<dir>'i temizleyip worktree'nin
  // '.git' pointer'ını siler; bu yüzden git, çalışma dizini "kayıp ama hâlâ
  // kayıtlı" (prunable) bir worktree görür ve 'git worktree add' şu hatayla
  // patlar: "missing but already registered worktree". Eklemeden önce bu bayat
  // kayıtları temizle.
  const prune = () => {
    try {
      sh.run("git worktree prune", { cwd: root, stdio: "ignore" });
    } catch {
      // prune başarısız olsa bile add'i deneyelim.
    }
  };

  // Worktree'yi ekler; bayat kayıt yüzünden ilk deneme patlarsa prune + '-f'
  // ile bir kez daha dener (prune, dizin hâlâ mevcutsa kaydı temizleyemez;
  // '-f' bu durumda kaydı zorla geçersiz kılar).
  const addWorktree = (force) => {
    const f = force ? "-f " : "";
    if (branchExistsLocal(cfg.branch, root) || branchExistsRemote(cfg.remote, cfg.branch, root)) {
      // Branch mevcut (remote ise git otomatik tracking local branch oluşturur).
      sh.run(`git worktree add ${f}"${cfg.dir}" ${cfg.branch}`, { cwd: root });
    } else {
      // Branch hiç yok: orphan branch + boş ilk commit.
      sh.run(`git worktree add ${f}--orphan -b ${cfg.branch} "${cfg.dir}"`, { cwd: root });
      sh.run(`git commit --allow-empty -m "init ${cfg.branch} branch"`, { cwd: distDir });
    }
  };

  prune();
  try {
    try {
      addWorktree(false);
    } catch {
      prune();
      addWorktree(true);
    }
  } catch (err) {
    if (backup) renameSync(backup, distDir); // başarısızsa eski hali geri koy
    throw err;
  }

  // Yedekteki build dosyalarını worktree içine geri taşı. Worktree mevcut bir
  // branch'ten checkout edildiyse aynı adlı dosya/dizinleri zaten içeriyor
  // olabilir; bu durumda renameSync hedef üstüne yazamaz (Windows'ta EPERM,
  // POSIX'te ENOTEMPTY). Hedefi önce silip taze build çıktısını taşıyoruz.
  if (backup) {
    for (const entry of readdirSync(backup)) {
      const dest = resolve(distDir, entry);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      renameSync(resolve(backup, entry), dest);
    }
    rmSync(backup, { recursive: true, force: true });
  }

  log(`'${cfg.dir}' worktree ready on '${cfg.branch}'.`);
}

/**
 * Commit mesaj bütçesini uygular: satır başına ve toplamda kırpar.
 */
export function capLogLines(text, { maxLogLines, maxSubjectChars, maxBodyChars }) {
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((l) => (l.length > maxSubjectChars ? `${l.slice(0, maxSubjectChars - 1)}…` : l));
  let omitted = 0;
  if (lines.length > maxLogLines) {
    omitted = lines.length - maxLogLines;
    lines.length = maxLogLines;
  }
  let body = lines.join("\n");
  if (body.length > maxBodyChars) {
    const cut = body.lastIndexOf("\n", maxBodyChars);
    const kept = body.slice(0, cut > 0 ? cut : maxBodyChars).split("\n");
    omitted += lines.length - kept.length;
    body = kept.join("\n");
  }
  if (omitted > 0) body += `\n- … (+${omitted} commit daha)`;
  return body;
}

/**
 * Build çıktısını worktree branch'ine deploy eder.
 * @param {DeployConfig} userConfig
 * @returns {{ deployed: boolean, header?: string }}
 */
export function deploy(userConfig) {
  const cfg = { ...DEFAULTS, ...userConfig };
  const log = cfg.log ?? ((m) => console.log(m));
  const warn = cfg.warn ?? ((m) => console.warn(m));

  const root = resolve(cfg.cwd ?? process.cwd());
  const distDir = resolve(root, cfg.dir);

  ensureWorktree(distDir, cfg, root, log);

  const distBranch = sh.capture("git rev-parse --abbrev-ref HEAD", { cwd: distDir });
  if (distBranch !== cfg.branch) {
    throw new DeployError(`'${cfg.dir}' worktree is on '${distBranch}', expected '${cfg.branch}'.`);
  }

  const sourceBranch = sh.capture("git rev-parse --abbrev-ref HEAD", { cwd: root });
  const sourceSha = sh.capture("git rev-parse --short HEAD", { cwd: root });

  if (cfg.ignore && cfg.ignore.length > 0) {
    writeFileSync(resolve(distDir, ".gitignore"), `${cfg.ignore.join("\n")}\n`);
  }

  // Önceki çalışmadan kalmış olabilecek geçici mesaj dosyasını temizle ki
  // git add -A onu stage'leyip commit'e karıştırmasın.
  rmSync(resolve(distDir, ".commit-msg.tmp"), { force: true });

  sh.run("git add -A", { cwd: distDir });

  // Asıl ölçüt stage'lenmiş diff: git status değişiklik gösterse bile (ör. yalnız
  // .gitignore'a giren dosyalar) add sonrası stage boş kalabilir; bu durumda
  // "git commit" "nothing to commit" ile patlardı. Boşsa temiz dönüyoruz.
  const staged = sh.capture("git diff --cached --name-only", { cwd: distDir });
  if (!staged) {
    log(`${cfg.dir} worktree clean — build output unchanged. Nothing to deploy.`);
    return { deployed: false };
  }

  // Son deploy'dan bu yana kaynak branch'teki commit mesajlarını topla.
  // "build: <branch>@<sha>" satırı mesajın sonunda; tüm body'den yakala.
  const lastDistMessage = sh.capture("git log -1 --pretty=%B", { cwd: distDir });
  const prevSha = /^build: .+@([0-9a-f]+)$/im.exec(lastDistMessage)?.[1];

  let logLines = "";
  if (prevSha) {
    // prevSha geçerli mi (history'de var mı) kontrol et; rebase/force-push sonrası olmayabilir.
    const prevValid = (() => {
      try {
        // Çift tırnak şart: cmd.exe `^`'i escape karakteri sayar, tırnaksız
        // `^{commit}` peel sözdizimi `{commit}`'e dönüşüp her deploy'da kırılır.
        sh.capture(`git cat-file -e "${prevSha}^{commit}"`, { cwd: root });
        return true;
      } catch {
        return false;
      }
    })();
    if (prevValid) {
      logLines = sh.capture(`git log --no-merges --pretty=format:"- %s" ${prevSha}..HEAD`, { cwd: root });
      logLines = capLogLines(logLines, cfg);
    } else {
      warn(`Önceki deploy SHA'sı (${prevSha}) bulunamadı; tüm aralık atlanıyor.`);
    }
  } else {
    warn(`Önceki dist commit'inden SHA çıkarılamadı: "${lastDistMessage.split("\n")[0]}".`);
  }

  const header = `build: ${sourceBranch}@${sourceSha}`;
  const msg = logLines ? `${logLines}\n\n${header}` : header;

  const msgFile = resolve(distDir, ".commit-msg.tmp");
  writeFileSync(msgFile, `${msg}\n`);
  try {
    sh.run(`git commit -F "${msgFile}"`, { cwd: distDir });
  } finally {
    rmSync(msgFile, { force: true });
  }

  if (cfg.push) {
    sh.run(`git push ${cfg.remote} ${cfg.branch}`, { cwd: distDir });
  }

  log(`\nDeployed: ${header}`);
  return { deployed: true, header };
}

export { DeployError };
