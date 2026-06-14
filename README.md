# @icodar/deploy-dist

Build çıktısını ayrı bir git branch'inin worktree'sine commit'leyip push eden CLI. Kaynak branch'te son deploy'dan bu yana atılan commit mesajlarını toplayıp deploy commit'ine derler. Statik site / `dist` branch deploy akışları (GitHub Pages benzeri) için.

## Kurulum

Global:

```
npm install -g @icodar/deploy-dist
```

Veya repo içinden doğrudan (yayınlamadan):

```
npm install -g ./packages/deploy-dist
```

## İlk hazırlık

Deploy edilecek dizin, hedef branch'in bir worktree'si olmalı:

```
git worktree add dist dist
```

(`dist` adında bir branch yoksa önce oluştur: `git branch dist` veya `git switch --orphan dist`.)

## Kullanım

```
deploy-dist
```

Tipik akış (`package.json`):

```json
{
  "scripts": {
    "deploy": "vite build && deploy-dist"
  }
}
```

## Ne yapar

1. `<dir>` dizininin `<branch>` branch'inin worktree'si olduğunu doğrular.
2. (Tanımlıysa) ignore satırlarını `<dir>/.gitignore`'a yazar.
3. Worktree temizse (build çıktısı değişmemişse) çıkar.
4. Son deploy commit'inin footer'ındaki `build: <branch>@<sha>` satırından önceki SHA'yı okur; o noktadan `HEAD`'e kadarki kaynak commit mesajlarını toplar.
5. Toplanan log + `build: <branch>@<sha>` footer'ı ile commit atar, `<remote> <branch>`'e push eder.

## Seçenekler

| Flag | Varsayılan | Açıklama |
|---|---|---|
| `--dir <path>` | `dist` | Worktree dizini |
| `--branch <name>` | `dist` | Hedef branch |
| `--remote <name>` | `origin` | Push remote'u |
| `--ignore <a,b,c>` | — | `.gitignore` satırları (virgülle ayrık, tekrarlanabilir) |
| `--cwd <path>` | cwd | Kaynak repo kökü |
| `--no-push` | — | Commit at, push etme |
| `--config <path>` | `.deploy-dist.json` | Config JSON dosyası |
| `-h`, `--help` | — | Yardım |

## Config

Çözümleme sırası (artan öncelik):

```
defaults  <  package.json "deployDist"  <  config dosyası  <  CLI flag
```

`.deploy-dist.json`:

```json
{
  "dir": "dist",
  "branch": "dist",
  "remote": "origin",
  "ignore": ["models", "tiles", "textures", "stats.html"]
}
```

veya `package.json`:

```json
{
  "deployDist": {
    "ignore": ["models", "tiles", "textures"]
  }
}
```

## Programatik kullanım

```js
import { deploy } from "@icodar/deploy-dist";

const { deployed, header } = deploy({
  cwd: process.cwd(),
  dir: "dist",
  branch: "dist",
  remote: "origin",
  ignore: ["models", "tiles"],
  push: true,
});
```
